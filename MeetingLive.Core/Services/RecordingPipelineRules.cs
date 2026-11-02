namespace MeetingLive.Core.Services;

/// <summary>What a finished take has to work with once the offline transcription pass is over.</summary>
public enum TranscriptionStageOutcome
{
    OfflineTranscript,
    LiveDraft,

    /// <summary>The offline pass threw, but the live draft survives. The user should be told.</summary>
    LiveDraftAfterFailure,

    /// <summary>The offline pass ran and heard nothing.</summary>
    NoTranscript,

    FailedWithoutTranscript,
}

/// <summary>Pure decisions of the post-recording pipeline, separate from its UI and file effects.</summary>
public static class RecordingPipelineRules
{
    /// <summary>
    /// A take becomes a saved meeting before the offline pass, so a failure there cannot orphan its
    /// audio. Only a re-run over audio the meeting already points at skips this: it has nothing new
    /// to protect and must leave the previous transcript untouched until the new one succeeds.
    /// </summary>
    public static bool ShouldSaveBeforeTranscribing(string? liveDraft, string? existingAudioPath, string audioPath)
    {
        if (!string.IsNullOrWhiteSpace(liveDraft))
            return true;

        return !string.Equals(existingAudioPath, audioPath, StringComparison.OrdinalIgnoreCase);
    }

    public static TranscriptionStageOutcome ResolveTranscriptionStage(
        string? liveDraft, string? offlineTranscript, bool offlinePassFailed)
    {
        if (!string.IsNullOrWhiteSpace(offlineTranscript))
            return TranscriptionStageOutcome.OfflineTranscript;

        if (!string.IsNullOrWhiteSpace(liveDraft))
            return offlinePassFailed ? TranscriptionStageOutcome.LiveDraftAfterFailure : TranscriptionStageOutcome.LiveDraft;

        return offlinePassFailed ? TranscriptionStageOutcome.FailedWithoutTranscript : TranscriptionStageOutcome.NoTranscript;
    }
}
