using MeetingLive.Core.Models;

namespace MeetingLive.Core.Tests.Models;

public class AsrLatencyProfileTests
{
    [Theory]
    [InlineData(AsrLatencyProfile.Live, 3)]
    [InlineData(AsrLatencyProfile.Offline, 13)]
    public void RightContextFrames_MapsProfileToModelSupportedFrames(AsrLatencyProfile profile, int expectedFrames)
    {
        Assert.Equal(expectedFrames, profile.RightContextFrames());
    }

    [Fact]
    public void RightContextFrames_EveryProfileIsAModelSupportedValue()
    {
        int[] supported = [0, 1, 3, 6, 13];

        foreach (var profile in Enum.GetValues<AsrLatencyProfile>())
            Assert.Contains(profile.RightContextFrames(), supported);
    }
}
