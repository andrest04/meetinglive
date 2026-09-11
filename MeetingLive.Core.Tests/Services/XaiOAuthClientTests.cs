using System.Net;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class XaiOAuthClientTests
{
    [Fact]
    public async Task RequestDeviceCodeAsync_PostsExpectedFormFields()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """
            {"device_code":"dev-1","user_code":"ABCD-EFGH","verification_uri":"https://auth.x.ai/device","verification_uri_complete":"https://auth.x.ai/device?code=ABCD-EFGH","expires_in":300,"interval":5}
            """));
        var client = new XaiOAuthClient(new HttpClient(handler));

        var device = await client.RequestDeviceCodeAsync();

        Assert.Equal("dev-1", device.DeviceCode);
        Assert.Equal("ABCD-EFGH", device.UserCode);
        Assert.Equal("https://auth.x.ai/device?code=ABCD-EFGH", device.VerificationUri.ToString());
        Assert.NotNull(handler.LastRequest);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal(XaiOAuthClient.DeviceAuthorizationUrl, handler.LastRequest.RequestUri!.ToString());
        var form = ParseForm(handler.LastRequestBody);
        Assert.Equal(XaiOAuthClient.ClientId, form["client_id"]);
        Assert.Equal(XaiOAuthClient.Scope, form["scope"]);
        Assert.Equal("meetinglive", form["referrer"]);
    }

    [Fact]
    public async Task PollDeviceCodeTokenAsync_AuthorizationPendingThenSuccess_ReturnsCredentials()
    {
        var handler = new FakeHttpMessageHandler((_, index) => index == 0
            ? FakeHttpMessageHandler.JsonResponse(HttpStatusCode.BadRequest, """{"error":"authorization_pending"}""")
            : FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, """
                {"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600}
                """));
        var sleeps = new List<TimeSpan>();
        var now = new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
        var client = new XaiOAuthClient(
            new HttpClient(handler),
            sleep: (delay, _) =>
            {
                sleeps.Add(delay);
                return Task.CompletedTask;
            },
            utcNow: () => now);

        var device = new XaiDeviceCode(
            "dev-1",
            "ABCD",
            new Uri("https://auth.x.ai/device"),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromSeconds(5));

        var credentials = await client.PollDeviceCodeTokenAsync(device);

        Assert.Equal(XaiCredentialKind.OAuth, credentials.Kind);
        Assert.Equal("access-1", credentials.AccessToken);
        Assert.Equal("refresh-1", credentials.RefreshToken);
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(sleeps, delay => Assert.Equal(TimeSpan.FromSeconds(5), delay));
        var form = ParseForm(handler.RequestBodies[0]);
        Assert.Equal(XaiOAuthClient.DeviceCodeGrantType, form["grant_type"]);
        Assert.Equal("dev-1", form["device_code"]);
        Assert.Equal(XaiOAuthClient.ClientId, form["client_id"]);
    }

    [Fact]
    public async Task PollDeviceCodeTokenAsync_AccessDenied_Throws()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.BadRequest,
            """{"error":"access_denied"}"""));
        var client = new XaiOAuthClient(
            new HttpClient(handler),
            sleep: (_, _) => Task.CompletedTask,
            utcNow: () => DateTimeOffset.UtcNow);

        var device = new XaiDeviceCode(
            "dev-1",
            "ABCD",
            new Uri("https://auth.x.ai/device"),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromSeconds(1));

        var exception = await Assert.ThrowsAsync<XaiException>(() => client.PollDeviceCodeTokenAsync(device));

        Assert.Equal(XaiFailureKind.AccessDenied, exception.Kind);
        Assert.Contains("denied", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("access-1", exception.Message);
    }

    [Fact]
    public async Task RefreshAccessTokenAsync_PostsRefreshToken_AndReturnsNewAccess()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"access_token":"access-2","refresh_token":"refresh-2","expires_in":1800}"""));
        var now = new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
        var client = new XaiOAuthClient(new HttpClient(handler), utcNow: () => now);

        var credentials = await client.RefreshAccessTokenAsync("refresh-1");

        Assert.Equal("access-2", credentials.AccessToken);
        Assert.Equal("refresh-2", credentials.RefreshToken);
        Assert.Equal(now.AddSeconds(1800), credentials.ExpiresAt);
        var form = ParseForm(handler.LastRequestBody);
        Assert.Equal("refresh_token", form["grant_type"]);
        Assert.Equal("refresh-1", form["refresh_token"]);
        Assert.Equal(XaiOAuthClient.ClientId, form["client_id"]);
    }

    private static Dictionary<string, string> ParseForm(string? body)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(body))
            return result;

        foreach (var part in body.Split('&'))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0].Replace('+', ' '));
            var value = pair.Length > 1 ? Uri.UnescapeDataString(pair[1].Replace('+', ' ')) : string.Empty;
            result[key] = value;
        }

        return result;
    }
}
