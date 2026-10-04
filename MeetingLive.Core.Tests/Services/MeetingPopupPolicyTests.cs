using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingPopupPolicyTests
{
    [Fact]
    public void ShouldShow_WhenEnabledIdleAndNotYetPrompted_ReturnsTrue()
    {
        Assert.True(MeetingPopupPolicy.ShouldShow(popupEnabled: true, captureActive: false, alreadyPrompted: false));
    }

    [Fact]
    public void ShouldShow_WhenSettingOff_ReturnsFalse()
    {
        Assert.False(MeetingPopupPolicy.ShouldShow(popupEnabled: false, captureActive: false, alreadyPrompted: false));
    }

    [Fact]
    public void ShouldShow_WhileRecording_ReturnsFalse()
    {
        Assert.False(MeetingPopupPolicy.ShouldShow(popupEnabled: true, captureActive: true, alreadyPrompted: false));
    }

    [Fact]
    public void ShouldShow_WhenAlreadyPromptedForThisMeeting_ReturnsFalse()
    {
        Assert.False(MeetingPopupPolicy.ShouldShow(popupEnabled: true, captureActive: false, alreadyPrompted: true));
    }
}
