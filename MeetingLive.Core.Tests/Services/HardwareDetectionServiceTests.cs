using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class HardwareDetectionServiceTests
{
    [Fact]
    public void DetectHardware_CalledTwice_ReturnsCachedInstance()
    {
        var sut = new HardwareDetectionService();

        var first = sut.DetectHardware();
        var second = sut.DetectHardware();

        Assert.Same(first, second);
    }
}
