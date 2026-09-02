using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>Enumerates visible top-level windows and asks <see cref="MeetingCallDetector"/>.</summary>
internal static class MeetingWindowScanner
{
    public static bool AnyMeetingWindow()
    {
        var found = false;
        EnumWindows((hWnd, _) =>
        {
            if (found || !IsWindowVisible(hWnd))
                return true;

            var length = GetWindowTextLength(hWnd);
            if (length <= 0)
                return true;

            var title = new StringBuilder(length + 1);
            _ = GetWindowText(hWnd, title, title.Capacity);
            GetWindowThreadProcessId(hWnd, out var processId);
            if (processId == 0)
                return true;

            try
            {
                using var process = Process.GetProcessById((int)processId);
                if (MeetingCallDetector.IsMeeting(process.ProcessName, title.ToString()))
                    found = true;
            }
            catch (ArgumentException)
            {
                // Process exited between EnumWindows and GetProcessById.
            }
            catch (InvalidOperationException)
            {
            }

            return !found;
        }, 0);

        return found;
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
