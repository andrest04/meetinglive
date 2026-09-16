using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// A summary provider resolved and ready to use, plus the provenance a caller may need to persist
/// alongside the generated summary (e.g. <c>MeetingRecord.SummaryProvider</c>) or to pair with a
/// matching <see cref="ITranscriptPolisher"/>. Callers that only need the provider itself can
/// discard <see cref="Kind"/> and <see cref="LocalModelPath"/>.
/// </summary>
public sealed record ResolvedSummaryPipeline(ISummaryProvider Provider, SummaryProviderKind Kind, string? LocalModelPath);

/// <summary>
/// Resolves a ready-to-use summary provider for a given <see cref="SummaryProviderKind"/>, gated
/// on the readiness check each kind needs before it can be constructed. This is the piece
/// <see cref="AppServices.CreateSummaryProvider"/> does not cover: that factory is a pure Strategy
/// selector (given a kind, build that provider) and is already the single, correct construction
/// point — it has no opinion on whether the kind is *ready* to be constructed yet (local model
/// downloaded, CLI on PATH, xAI account signed in). That readiness-gating orchestration used to be
/// copy-pasted identically across RecordingPageViewModel, SessionPageViewModel, and
/// SummaryPageViewModel; this class is the one place it lives now.
/// </summary>
/// <remarks>
/// The three delegates are UI-owned gates the hosting page wires up from page-level resolvers
/// (<see cref="SummaryModelResolver"/>, <see cref="CliProviderResolver"/>, <see cref="XaiProviderResolver"/>),
/// which can prompt the user (e.g. a model-download or sign-in dialog) — this class never touches
/// UI itself, it only sequences the gate for the selected kind and, on success, defers to
/// <see cref="AppServices.CreateSummaryProvider"/>.
/// </remarks>
public static class SummaryProviderResolver
{
    /// <summary>
    /// Returns null when the gate for <paramref name="providerKind"/> was not satisfied (no local
    /// model chosen, CLI not available, xAI not signed in, or a setup dialog was cancelled) — the
    /// caller then skips summarization/polishing.
    /// </summary>
    public static async Task<ResolvedSummaryPipeline?> ResolveAsync(
        SummaryProviderKind providerKind,
        Func<Task<string?>>? ensureSummaryModelAsync,
        Func<SummaryProviderKind, Task<bool>>? ensureCliProviderAsync,
        Func<Task<bool>>? ensureXaiProviderAsync)
    {
        if (providerKind == SummaryProviderKind.Local)
        {
            var modelPath = ensureSummaryModelAsync is null ? null : await ensureSummaryModelAsync();
            return modelPath is null
                ? null
                : new ResolvedSummaryPipeline(
                    AppServices.CreateSummaryProvider(SummaryProviderKind.Local, modelPath),
                    SummaryProviderKind.Local,
                    modelPath);
        }

        if (providerKind == SummaryProviderKind.Xai)
        {
            var xaiAvailable = ensureXaiProviderAsync is not null && await ensureXaiProviderAsync();
            return xaiAvailable
                ? new ResolvedSummaryPipeline(
                    AppServices.CreateSummaryProvider(SummaryProviderKind.Xai, localModelPath: null),
                    SummaryProviderKind.Xai,
                    LocalModelPath: null)
                : null;
        }

        var available = ensureCliProviderAsync is not null && await ensureCliProviderAsync(providerKind);
        return available
            ? new ResolvedSummaryPipeline(
                AppServices.CreateSummaryProvider(providerKind, localModelPath: null),
                providerKind,
                LocalModelPath: null)
            : null;
    }
}
