using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class WindowsProcessInfoProviderTests
{
    [Fact]
    public void GetProcess_CurrentProcess_ReturnsImagePathParentAndStartTime()
    {
        var provider = new WindowsProcessInfoProvider();

        var details = provider.GetProcess((uint)Environment.ProcessId);

        Assert.NotNull(details);
        Assert.Equal(Environment.ProcessPath, details.ExePath, ignoreCase: true);
        Assert.NotEqual(0u, details.ParentProcessId);
        Assert.NotNull(details.StartTimeUtc);
        Assert.True(details.StartTimeUtc <= DateTime.UtcNow);
    }

    [Fact]
    public void GetProcess_ParentOfCurrentProcess_IsStartedBeforeChild()
    {
        var provider = new WindowsProcessInfoProvider();
        var child = provider.GetProcess((uint)Environment.ProcessId);

        var parent = provider.GetProcess(child!.ParentProcessId);

        // The parent may have exited (pid reuse is handled by the start-time guard), so only assert when found.
        if (parent?.StartTimeUtc is { } parentStart)
            Assert.True(parentStart <= child.StartTimeUtc);
    }

    [Fact]
    public void GetProcess_ZeroPid_ReturnsNull()
    {
        Assert.Null(new WindowsProcessInfoProvider().GetProcess(0));
    }

    [Fact]
    public void GetVersionInfo_MissingFile_ReturnsNull()
    {
        Assert.Null(new WindowsProcessInfoProvider().GetVersionInfo(@"C:\does-not-exist\nope.exe"));
    }
}
