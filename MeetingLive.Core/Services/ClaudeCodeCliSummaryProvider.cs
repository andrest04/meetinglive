using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Summarizes via the Claude Code CLI, non-interactively (<c>claude -p</c>, prompt piped
/// over stdin). Requires the user to already have <c>claude</c> installed and signed in —
/// <c>CliProviderResolver</c> (App layer) checks availability and walks the user through
/// setup before this provider is ever constructed.
/// </summary>
public sealed class ClaudeCodeCliSummaryProvider(ICliProcessRunner processRunner) : ISummaryProvider
{
    /// <summary>Persisted as <see cref="MeetingRecord.SummaryProvider"/> when this provider ran.</summary>
    public const string ProviderId = "claude-code";

    private const string ExecutableName = "claude";
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);

    public async Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null)
    {
        var prompt = CliSummaryPromptBuilder.Build(title, recordedAt, transcript, outputLanguage);
        var raw = await CliFailureMapper.RunRequiredStdoutAsync(
            processRunner,
            ExecutableName,
            "-p",
            prompt,
            Timeout,
            CliFailureMapper.ClaudeCodeDisplayName,
            cancellationToken);

        var (summaryMarkdown, actionItems) = SummaryMarkdownSplitter.Split(raw);
        return new SummaryResult(summaryMarkdown, actionItems, ProviderId);
    }
}
