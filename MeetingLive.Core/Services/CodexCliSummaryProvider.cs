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
public sealed class CodexCliSummaryProvider(ICliProcessRunner processRunner) : ISummaryProvider
{
    /// <summary>Persisted as <see cref="MeetingRecord.SummaryProvider"/> when this provider ran.</summary>
    public const string ProviderId = "codex";

    private const string ExecutableName = "codex";
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);

    public async Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null)
    {
        var prompt = CliSummaryPromptBuilder.Build(title, recordedAt, transcript, outputLanguage);

        var result = await processRunner.RunAsync(ExecutableName, "exec -", prompt, Timeout, cancellationToken);

        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"The Codex CLI exited with code {result.ExitCode}: {result.StandardError.Trim()}");
        }

        var raw = result.StandardOutput.Trim();
        if (raw.Length == 0)
            throw new InvalidOperationException("The Codex CLI did not return any content.");

        var (summaryMarkdown, actionItems) = SummaryMarkdownSplitter.Split(raw);
        return new SummaryResult(summaryMarkdown, actionItems, ProviderId);
    }
}
