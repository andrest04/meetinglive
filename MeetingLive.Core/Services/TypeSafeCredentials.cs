using System.Text;

namespace MeetingLive.Core.Services;

/// <summary>
/// TypeSafe API key used as the Bearer token. Do not log or put this in settings.json.
/// </summary>
public sealed record TypeSafeCredentials(string ApiKey)
{
    // Keep secrets out of default record ToString / debugger dumps.
    private bool PrintMembers(StringBuilder builder)
    {
        builder.Append("HasApiKey = ").Append(!string.IsNullOrWhiteSpace(ApiKey));
        return true;
    }
}
