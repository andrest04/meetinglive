using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptionProgressTests
{
    [Theory]
    [InlineData(0, 60, 0)]
    [InlineData(30, 60, 50)]
    [InlineData(60, 60, 100)]
    [InlineData(90, 60, 100)]
    [InlineData(-5, 60, 0)]
    [InlineData(10, 0, 0)]
    [InlineData(10, -1, 0)]
    [InlineData(1, 3, 33)]
    public void ToPercent_ClampsTo0Through100(double positionSeconds, double durationSeconds, int expected)
    {
        var actual = TranscriptionProgress.ToPercent(
            TimeSpan.FromSeconds(positionSeconds),
            TimeSpan.FromSeconds(durationSeconds));

        Assert.Equal(expected, actual);
    }
}
