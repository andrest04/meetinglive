namespace MeetingLive.Core.Services;

/// <summary>One app card in the picker: <see cref="IsAvailable"/> is false when the app stopped playing but stays selected.</summary>
public sealed record ActiveAppEntry(ActiveAudioApp App, bool IsAvailable);

public static class ActiveAppEntries
{
    /// <summary>
    /// The picker list for the current enumeration. A selected app that is no longer playing is kept (unavailable)
    /// so a brief pause does not drop the user's choice.
    /// </summary>
    public static IReadOnlyList<ActiveAppEntry> Merge(IReadOnlyList<ActiveAudioApp> active, ActiveAudioApp? selected)
    {
        var entries = active.Select(app => new ActiveAppEntry(app, IsAvailable: true)).ToList();
        if (selected is null || active.Any(app => app.ProcessId == selected.ProcessId))
            return entries;

        var index = entries.FindIndex(entry =>
            StringComparer.CurrentCultureIgnoreCase.Compare(entry.App.FriendlyName, selected.FriendlyName) > 0);
        entries.Insert(index < 0 ? entries.Count : index, new ActiveAppEntry(selected, IsAvailable: false));
        return entries;
    }

    /// <summary>
    /// True when the process still exists. When both paths are known they must match, which rejects a reused pid.
    /// </summary>
    public static bool IsStillRunning(ActiveAudioApp app, IProcessInfoProvider processes)
    {
        if (processes.GetProcess(app.ProcessId) is not { } details)
            return false;

        if (app.ExePath is null || details.ExePath is null)
            return true;

        return string.Equals(app.ExePath, details.ExePath, StringComparison.OrdinalIgnoreCase);
    }
}
