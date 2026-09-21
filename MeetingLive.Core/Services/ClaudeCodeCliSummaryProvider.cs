using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Summarizes via the Claude Code CLI, non-interactively (<c>claude -p</c>, prompt piped
/// over stdin). Requires the user to already have <c>claude</c> installed and signed in —
/// <c>CliProviderResolver</c> (App layer) checks availability and walks the user through
/// setup before this provider is ever constructed.
/// </summary>
public sealed class ClaudeCodeCliSummaryProvider(
        ICliProcessRunner processRunner,
        string? modelId = null,
        string? effort = null) : CliToolProviderBase(processRunner), ISummaryProvider
    {
        /// <summary>Persisted as <see cref="MeetingRecord.SummaryProvider"/> when this provider ran.</summary>
        public const string ProviderId = "claude-code";

        protected override string ExecutableName => "claude";
        protected override TimeSpan Timeout { get; } = TimeSpan.FromMinutes(5);
        protected override string Arguments { get; } = CliInvocation.ClaudePrint(modelId, effort);
        protected override string ProviderDisplayName => CliFailureMapper.ClaudeCodeDisplayName;

    public async Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null,
        DateTimeOffset? endedAt = null)
    {
        var prompt = CliSummaryPromptBuilder.Build(title, recordedAt, transcript, outputLanguage, endedAt);
        var raw = await RunAsync(prompt, cancellationToken);

        var (summaryMarkdown, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);
        return new SummaryResult(summaryMarkdown, actionItems, ProviderId, suggestedTitle);
    }

    public Task<string> SuggestTitleAsync(
        string transcript,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null)
    {
        var prompt = CliMeetingTitlePromptBuilder.Build(transcript, recordedAt, outputLanguage);
        return RunAsync(prompt, cancellationToken);
    }

    public Task<string> CompletePromptAsync(string prompt, CancellationToken cancellationToken = default) =>
        RunAsync(prompt, cancellationToken);
}
