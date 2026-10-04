using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveCopilotRecordingHandoffTests
{
    [Fact]
    public void Decide_WhenRecordingStarts_MinimizesAndShowsHint()
    {
        var decision = LiveCopilotRecordingHandoff.Decide(wasRecording: false, isRecording: true);

        Assert.True(decision.MinimizeMainWindow);
        Assert.True(decision.ShowStartedHint);
    }

    [Fact]
    public void Decide_WhenAlreadyRecording_DoesNotHandoff()
    {
        var decision = LiveCopilotRecordingHandoff.Decide(wasRecording: true, isRecording: true);

        Assert.False(decision.MinimizeMainWindow);
        Assert.False(decision.ShowStartedHint);
    }

    [Fact]
    public void Decide_WhenRecordingStops_DoesNotHandoff()
    {
        var decision = LiveCopilotRecordingHandoff.Decide(wasRecording: true, isRecording: false);

        Assert.False(decision.MinimizeMainWindow);
        Assert.False(decision.ShowStartedHint);
    }

    [Fact]
    public void Decide_WhenIdle_DoesNotHandoff()
    {
        var decision = LiveCopilotRecordingHandoff.Decide(wasRecording: false, isRecording: false);

        Assert.False(decision.MinimizeMainWindow);
        Assert.False(decision.ShowStartedHint);
    }

    [Fact]
    public void ShouldShowPill_OnHandoffWhileMainWindowStillActive_IsTrue()
    {
        var show = LiveCopilotRecordingHandoff.ShouldShowPill(
            isRecording: true, mainWindowActive: true, handingOff: true);

        Assert.True(show);
    }

    [Fact]
    public void ShouldShowPill_WhenRecordingAndMainWindowActive_IsFalse()
    {
        var show = LiveCopilotRecordingHandoff.ShouldShowPill(
            isRecording: true, mainWindowActive: true, handingOff: false);

        Assert.False(show);
    }

    [Fact]
    public void ShouldShowPill_WhenRecordingAndMainWindowInactive_IsTrue()
    {
        var show = LiveCopilotRecordingHandoff.ShouldShowPill(
            isRecording: true, mainWindowActive: false, handingOff: false);

        Assert.True(show);
    }

    [Fact]
    public void ShouldShowPill_WhenNotRecording_IsFalse()
    {
        var show = LiveCopilotRecordingHandoff.ShouldShowPill(
            isRecording: false, mainWindowActive: false, handingOff: true);

        Assert.False(show);
    }

    [Fact]
    public void StartedHintDuration_IsTwoAndAHalfSeconds()
    {
        Assert.Equal(TimeSpan.FromMilliseconds(2500), LiveCopilotRecordingHandoff.StartedHintDuration);
    }
}
