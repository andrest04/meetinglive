namespace MeetingLive.Core.Services;

/// <summary>Where the single foreground take is in its record, stop, and process lifecycle.
/// A summary still running in the background after processing handed off is not a phase: it
/// belongs to its own pipeline run and no longer holds the session.</summary>
public enum RecordingSessionPhase
{
    Idle,

    /// <summary>A start or an import is underway; neither capture nor processing exists yet.</summary>
    Preparing,

    Recording,

    /// <summary>Capture is being stopped, either to process the take or to discard it.</summary>
    Stopping,

    Processing,
}

/// <summary>
/// The one owner of "who may act on the current take". Stop, Discard, Start, Import, and a capture
/// failure all go through here, so a second caller is refused instead of racing the first.
/// Transitions from an unexpected phase return false and change nothing. Not thread-safe: the
/// recording view model calls it on the UI thread only.
/// </summary>
public sealed class RecordingSessionGate
{
    public RecordingSessionPhase Phase { get; private set; } = RecordingSessionPhase.Idle;

    public bool CanToggle => Phase is RecordingSessionPhase.Idle or RecordingSessionPhase.Recording;

    public bool CanImport => Phase == RecordingSessionPhase.Idle;

    /// <summary>Pause and Discard act on a running capture only.</summary>
    public bool CanControlCapture => Phase == RecordingSessionPhase.Recording;

    /// <summary>Closing now would abandon audio that is still being captured.</summary>
    public bool RequiresCloseConfirmation => Phase == RecordingSessionPhase.Recording;

    public bool TryBeginPreparing() => Move(RecordingSessionPhase.Idle, RecordingSessionPhase.Preparing);

    public bool CancelPreparing() => Move(RecordingSessionPhase.Preparing, RecordingSessionPhase.Idle);

    public bool MarkRecording() => Move(RecordingSessionPhase.Preparing, RecordingSessionPhase.Recording);

    public bool TryBeginStopping() => Move(RecordingSessionPhase.Recording, RecordingSessionPhase.Stopping);

    /// <summary>A stopped take, or an import that skipped capture, starts processing.</summary>
    public bool MarkProcessing() =>
        Move(RecordingSessionPhase.Stopping, RecordingSessionPhase.Processing)
        || Move(RecordingSessionPhase.Preparing, RecordingSessionPhase.Processing);

    /// <summary>Processing finished, or a stopping take was discarded.</summary>
    public bool MarkIdle() =>
        Move(RecordingSessionPhase.Processing, RecordingSessionPhase.Idle)
        || Move(RecordingSessionPhase.Stopping, RecordingSessionPhase.Idle);

    private bool Move(RecordingSessionPhase from, RecordingSessionPhase to)
    {
        if (Phase != from)
            return false;

        Phase = to;
        return true;
    }
}
