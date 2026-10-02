using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingAppSuggestionTests
{
    private static readonly IReadOnlySet<uint> NoneDismissed = new HashSet<uint>();

    private static ActiveAudioApp App(uint pid, string name, bool meeting, float peak = 0.2f, bool browser = false) =>
        new(pid, $@"C:\Apps\{name}.exe", name, browser, meeting, peak);

    [Fact]
    public void Pick_MeetingAppPlaying_IsSuggested()
    {
        var zoom = App(2, "Zoom", meeting: true);

        var pick = MeetingAppSuggestion.Pick([App(1, "Spotify", meeting: false), zoom], systemAudioSelected: true, NoneDismissed);

        Assert.Same(zoom, pick);
    }

    [Fact]
    public void Pick_AnAppIsAlreadySelected_IsNull()
    {
        var pick = MeetingAppSuggestion.Pick([App(2, "Zoom", meeting: true)], systemAudioSelected: false, NoneDismissed);

        Assert.Null(pick);
    }

    [Fact]
    public void Pick_NoMeetingApp_IsNull()
    {
        var pick = MeetingAppSuggestion.Pick([App(1, "Spotify", meeting: false), App(3, "Chrome", meeting: false, browser: true)],
            systemAudioSelected: true, NoneDismissed);

        Assert.Null(pick);
    }

    [Fact]
    public void Pick_DismissedProcess_IsSkipped()
    {
        var pick = MeetingAppSuggestion.Pick([App(2, "Zoom", meeting: true)], systemAudioSelected: true, new HashSet<uint> { 2 });

        Assert.Null(pick);
    }

    [Fact]
    public void Pick_DismissedProcessDoesNotHideAnotherMeetingApp()
    {
        var teams = App(5, "Teams", meeting: true);

        var pick = MeetingAppSuggestion.Pick([App(2, "Zoom", meeting: true), teams], systemAudioSelected: true, new HashSet<uint> { 2 });

        Assert.Same(teams, pick);
    }

    [Fact]
    public void Pick_SeveralMeetingApps_LoudestWins()
    {
        var loud = App(5, "Teams", meeting: true, peak: 0.6f);

        var pick = MeetingAppSuggestion.Pick([App(2, "Zoom", meeting: true, peak: 0.1f), loud], systemAudioSelected: true, NoneDismissed);

        Assert.Same(loud, pick);
    }

    [Fact]
    public void Pick_EqualLoudness_FirstByNameWins()
    {
        var slack = App(3, "Slack", meeting: true, peak: 0.3f);

        var pick = MeetingAppSuggestion.Pick([App(2, "Zoom", meeting: true, peak: 0.3f), slack], systemAudioSelected: true, NoneDismissed);

        Assert.Same(slack, pick);
    }

    [Fact]
    public void Pick_EmptyList_IsNull()
    {
        Assert.Null(MeetingAppSuggestion.Pick([], systemAudioSelected: true, NoneDismissed));
    }
}
