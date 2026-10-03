using System.Runtime.CompilerServices;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Summarizes via the xAI chat API. Auth is SuperGrok OAuth or a pasted API key —
/// <c>XaiProviderResolver</c> (App layer) gates availability before this is constructed.
/// </summary>
    public sealed class XaiSummaryProvider(
        XaiAuthSession session,
        XaiApiClient api,
        string? modelId,
        string? reasoningEffort = null) : ISummaryProvider
{
    public const string ProviderId = "xai";

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
        var raw = await CompleteAsync(prompt, cancellationToken);
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
        return CompleteAsync(prompt, cancellationToken);
    }

    public Task<string> CompletePromptAsync(string prompt, CancellationToken cancellationToken = default) =>
        CompleteAsync(prompt, cancellationToken);

    public async IAsyncEnumerable<string> StreamPromptAsync(
        string prompt,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var token = await session.GetAccessTokenAsync(cancellationToken);
        await foreach (var chunk in api.StreamChatAsync(
            token,
            XaiApiClient.ResolveModelId(modelId, []),
            prompt,
            cancellationToken,
            reasoningEffort))
        {
            yield return chunk;
        }
    }

    private async Task<string> CompleteAsync(string prompt, CancellationToken cancellationToken)
    {
        var token = await session.GetAccessTokenAsync(cancellationToken);
        return await api.CompleteChatAsync(
            token,
            XaiApiClient.ResolveModelId(modelId, []),
            prompt,
            cancellationToken,
            reasoningEffort);
    }
}
