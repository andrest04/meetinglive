using MeetingLive.Core.Models;

namespace MeetingLive.Core.Tests.Models;

public class HardwareProfileTests
{
    [Theory]
    [InlineData("NVIDIA GeForce RTX 4070")]
    [InlineData("GeForce GTX 1080")]
    [InlineData("NVIDIA RTX A6000")]
    [InlineData("Quadro P4000")]
    [InlineData("Tesla T4")]
    public void HasNvidiaGpu_WhenVendorTokensPresent_ReturnsTrue(string gpuName)
    {
        var hardware = new HardwareProfile(16, gpuName, 8);

        Assert.True(hardware.HasNvidiaGpu());
    }

    [Theory]
    [InlineData("AMD Radeon RX 7900 XTX")]
    [InlineData("Intel Arc A770")]
    [InlineData("RTX 4070")]
    [InlineData(null)]
    [InlineData("")]
    public void HasNvidiaGpu_WhenNotNvidia_ReturnsFalse(string? gpuName)
    {
        var hardware = new HardwareProfile(16, gpuName, 8);

        Assert.False(hardware.HasNvidiaGpu());
    }
}
