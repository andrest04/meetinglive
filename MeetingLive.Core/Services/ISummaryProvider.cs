using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Abstraction over whatever generates the meeting summary from a transcript. Three
/// implementations today: <see cref="LocalLlmSummaryProvider"/> (local, free, in-process via
/// LLamaSharp), <see cref="ClaudeCodeCliSummaryProvider"/>, and <see cref="CodexCliSummaryProvider"/>
/// (both shell out to an already-installed, already-authenticated CLI). All three are asked to
/// produce the same "## Summary" / "## Action Items" Markdown shape, split via
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
        string? outputLanguage = null);
}
