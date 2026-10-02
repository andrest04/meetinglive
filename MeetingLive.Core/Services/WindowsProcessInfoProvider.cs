using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace MeetingLive.Core.Services;

/// <summary>
/// Reads parent pid, image path and start time with <c>PROCESS_QUERY_LIMITED_INFORMATION</c>, which works for
/// most processes without elevation. Falls back to the process name when the handle cannot be opened.
/// </summary>
public sealed class WindowsProcessInfoProvider : IProcessInfoProvider
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int ProcessBasicInformationClass = 0;

    public ProcessDetails? GetProcess(uint processId)
    {
        if (processId == 0)
            return null;

        using var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle.IsInvalid)
            return FallbackByName(processId);

        var exePath = QueryImagePath(handle);
        var parent = QueryParentProcessId(handle);
        var start = QueryStartTimeUtc(handle);
        var name = exePath is null ? NameOf(processId) : Path.GetFileNameWithoutExtension(exePath);
        return name is null ? null : new ProcessDetails(processId, parent, exePath, name, start);
    }

    public AppVersionInfo? GetVersionInfo(string exePath)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(exePath);
            return new AppVersionInfo(info.FileDescription, info.ProductName);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
    }

    private static ProcessDetails? FallbackByName(uint processId)
    {
        var name = NameOf(processId);
        return name is null ? null : new ProcessDetails(processId, 0, null, name, null);
    }

    private static string? NameOf(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or Win32Exception)
        {
            return null;
        }
    }

    private static string? QueryImagePath(SafeProcessHandle handle)
    {
        var buffer = new StringBuilder(1024);
        var size = (uint)buffer.Capacity;
        return QueryFullProcessImageNameW(handle, 0, buffer, ref size) ? buffer.ToString(0, (int)size) : null;
    }

    private static uint QueryParentProcessId(SafeProcessHandle handle)
    {
        var info = new ProcessBasicInformation();
        var status = NtQueryInformationProcess(
            handle, ProcessBasicInformationClass, ref info, (uint)Marshal.SizeOf<ProcessBasicInformation>(), out _);
        return status == 0 ? (uint)info.InheritedFromUniqueProcessId : 0;
    }

    private static DateTime? QueryStartTimeUtc(SafeProcessHandle handle)
    {
        if (!GetProcessTimes(handle, out var creation, out _, out _, out _))
            return null;

        var ticks = ((long)creation.dwHighDateTime << 32) | (uint)creation.dwLowDateTime;
        return ticks > 0 ? DateTime.FromFileTimeUtc(ticks) : null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public nint ExitStatus;
        public nint PebBaseAddress;
        public nint AffinityMask;
        public nint BasePriority;
        public nint UniqueProcessId;
        public nint InheritedFromUniqueProcessId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(
        uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(
        SafeProcessHandle hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(
        SafeProcessHandle hProcess,
        out System.Runtime.InteropServices.ComTypes.FILETIME lpCreationTime,
        out System.Runtime.InteropServices.ComTypes.FILETIME lpExitTime,
        out System.Runtime.InteropServices.ComTypes.FILETIME lpKernelTime,
        out System.Runtime.InteropServices.ComTypes.FILETIME lpUserTime);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        SafeProcessHandle processHandle,
        int processInformationClass,
        ref ProcessBasicInformation processInformation,
        uint processInformationLength,
        out uint returnLength);
}
