namespace MeetingLive.Core.Services;

public readonly record struct LiveCopilotRecordingHandoffDecision(bool MinimizeMainWindow, bool ShowStartedHint);

public static class LiveCopilotRecordingHandoff
{
    public static readonly TimeSpan StartedHintDuration = TimeSpan.FromMilliseconds(2500);

    public static LiveCopilotRecordingHandoffDecision Decide(bool wasRecording, bool isRecording) =>
        new(MinimizeMainWindow: !wasRecording && isRecording, ShowStartedHint: !wasRecording && isRecording);

    /// <summary>
    /// Visible while recording and the main window is not active, or immediately on the start handoff
    /// even if deactivation has not been observed yet.
    /// </summary>
    public static bool ShouldShowPill(bool isRecording, bool mainWindowActive, bool handingOff) =>
        isRecording && (!mainWindowActive || handingOff);
}
