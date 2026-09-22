using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Summarizes via the Codex CLI, non-interactively (<c>codex exec -</c>, prompt piped over
/// stdin — confirmed against a real <c>codex exec --help</c>: the <c>-</c> argument tells
/// Codex to read its prompt from stdin instead of treating <c>-</c> itself as the prompt).
/// Requires the user to already have <c>codex</c> installed and signed in —
/// <c>CliProviderResolver</c> (App layer) checks availability and walks the user through
/// setup before this provider is ever constructed.
/// </summary>
    public sealed class CodexCliSummaryProvider(
        ICliProcessRunner processRunner,
        string? modelId = null,
        string? effort = null) : CliToolProviderBase(processRunner), ISummaryProvider
    {
        /// <summary>Persisted as <see cref="MeetingRecord.SummaryProvider"/> when this provider ran.</summary>
        public const string ProviderId = "codex";

        protected override string ExecutableName => "codex";
        protected override TimeSpan Timeout { get; } = TimeSpan.FromMinutes(5);
        protected override string Arguments { get; } = CliInvocation.CodexExec(modelId, effort);
        protected override string ProviderDisplayName => CliFailureMapper.CodexDisplayName;

    public async Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null,
        DateTimeOffset? endedAt = null,
        SummaryEnhancementContext? enhancement = null)
    {
        var prompt = CliSummaryPromptBuilder.Build(title, recordedAt, transcript, outputLanguage, endedAt, enhancement);
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
