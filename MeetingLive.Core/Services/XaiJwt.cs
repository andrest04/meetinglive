using System.Text;
using System.Text.Json;

namespace MeetingLive.Core.Services;

/// <summary>
/// Unsigned JWT payload peek. This is NOT a trust decision — only a fallback clock when
/// the token response omitted <c>expires_in</c>.
/// </summary>
internal static class XaiJwt
{
    public static DateTimeOffset? TryReadExpiry(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;

        var parts = token.Split('.');
        if (parts.Length < 2)
            return null;

        try
        {
            var json = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("exp", out var exp) ||
                exp.ValueKind != JsonValueKind.Number)
                return null;

            return DateTimeOffset.FromUnixTimeSeconds(exp.GetInt64());
        }
        catch (Exception ex) when (ex is FormatException or JsonException or InvalidOperationException or ArgumentOutOfRangeException or DecoderFallbackException)
        {
            return null;
        }
    }

    private static byte[] Base64UrlDecode(string input)
    {
        var padded = input.Replace('-', '+').Replace('_', '/');
        padded += (padded.Length % 4) switch
        {
            2 => "==",
            3 => "=",
            _ => string.Empty,
        };
        return Convert.FromBase64String(padded);
    }
}
