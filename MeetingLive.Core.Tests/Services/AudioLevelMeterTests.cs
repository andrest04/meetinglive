using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class AudioLevelMeterTests
{
    [Theory]
    [InlineData(0.0)]
    [InlineData(1e-6)]
    [InlineData(0.0005)] // -66 dBFS, below the floor
    public void ToMeterValue_AtOrBelowFloor_IsZero(double amplitude)
    {
        Assert.Equal(0.0, AudioLevelMeter.ToMeterValue(amplitude), 6);
    }

    [Fact]
    public void ToMeterValue_FullScale_IsOne()
    {
        Assert.Equal(1.0, AudioLevelMeter.ToMeterValue(1.0), 6);
    }

    [Fact]
    public void ToMeterValue_AboveFullScale_ClampsToOne()
    {
        Assert.Equal(1.0, AudioLevelMeter.ToMeterValue(4.0), 6);
    }

    [Fact]
    public void ToMeterValue_MinusThirtyDb_IsHalf()
    {
        var amplitude = Math.Pow(10, -30.0 / 20.0);

        Assert.Equal(0.5, AudioLevelMeter.ToMeterValue(amplitude), 6);
    }

    [Fact]
    public void ToMeterValue_TypicalSpeech_ReadsWellAboveTheFloor()
    {
        // 0.05 RMS is about -26 dBFS. The old linear mapping drew this as 5 percent of the bar.
        var value = AudioLevelMeter.ToMeterValue(0.05);

        Assert.InRange(value, 0.5, 0.6);
    }

    [Fact]
    public void ToMeterValue_Negative_TreatedAsSilence()
    {
        Assert.Equal(0.0, AudioLevelMeter.ToMeterValue(-0.5), 6);
    }

    [Fact]
    public void ToMeterValue_NotANumber_IsZero()
    {
        Assert.Equal(0.0, AudioLevelMeter.ToMeterValue(double.NaN), 6);
    }

    [Fact]
    public void ToMeterValue_LouderInput_NeverReadsLower()
    {
        var previous = -1.0;
        foreach (var amplitude in new[] { 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 0.9 })
        {
            var value = AudioLevelMeter.ToMeterValue(amplitude);
            Assert.True(value > previous);
            previous = value;
        }
    }
}
