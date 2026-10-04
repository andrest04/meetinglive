namespace MeetingLive.Core.Services;

/// <summary>
/// Pure decision for the meeting-detected popup: show it once per meeting, only when the user left
/// it on and nothing is being recorded.
/// </summary>
public static class MeetingPopupPolicy
{
    public static bool ShouldShow(bool popupEnabled, bool captureActive, bool alreadyPrompted) =>
        popupEnabled && !captureActive && !alreadyPrompted;
}
