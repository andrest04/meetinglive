using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ActiveAppEntriesTests
{
    private static ActiveAudioApp App(uint pid, string name, string? exe = null) =>
        new(pid, exe ?? $@"C:\Apps\{name}.exe", name, IsBrowser: false, IsKnownMeetingApp: false, Peak: 0.1f);

    [Fact]
    public void Merge_NothingSelected_ReturnsAllAvailable()
    {
        var entries = ActiveAppEntries.Merge([App(1, "Chrome"), App(2, "Zoom")], selected: null);

        Assert.Equal([1u, 2u], entries.Select(e => e.App.ProcessId));
        Assert.All(entries, e => Assert.True(e.IsAvailable));
    }

    [Fact]
    public void Merge_SelectedStillPlaying_StaysAvailableWithoutDuplicate()
    {
        var zoom = App(2, "Zoom");

        var entries = ActiveAppEntries.Merge([App(1, "Chrome"), zoom], selected: zoom with { Peak = 0f });

        Assert.Equal(2, entries.Count);
        Assert.True(entries.Single(e => e.App.ProcessId == 2).IsAvailable);
    }

    [Fact]
    public void Merge_SelectedStoppedPlaying_IsKeptAsUnavailable()
    {
        var zoom = App(2, "Zoom");

        var entries = ActiveAppEntries.Merge([App(1, "Chrome")], selected: zoom);

        var kept = Assert.Single(entries, e => e.App.ProcessId == 2);
        Assert.False(kept.IsAvailable);
        Assert.True(entries.Single(e => e.App.ProcessId == 1).IsAvailable);
    }

    [Fact]
    public void Merge_UnavailableSelected_IsInsertedInNameOrder()
    {
        var entries = ActiveAppEntries.Merge([App(1, "Chrome"), App(3, "Spotify")], selected: App(2, "Slack"));

        Assert.Equal(["Chrome", "Slack", "Spotify"], entries.Select(e => e.App.FriendlyName));
    }

    [Fact]
    public void Merge_NothingPlayingAndNothingSelected_IsEmpty()
    {
        Assert.Empty(ActiveAppEntries.Merge([], selected: null));
    }

    [Fact]
    public void IsStillRunning_ProcessGone_IsFalse()
    {
        var processes = new FakeProcesses();

        Assert.False(ActiveAppEntries.IsStillRunning(App(7, "Zoom"), processes));
    }

    [Fact]
    public void IsStillRunning_SameImage_IsTrue()
    {
        var processes = new FakeProcesses().With(7, @"C:\Apps\Zoom.exe");

        Assert.True(ActiveAppEntries.IsStillRunning(App(7, "Zoom"), processes));
    }

    [Fact]
    public void IsStillRunning_PidReusedByAnotherImage_IsFalse()
    {
        var processes = new FakeProcesses().With(7, @"C:\Other\notepad.exe");

        Assert.False(ActiveAppEntries.IsStillRunning(App(7, "Zoom"), processes));
    }

    [Fact]
    public void IsStillRunning_ImagePathUnreadable_TrustsTheExistingProcess()
    {
        var processes = new FakeProcesses().With(7, exePath: null);

        Assert.True(ActiveAppEntries.IsStillRunning(App(7, "Zoom"), processes));
    }

    private sealed class FakeProcesses : IProcessInfoProvider
    {
        private readonly Dictionary<uint, ProcessDetails> _byPid = new();

        public FakeProcesses With(uint pid, string? exePath)
        {
            _byPid[pid] = new ProcessDetails(pid, 0, exePath, "proc", null);
            return this;
        }

        public ProcessDetails? GetProcess(uint processId) => _byPid.GetValueOrDefault(processId);

        public AppVersionInfo? GetVersionInfo(string exePath) => null;
    }
}
