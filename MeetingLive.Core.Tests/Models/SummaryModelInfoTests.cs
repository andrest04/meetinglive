using MeetingLive.Core.Models;

namespace MeetingLive.Core.Tests.Models;

public class SummaryModelInfoTests
{
    private static readonly SummaryModelInfo Phi4Mini = new(
        FileName: "phi4-mini-q4_k_m.gguf",
        DisplayName: "Phi-4 Mini",
        DownloadUrl: "https://huggingface.co/example/phi4-mini-q4_k_m.gguf",
        FileSizeGb: 2.5,
        MinRamGb: 6,
        Speed: "Rápido",
        Quality: "Muy buena",
        UseCase: "Balance");

    [Fact]
    public void RateFor_WhenRamMeetsMinimum_ReturnsRecommended()
    {
        var hardware = new HardwareProfile(TotalRamGb: 16, GpuName: null, GpuVramGb: null);

        var rating = Phi4Mini.RateFor(hardware);

        Assert.Equal(FitRating.Recommended, rating);
    }

    [Fact]
    public void RateFor_WhenRamBelowMinimumButOver75Percent_ReturnsMayBeSlow()
    {
        var hardware = new HardwareProfile(TotalRamGb: 5, GpuName: null, GpuVramGb: null);

        var rating = Phi4Mini.RateFor(hardware);

        Assert.Equal(FitRating.MayBeSlow, rating);
    }

    [Fact]
    public void RateFor_WhenRamFarBelowMinimum_ReturnsNotRecommended()
    {
        var hardware = new HardwareProfile(TotalRamGb: 2, GpuName: null, GpuVramGb: null);

        var rating = Phi4Mini.RateFor(hardware);

        Assert.Equal(FitRating.NotRecommended, rating);
    }

    [Fact]
    public void RateFor_WhenGpuVramCoversHalfTheMinimum_ReturnsRecommended()
    {
        // 3GB VRAM covers half of phi4-mini's 6GB minimum even though system RAM alone wouldn't.
        var hardware = new HardwareProfile(TotalRamGb: 4, GpuName: "RTX 4060", GpuVramGb: 3);

        var rating = Phi4Mini.RateFor(hardware);

        Assert.Equal(FitRating.Recommended, rating);
    }
}
