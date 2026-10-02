namespace MeetingLive.Core.Services;

/// <summary>One audio session on the default render endpoint, already reduced to what the grouping logic needs.</summary>
public readonly record struct AudioSessionSnapshot(uint ProcessId, bool IsSystemSounds, bool IsStateActive, float Peak);

/// <summary>Reads audio sessions of the default render device. The Windows-bound part lives behind this.</summary>
public interface IAudioSessionSource
{
    /// <summary>Re-enumerates sessions (picks up new ones) and caches them for <see cref="ReadPeaks"/>.</summary>
    IReadOnlyList<AudioSessionSnapshot> Enumerate();

    /// <summary>Cheap: current peak (0..1) per session process id, using the sessions cached by the last <see cref="Enumerate"/>.</summary>
    IReadOnlyDictionary<uint, float> ReadPeaks();
}

/// <summary>Process facts needed to roll a session up to its app. <see cref="ExePath"/> is null when access is denied.</summary>
public sealed record ProcessDetails(
    uint ProcessId,
    uint ParentProcessId,
    string? ExePath,
    string ProcessName,
    DateTime? StartTimeUtc);

public sealed record AppVersionInfo(string? FileDescription, string? ProductName);

public interface IProcessInfoProvider
{
    /// <summary>Null when the process no longer exists or cannot be inspected at all.</summary>
    ProcessDetails? GetProcess(uint processId);

    AppVersionInfo? GetVersionInfo(string exePath);
}

/// <summary>
/// One app instance that is producing audio. <see cref="ProcessId"/> is the root of the app's process tree,
/// which is what process-tree capture needs. <see cref="ExePath"/> is null when it could not be read.
/// </summary>
public sealed record ActiveAudioApp(
    uint ProcessId,
    string? ExePath,
    string FriendlyName,
    bool IsBrowser,
    bool IsKnownMeetingApp,
    float Peak);

public interface IActiveAudioAppService
{
    /// <summary>Full enumeration: one entry per app instance with an active audio session.</summary>
    IReadOnlyList<ActiveAudioApp> Refresh();

    /// <summary>Latest peak (0..1) per app root pid from the last <see cref="Refresh"/>, without re-enumerating.</summary>
    IReadOnlyDictionary<uint, float> ReadPeaks();
}

public sealed class ActiveAudioAppService : IActiveAudioAppService
{
    private const int MaxParentDepth = 32;

    private static readonly HashSet<string> ExcludedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "ApplicationFrameHost", "TextInputHost", "SystemSettings", "explorer", "ShellExperienceHost",
        "StartMenuExperienceHost", "SearchHost", "LockApp", "dwm", "audiodg",
    };

    private static readonly HashSet<string> Browsers = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc",
    };

    // Browsers are not listed: whether a browser is in a call depends on its window title (MeetingCallDetector).
    private static readonly HashSet<string> MeetingApps = new(StringComparer.OrdinalIgnoreCase)
    {
        "zoom", "teams", "ms-teams", "webex", "webexmta", "slack", "discord", "skype", "cpthost",
    };

    private readonly IAudioSessionSource _sessions;
    private readonly IProcessInfoProvider _processes;
    private readonly uint _excludedProcessId;
    private readonly float _activePeakThreshold;
    private Dictionary<uint, uint> _rootBySessionPid = new();

    public ActiveAudioAppService(
        IAudioSessionSource sessions,
        IProcessInfoProvider processes,
        uint excludedProcessId,
        float activePeakThreshold = 0.001f)
    {
        _sessions = sessions;
        _processes = processes;
        _excludedProcessId = excludedProcessId;
        _activePeakThreshold = activePeakThreshold;
    }

    public IReadOnlyList<ActiveAudioApp> Refresh()
    {
        var rootBySessionPid = new Dictionary<uint, uint>();
        var rootInfo = new Dictionary<uint, ProcessDetails>();
        var peakByRoot = new Dictionary<uint, float>();

        foreach (var session in _sessions.Enumerate())
        {
            if (session.IsSystemSounds || session.ProcessId == 0)
                continue;

            var isActive = session.IsStateActive || session.Peak > _activePeakThreshold;
            if (!isActive)
                continue;

            if (_processes.GetProcess(session.ProcessId) is not { } process)
                continue;

            var root = FindRoot(process);
            if (IsExcluded(process) || IsExcluded(root))
                continue;

            rootBySessionPid[session.ProcessId] = root.ProcessId;
            rootInfo[root.ProcessId] = root;
            peakByRoot[root.ProcessId] = Math.Max(peakByRoot.GetValueOrDefault(root.ProcessId), session.Peak);
        }

        _rootBySessionPid = rootBySessionPid;

        return rootInfo.Values
            .Select(root => ToApp(root, peakByRoot[root.ProcessId]))
            .OrderBy(app => app.FriendlyName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(app => app.ProcessId)
            .ToList();
    }

    public IReadOnlyDictionary<uint, float> ReadPeaks()
    {
        var result = new Dictionary<uint, float>();
        var map = _rootBySessionPid;
        if (map.Count == 0)
            return result;

        foreach (var (sessionPid, peak) in _sessions.ReadPeaks())
        {
            if (!map.TryGetValue(sessionPid, out var root))
                continue;

            result[root] = Math.Max(result.GetValueOrDefault(root), peak);
        }

        return result;
    }

    /// <summary>Walks up while the parent runs the same executable image (chrome utility process to chrome.exe).</summary>
    private ProcessDetails FindRoot(ProcessDetails start)
    {
        var current = start;
        var seen = new HashSet<uint> { current.ProcessId };

        for (var depth = 0; depth < MaxParentDepth; depth++)
        {
            if (current.ExePath is null
                || current.ParentProcessId == 0
                || !seen.Add(current.ParentProcessId)
                || _processes.GetProcess(current.ParentProcessId) is not { } parent
                || !string.Equals(parent.ExePath, current.ExePath, StringComparison.OrdinalIgnoreCase)
                || IsParentReusedPid(parent, current))
            {
                break;
            }

            current = parent;
        }

        return current;
    }

    // A recycled parent pid belongs to a process that started after the child.
    private static bool IsParentReusedPid(ProcessDetails parent, ProcessDetails child) =>
        parent.StartTimeUtc is { } parentStart && child.StartTimeUtc is { } childStart && parentStart > childStart;

    private bool IsExcluded(ProcessDetails process) =>
        process.ProcessId == _excludedProcessId || ExcludedHosts.Contains(ExecutableName(process));

    private ActiveAudioApp ToApp(ProcessDetails root, float peak)
    {
        var exeName = ExecutableName(root);
        return new ActiveAudioApp(
            root.ProcessId,
            root.ExePath,
            FriendlyName(root),
            Browsers.Contains(exeName),
            MeetingApps.Contains(exeName),
            peak);
    }

    private string FriendlyName(ProcessDetails root)
    {
        if (root.ExePath is not null && _processes.GetVersionInfo(root.ExePath) is { } info)
        {
            if (!string.IsNullOrWhiteSpace(info.FileDescription))
                return info.FileDescription.Trim();

            if (!string.IsNullOrWhiteSpace(info.ProductName))
                return info.ProductName.Trim();
        }

        return root.ProcessName;
    }

    private static string ExecutableName(ProcessDetails process) =>
        process.ExePath is { Length: > 0 } path
            ? Path.GetFileNameWithoutExtension(path)
            : process.ProcessName;
}
