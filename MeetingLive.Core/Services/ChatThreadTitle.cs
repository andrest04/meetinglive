namespace MeetingLive.Core.Services;

/// <summary>Thread title is the first user message, trimmed, capped at <see cref="MaxChars"/>.</summary>
public static class ChatThreadTitle
{
    public const int MaxChars = 60;

    public static string FromFirstMessage(string userMessage)
    {
        ArgumentNullException.ThrowIfNull(userMessage);
        var trimmed = userMessage.Trim().ReplaceLineEndings(" ");
        if (trimmed.Length <= MaxChars)
            return trimmed;

        return trimmed[..MaxChars].TrimEnd();
    }
}
