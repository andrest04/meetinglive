namespace MeetingLive.Core.Services;

/// <summary>
/// Snapshot of whether Record may start. Live preview is required only when enabled;
/// Whisper and a summary engine are always required.
/// <see cref="CanRecord"/> is <c>(!LiveRequired || LiveReady) &amp;&amp; WhisperReady &amp;&amp; SummaryReady</c>.
/// </summary>
public sealed record RecordingReadiness(
    bool LiveRequired,
    bool LiveReady,
    bool WhisperReady,
    bool SummaryReady,
    bool CanRecord);

/// <summary>
/// Pure readiness policy for Record. Callers pass file/PATH facts as booleans so this
/// stays UI-free and unit-testable.
/// </summary>
public static class RecordingReadinessEvaluator
{
    /// <summary>
    /// Evaluates the three Record gates.
    /// <paramref name="summaryProviderChosen"/> is false when the user has never picked an engine.
    /// When the chosen engine is Local, <paramref name="localSummarySelected"/> is true and
    /// <paramref name="localModelDownloaded"/> is the on-disk GGUF fact; otherwise
    /// <paramref name="cliOnPath"/> is the CLI PATH fact.
    /// </summary>
    public static RecordingReadiness Evaluate(
        bool liveTranscriptionEnabled,
        bool liveEngineReady,
        bool whisperReady,
        bool summaryProviderChosen,
        bool localSummarySelected,
        bool localModelDownloaded,
        bool cliOnPath)
    {
        var liveRequired = liveTranscriptionEnabled;
        var summaryReady = summaryProviderChosen
            && (localSummarySelected ? localModelDownloaded : cliOnPath);
        var canRecord = (!liveRequired || liveEngineReady) && whisperReady && summaryReady;

        return new RecordingReadiness(
            LiveRequired: liveRequired,
            LiveReady: liveEngineReady,
            WhisperReady: whisperReady,
            SummaryReady: summaryReady,
            CanRecord: canRecord);
    }
}
