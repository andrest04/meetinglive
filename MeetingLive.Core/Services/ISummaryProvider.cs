using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Abstraction over whatever generates the meeting summary from a transcript. Four
/// implementations today: <see cref="LocalLlmSummaryProvider"/> (local, free, in-process via
/// LLamaSharp), <see cref="ClaudeCodeCliSummaryProvider"/>, <see cref="CodexCliSummaryProvider"/>
/// (both shell out to an already-installed, already-authenticated CLI), and
/// <see cref="XaiSummaryProvider"/> (in-app HTTP to api.x.ai). All four are asked to
/// produce the same "## Title" / "## Summary" / "## Action Items" Markdown shape, split via
/// <see cref="SummaryMarkdownSplitter"/>, so the rest of the pipeline never branches on which
/// provider ran.
/// </summary>
public interface ISummaryProvider
{
    Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null,
        DateTimeOffset? endedAt = null);

    /// <summary>
    /// Title-only inference. Returns the model stdout; callers persist with
    /// <see cref="SuggestedMeetingTitle.FromModelResponse"/> (always apply), not
    /// <see cref="SuggestedMeetingTitle.Resolve"/>.
    /// </summary>
    Task<string> SuggestTitleAsync(
        string transcript,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null);

    /// <summary>
    /// Runs an already-built prompt and returns the model text. Used for Ask checklists
    /// so Jev can select evidence and the user's summary provider writes the list.
    /// </summary>
    Task<string> CompletePromptAsync(string prompt, CancellationToken cancellationToken = default);
}
