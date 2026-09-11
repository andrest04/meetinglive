using System.Text.Json;
using System.Text.Json.Serialization;

namespace MeetingLive.Core.Services;

public sealed record XaiDeviceCode(
    string DeviceCode,
    string UserCode,
    Uri VerificationUri,
    TimeSpan ExpiresIn,
    TimeSpan Interval);

/// <summary>
/// RFC 8628 device-code OAuth against auth.x.ai. MeetingLive reuses the public Grok-CLI
/// client id (same approach as OpenCode); xAI can revoke it.
/// </summary>
public sealed class XaiOAuthClient
{
    // Public Grok-CLI OAuth client. MeetingLive reuses it for SuperGrok device-code login.
    public const string ClientId = "b1a00492-073a-47ea-816f-4c329264a828";
    public const string TokenUrl = "https://auth.x.ai/oauth2/token";
    public const string DeviceAuthorizationUrl = "https://auth.x.ai/oauth2/device/code";
    public const string Scope = "openid profile email offline_access grok-cli:access api:access";
    public const string Referrer = "meetinglive";
    public const string DeviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code";

    private static readonly TimeSpan DefaultInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan DefaultDeviceLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan SlowDownBump = TimeSpan.FromSeconds(5);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly Func<TimeSpan, CancellationToken, Task> _sleep;
    private readonly Func<DateTimeOffset> _utcNow;

    public XaiOAuthClient(
        HttpClient http,
        Func<TimeSpan, CancellationToken, Task>? sleep = null,
        Func<DateTimeOffset>? utcNow = null)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _sleep = sleep ?? Task.Delay;
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public async Task<XaiDeviceCode> RequestDeviceCodeAsync(CancellationToken cancellationToken = default)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["scope"] = Scope,
            ["referrer"] = Referrer,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, DeviceAuthorizationUrl) { Content = content };
        using var response = await _http.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) could not start SuperGrok sign-in.");

        DeviceCodeDto? dto;
        try
        {
            dto = JsonSerializer.Deserialize<DeviceCodeDto>(json, JsonOptions);
        }
        catch (JsonException)
        {
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) could not start SuperGrok sign-in.");
        }

        if (dto is null || string.IsNullOrWhiteSpace(dto.DeviceCode) || string.IsNullOrWhiteSpace(dto.UserCode))
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) could not start SuperGrok sign-in.");

        var verification = dto.VerificationUriComplete ?? dto.VerificationUri;
        if (string.IsNullOrWhiteSpace(verification) || !Uri.TryCreate(verification, UriKind.Absolute, out var uri))
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) could not start SuperGrok sign-in.");

        var intervalSeconds = dto.Interval ?? (int)DefaultInterval.TotalSeconds;
        var expiresSeconds = dto.ExpiresIn ?? 300;
        return new XaiDeviceCode(
            dto.DeviceCode,
            dto.UserCode,
            uri,
            TimeSpan.FromSeconds(Math.Max(expiresSeconds, 1)),
            FloorInterval(TimeSpan.FromSeconds(intervalSeconds)));
    }

    public async Task<XaiCredentials> PollDeviceCodeTokenAsync(
        XaiDeviceCode device,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(device);

        var interval = FloorInterval(device.Interval);
        var deadline = _utcNow() + (device.ExpiresIn <= TimeSpan.Zero ? DefaultDeviceLifetime : device.ExpiresIn);

        while (_utcNow() < deadline)
        {
            var token = await TryExchangeDeviceCodeAsync(device.DeviceCode, cancellationToken);
            if (token.Credentials is not null)
                return token.Credentials;

            switch (token.Error)
            {
                case "authorization_pending":
                    await _sleep(interval, cancellationToken);
                    continue;
                case "slow_down":
                    interval = FloorInterval(interval + SlowDownBump);
                    await _sleep(interval, cancellationToken);
                    continue;
                case "access_denied":
                case "authorization_denied":
                    throw new XaiException(XaiFailureKind.AccessDenied, "Sign-in was denied.");
                case "expired_token":
                    throw new XaiException(XaiFailureKind.ExpiredToken, "The sign-in code expired. Try again.");
                default:
                    throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) sign-in failed.");
            }
        }

        throw new XaiException(XaiFailureKind.ExpiredToken, "The sign-in code expired. Try again.");
    }

    public async Task<XaiCredentials> RefreshAccessTokenAsync(
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
            throw new XaiException(XaiFailureKind.NotSignedIn, NotSignedInMessage);

        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["client_id"] = ClientId,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl) { Content = content };
        using var response = await _http.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        var parsed = ParseTokenResponse(json, fallbackRefreshToken: refreshToken);
        if (parsed.Credentials is null)
            throw new XaiException(XaiFailureKind.NotSignedIn, NotSignedInMessage);

        return parsed.Credentials;
    }

    private async Task<(XaiCredentials? Credentials, string? Error)> TryExchangeDeviceCodeAsync(
        string deviceCode,
        CancellationToken cancellationToken)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = DeviceCodeGrantType,
            ["device_code"] = deviceCode,
            ["client_id"] = ClientId,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl) { Content = content };
        using var response = await _http.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        return ParseTokenResponse(json, fallbackRefreshToken: null);
    }

    private (XaiCredentials? Credentials, string? Error) ParseTokenResponse(string json, string? fallbackRefreshToken)
    {
        TokenDto? dto;
        try
        {
            dto = JsonSerializer.Deserialize<TokenDto>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return (null, "invalid_response");
        }

        if (dto is null)
            return (null, "invalid_response");

        if (!string.IsNullOrWhiteSpace(dto.AccessToken))
        {
            var expiresAt = dto.ExpiresIn is { } seconds
                ? _utcNow().AddSeconds(seconds)
                : XaiJwt.TryReadExpiry(dto.AccessToken);

            return (new XaiCredentials(
                XaiCredentialKind.OAuth,
                dto.AccessToken,
                string.IsNullOrWhiteSpace(dto.RefreshToken) ? fallbackRefreshToken : dto.RefreshToken,
                expiresAt), null);
        }

        return (null, string.IsNullOrWhiteSpace(dto.Error) ? "invalid_response" : dto.Error);
    }

    private static TimeSpan FloorInterval(TimeSpan interval) =>
        interval < MinInterval ? MinInterval : interval;

    internal const string NotSignedInMessage =
        "You're not signed in to Grok (xAI). Sign in with SuperGrok or save an API key in Settings.";

    private sealed class DeviceCodeDto
    {
        [JsonPropertyName("device_code")]
        public string? DeviceCode { get; set; }

        [JsonPropertyName("user_code")]
        public string? UserCode { get; set; }

        [JsonPropertyName("verification_uri")]
        public string? VerificationUri { get; set; }

        [JsonPropertyName("verification_uri_complete")]
        public string? VerificationUriComplete { get; set; }

        [JsonPropertyName("expires_in")]
        public int? ExpiresIn { get; set; }

        [JsonPropertyName("interval")]
        public int? Interval { get; set; }
    }

    private sealed class TokenDto
    {
        [JsonPropertyName("access_token")]
        public string? AccessToken { get; set; }

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; set; }

        [JsonPropertyName("expires_in")]
        public int? ExpiresIn { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }
}
