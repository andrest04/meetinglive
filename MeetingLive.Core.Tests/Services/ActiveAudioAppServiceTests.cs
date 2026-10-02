using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ActiveAudioAppServiceTests
{
    private const uint OwnPid = 999;

    [Fact]
    public void Refresh_ChildAudioProcess_RollsUpToRootWithSameImage()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Chrome\chrome.exe", "chrome")
            .Process(200, 100, @"C:\Chrome\chrome.exe", "chrome")
            .Process(300, 200, @"C:\Chrome\chrome.exe", "chrome")
            .Process(1, 0, @"C:\Windows\explorer.exe", "explorer")
            .Session(300, active: true, peak: 0.4f);

        var apps = fake.Service().Refresh();

        var app = Assert.Single(apps);
        Assert.Equal(100u, app.ProcessId);
        Assert.Equal(@"C:\Chrome\chrome.exe", app.ExePath);
    }

    [Fact]
    public void Refresh_ParentWithDifferentImage_StopsAtChild()
    {
        var fake = new Fixture()
            .Process(10, 0, @"C:\Apps\launcher.exe", "launcher")
            .Process(20, 10, @"C:\Apps\player.exe", "player")
            .Session(20, active: true, peak: 0.2f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(20u, app.ProcessId);
    }

    [Fact]
    public void Refresh_ParentStartedAfterChild_IsTreatedAsReusedPid()
    {
        var t = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var fake = new Fixture()
            .Process(10, 0, @"C:\Apps\app.exe", "app", t.AddMinutes(5))
            .Process(20, 10, @"C:\Apps\app.exe", "app", t)
            .Session(20, active: true, peak: 0.2f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(20u, app.ProcessId);
    }

    [Fact]
    public void Refresh_MissingParent_StopsAtChild()
    {
        var fake = new Fixture()
            .Process(20, 77, @"C:\Apps\app.exe", "app")
            .Session(20, active: true, peak: 0.2f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(20u, app.ProcessId);
    }

    [Fact]
    public void Refresh_ParentCycle_Terminates()
    {
        var fake = new Fixture()
            .Process(10, 20, @"C:\Apps\app.exe", "app")
            .Process(20, 10, @"C:\Apps\app.exe", "app")
            .Session(10, active: true, peak: 0.2f);

        var apps = fake.Service().Refresh();

        Assert.Single(apps);
    }

    [Fact]
    public void Refresh_TwoSessionsSameRoot_AreOneEntryWithMaxPeak()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Chrome\chrome.exe", "chrome")
            .Process(200, 100, @"C:\Chrome\chrome.exe", "chrome")
            .Session(100, active: true, peak: 0.1f)
            .Session(200, active: true, peak: 0.6f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(0.6f, app.Peak);
    }

    [Fact]
    public void Refresh_TwoRootsSameExeBothPlaying_AreSeparateEntries()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Process(500, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0.1f)
            .Session(500, active: true, peak: 0.1f);

        var apps = fake.Service().Refresh();

        Assert.Equal(new uint[] { 100, 500 }, apps.Select(a => a.ProcessId).OrderBy(p => p));
    }

    [Fact]
    public void Refresh_TwoRootsSameExeOnlyOnePlaying_KeepsOnlyPlaying()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Process(500, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0.1f)
            .Session(500, active: false, peak: 0f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(100u, app.ProcessId);
    }

    [Fact]
    public void Refresh_InactiveSilentSession_IsExcluded()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: false, peak: 0f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_InactiveSessionWithPeakAboveThreshold_IsIncluded()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: false, peak: 0.05f);

        Assert.Single(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_ActiveSessionWithZeroPeak_IsIncluded()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0f);

        Assert.Single(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_InactiveSessionWithPeakBelowThreshold_IsExcluded()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: false, peak: 0.0001f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_SystemSoundsSession_IsExcluded()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0.5f, systemSounds: true);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_OwnProcessTree_IsExcluded()
    {
        var fake = new Fixture()
            .Process(OwnPid, 1, @"C:\Apps\MeetingLive.exe", "MeetingLive")
            .Session(OwnPid, active: true, peak: 0.5f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Theory]
    [InlineData("ApplicationFrameHost")]
    [InlineData("TextInputHost")]
    [InlineData("SystemSettings")]
    [InlineData("explorer")]
    [InlineData("ShellExperienceHost")]
    [InlineData("StartMenuExperienceHost")]
    [InlineData("SearchHost")]
    [InlineData("LockApp")]
    [InlineData("dwm")]
    [InlineData("audiodg")]
    public void Refresh_ShellAndSystemHosts_AreAlwaysExcluded(string name)
    {
        var fake = new Fixture()
            .Process(100, 1, $@"C:\Windows\{name}.exe", name)
            .Session(100, active: true, peak: 0.5f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_UnresolvableProcess_IsSkipped()
    {
        var fake = new Fixture().Session(4242, active: true, peak: 0.5f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_ZeroProcessId_IsSkipped()
    {
        var fake = new Fixture()
            .Process(0, 0, @"C:\Apps\app.exe", "app")
            .Session(0, active: true, peak: 0.5f);

        Assert.Empty(fake.Service().Refresh());
    }

    [Fact]
    public void Refresh_AccessDeniedExePath_FallsBackToProcessNameAndNoRollUp()
    {
        var fake = new Fixture()
            .Process(10, 0, @"C:\Apps\app.exe", "app")
            .Process(20, 10, null, "app")
            .Session(20, active: true, peak: 0.5f);

        var app = Assert.Single(fake.Service().Refresh());

        Assert.Equal(20u, app.ProcessId);
        Assert.Null(app.ExePath);
        Assert.Equal("app", app.FriendlyName);
    }

    [Fact]
    public void Refresh_FriendlyName_PrefersFileDescription()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\zoom.exe", "Zoom")
            .Version(@"C:\Apps\zoom.exe", "  Zoom Workplace ", "Zoom")
            .Session(100, active: true, peak: 0.5f);

        Assert.Equal("Zoom Workplace", Assert.Single(fake.Service().Refresh()).FriendlyName);
    }

    [Fact]
    public void Refresh_FriendlyName_FallsBackToProductName()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\x.exe", "x")
            .Version(@"C:\Apps\x.exe", " ", "Product X")
            .Session(100, active: true, peak: 0.5f);

        Assert.Equal("Product X", Assert.Single(fake.Service().Refresh()).FriendlyName);
    }

    [Fact]
    public void Refresh_FriendlyName_FallsBackToProcessName()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\x.exe", "x")
            .Session(100, active: true, peak: 0.5f);

        Assert.Equal("x", Assert.Single(fake.Service().Refresh()).FriendlyName);
    }

    [Theory]
    [InlineData("chrome", true)]
    [InlineData("msedge", true)]
    [InlineData("firefox", true)]
    [InlineData("brave", true)]
    [InlineData("opera", true)]
    [InlineData("vivaldi", true)]
    [InlineData("arc", true)]
    [InlineData("CHROME", true)]
    [InlineData("zoom", false)]
    public void Refresh_IsBrowser_ByExecutableName(string exe, bool expected)
    {
        var fake = new Fixture()
            .Process(100, 1, $@"C:\Apps\{exe}.exe", exe)
            .Session(100, active: true, peak: 0.5f);

        Assert.Equal(expected, Assert.Single(fake.Service().Refresh()).IsBrowser);
    }

    [Theory]
    [InlineData("Zoom", true)]
    [InlineData("ms-teams", true)]
    [InlineData("Teams", true)]
    [InlineData("webex", true)]
    [InlineData("slack", true)]
    [InlineData("Discord", true)]
    [InlineData("skype", true)]
    [InlineData("chrome", false)]
    [InlineData("spotify", false)]
    public void Refresh_IsKnownMeetingApp_ByExecutableName(string exe, bool expected)
    {
        var fake = new Fixture()
            .Process(100, 1, $@"C:\Apps\{exe}.exe", exe)
            .Session(100, active: true, peak: 0.5f);

        Assert.Equal(expected, Assert.Single(fake.Service().Refresh()).IsKnownMeetingApp);
    }

    [Fact]
    public void Refresh_OrdersByFriendlyName()
    {
        var fake = new Fixture()
            .Process(1000, 1, @"C:\Apps\b.exe", "b")
            .Process(2000, 1, @"C:\Apps\a.exe", "a")
            .Session(1000, active: true, peak: 0.1f)
            .Session(2000, active: true, peak: 0.1f);

        Assert.Equal(new[] { "a", "b" }, fake.Service().Refresh().Select(a => a.FriendlyName));
    }

    [Fact]
    public void Refresh_ReportsPeakOnEntry()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0.37f);

        Assert.Equal(0.37f, Assert.Single(fake.Service().Refresh()).Peak);
    }

    [Fact]
    public void ReadPeaks_ReturnsLatestPeakPerRootWithoutReEnumerating()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Chrome\chrome.exe", "chrome")
            .Process(200, 100, @"C:\Chrome\chrome.exe", "chrome")
            .Session(200, active: true, peak: 0.1f);
        var service = fake.Service();
        service.Refresh();
        fake.Source.Peaks[200] = 0.8f;
        fake.Source.EnumerateCalls = 0;

        var peaks = service.ReadPeaks();

        Assert.Equal(0.8f, peaks[100]);
        Assert.Equal(0, fake.Source.EnumerateCalls);
    }

    [Fact]
    public void ReadPeaks_BeforeRefresh_IsEmpty()
    {
        var fake = new Fixture();

        Assert.Empty(fake.Service().ReadPeaks());
    }

    [Fact]
    public void ReadPeaks_IgnoresSessionsNotMappedToAnApp()
    {
        var fake = new Fixture()
            .Process(100, 1, @"C:\Apps\app.exe", "app")
            .Session(100, active: true, peak: 0.1f);
        var service = fake.Service();
        service.Refresh();
        fake.Source.Peaks[555] = 0.9f;

        Assert.Equal(new uint[] { 100 }, service.ReadPeaks().Keys);
    }

    private sealed class Fixture
    {
        public FakeSource Source { get; } = new();
        private readonly FakeProcesses _processes = new();

        public Fixture Process(uint pid, uint parent, string? exe, string name, DateTime? start = null)
        {
            _processes.Details[pid] = new ProcessDetails(pid, parent, exe, name, start);
            return this;
        }

        public Fixture Version(string exe, string? description, string? product)
        {
            _processes.Versions[exe] = new AppVersionInfo(description, product);
            return this;
        }

        public Fixture Session(uint pid, bool active, float peak, bool systemSounds = false)
        {
            Source.Sessions.Add(new AudioSessionSnapshot(pid, systemSounds, active, peak));
            Source.Peaks[pid] = peak;
            return this;
        }

        public ActiveAudioAppService Service() => new(Source, _processes, OwnPid);
    }

    private sealed class FakeSource : IAudioSessionSource
    {
        public List<AudioSessionSnapshot> Sessions { get; } = new();
        public Dictionary<uint, float> Peaks { get; } = new();
        public int EnumerateCalls { get; set; }

        public IReadOnlyList<AudioSessionSnapshot> Enumerate()
        {
            EnumerateCalls++;
            return Sessions;
        }

        public IReadOnlyDictionary<uint, float> ReadPeaks() => Peaks;
    }

    private sealed class FakeProcesses : IProcessInfoProvider
    {
        public Dictionary<uint, ProcessDetails> Details { get; } = new();
        public Dictionary<string, AppVersionInfo> Versions { get; } = new(StringComparer.OrdinalIgnoreCase);

        public ProcessDetails? GetProcess(uint processId) =>
            Details.TryGetValue(processId, out var d) ? d : null;

        public AppVersionInfo? GetVersionInfo(string exePath) =>
            Versions.TryGetValue(exePath, out var v) ? v : null;
    }
}
