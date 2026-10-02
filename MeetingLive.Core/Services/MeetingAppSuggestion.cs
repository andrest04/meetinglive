namespace MeetingLive.Core.Services;

public static class MeetingAppSuggestion
{
    /// <summary>
    /// The meeting app worth suggesting, or null. Only while all system audio is selected, only for known meeting apps
    /// that are playing audio, and never for a process id the user already dismissed. The loudest wins; ties go by name.
    /// </summary>
    public static ActiveAudioApp? Pick(
        IReadOnlyList<ActiveAudioApp> active,
        bool systemAudioSelected,
        IReadOnlySet<uint> dismissedProcessIds)
    {
        if (!systemAudioSelected)
            return null;

        return active
            .Where(app => app.IsKnownMeetingApp && !dismissedProcessIds.Contains(app.ProcessId))
            .OrderByDescending(app => app.Peak)
            .ThenBy(app => app.FriendlyName, StringComparer.CurrentCultureIgnoreCase)
            .FirstOrDefault();
    }
}
