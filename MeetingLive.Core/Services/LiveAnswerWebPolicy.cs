using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure decisions for live answers: which providers can search the web, when to enable it,
/// and how the session context (meeting title and brief) is assembled for the prompt.
/// </summary>
public static class LiveAnswerWebPolicy
{
    /// <summary>Upper bound on the session context text sent with a live answer.</summary>
    public const int MaxSessionContextChars = 1500;

    /// <summary>Only the Claude Code and Codex CLIs search the web on their own.</summary>
    public static bool SupportsWebSearch(SummaryProviderKind kind) =>
        kind is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex;

    public static bool ShouldUseWeb(bool providerSupportsWeb, bool forced, bool jevNeedsWeb) =>
        providerSupportsWeb && (forced || jevNeedsWeb);

    /// <summary>Returns null when both inputs are blank.</summary>
    public static string? BuildSessionContext(string? meetingTitle, string? brief)
    {
        var title = meetingTitle?.Trim() ?? string.Empty;
        var body = brief?.Trim() ?? string.Empty;
        if (title.Length == 0 && body.Length == 0)
            return null;

        var text = title.Length == 0
            ? body
            : body.Length == 0
                ? $"Meeting: {title}"
                : $"Meeting: {title}\n{body}";

        return text.Length <= MaxSessionContextChars
            ? text
            : text[..MaxSessionContextChars].TrimEnd();
    }
}
