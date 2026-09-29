using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// Visible top-level windows collapsed to one row per process id.
/// Capture later includes that process and its children, not one window.
/// </summary>
internal static class RecordingAppEnumerator
{
    public static IReadOnlyList<RecordingAppWindow> ListOpenApps(uint excludeProcessId)
    {
        var windows = new List<RecordingAppWindow>();
        EnumWindows((hWnd, _) =>
        {
            try
            {
                CollectWindow(hWnd, excludeProcessId, windows);
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                // Process exited, or we cannot open it. Skip the window.
            }

            return true;
        }, 0);

        return windows
            .GroupBy(window => window.ProcessId)
            .Select(ChooseTitle)
            .OrderBy(window => window.ProcessName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(window => window.WindowTitle, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    private static void CollectWindow(nint hWnd, uint excludeProcessId, List<RecordingAppWindow> windows)
    {
        if (!IsWindowVisible(hWnd))
            return;

        var length = GetWindowTextLength(hWnd);
        if (length <= 0)
            return;

        var titleBuilder = new StringBuilder(length + 1);
        _ = GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
        var title = titleBuilder.ToString().Trim();
        if (title.Length == 0)
            return;

        GetWindowThreadProcessId(hWnd, out var processId);
        if (processId == 0 || processId == excludeProcessId || processId > int.MaxValue)
            return;

        using var process = Process.GetProcessById((int)processId);
        var name = process.ProcessName;
        if (string.IsNullOrWhiteSpace(name))
            return;

        windows.Add(new RecordingAppWindow(processId, name, title));
    }

    /// <summary>
    /// Prefer a title <see cref="MeetingCallDetector.IsMeeting"/> would accept.
    /// Otherwise keep the first non-empty title for that process.
    /// </summary>
    private static RecordingAppWindow ChooseTitle(IGrouping<uint, RecordingAppWindow> group)
    {
        var name = group.First().ProcessName;
        RecordingAppWindow? preferred = null;
        RecordingAppWindow? first = null;
        foreach (var window in group)
        {
            first ??= window;
            if (preferred is null && MeetingCallDetector.IsMeeting(name, window.WindowTitle))
                preferred = window;
        }

        return preferred ?? first ?? group.First();
    }

    private delegate bool EnumWindowsProc(nint hWnd, nint lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(nint hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);
}

internal readonly record struct RecordingAppWindow(uint ProcessId, string ProcessName, string WindowTitle);
