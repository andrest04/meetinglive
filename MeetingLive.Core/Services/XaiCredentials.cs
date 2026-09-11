using System.Text;

namespace MeetingLive.Core.Services;

public enum XaiCredentialKind
{
    ApiKey,
    OAuth,
}

/// <summary>
/// SuperGrok OAuth tokens or a pasted console.x.ai API key. <see cref="AccessToken"/> is the
/// Bearer value (access token or API key). Do not log or put this in settings.json.
/// </summary>
public sealed record XaiCredentials(
    XaiCredentialKind Kind,
    string AccessToken,
    string? RefreshToken,
    DateTimeOffset? ExpiresAt)
{
    // Keep secrets out of default record ToString / debugger dumps.
    private bool PrintMembers(StringBuilder builder)
    {
        builder.Append("Kind = ").Append(Kind);
        builder.Append(", ExpiresAt = ").Append(ExpiresAt);
        return true;
    }
}
