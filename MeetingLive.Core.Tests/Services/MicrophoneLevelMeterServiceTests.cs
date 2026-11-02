using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MicrophoneLevelMeterServiceTests
{
    [Fact]
    public void Start_WhenTheDeviceRefusesToStart_DisposesTheCapture()
    {
        var capture = new FakeWaveIn { StartError = new InvalidOperationException("device busy") };
        var meter = new MicrophoneLevelMeterService(_ => capture);

        meter.Start(null);

        Assert.Equal(1, capture.DisposeCalls);
    }

    [Fact]
    public void Start_AfterAFailedStart_OpensAWorkingCapture()
    {
        var failed = new FakeWaveIn { StartError = new InvalidOperationException("device busy") };
        var working = new FakeWaveIn();
        var captures = new Queue<FakeWaveIn>([failed, working]);
        var meter = new MicrophoneLevelMeterService(_ => captures.Dequeue());

        meter.Start(null);
        meter.Start(null);
        var levels = new List<float>();
        meter.LevelChanged += (_, level) => levels.Add(level);
        working.RaiseSamples(0.5f, 100);

        Assert.Equal(0, working.DisposeCalls);
        Assert.Single(levels);
        Assert.True(levels[0] > 0f);
    }

    [Fact]
    public void Start_WhenTheCaptureCannotBeCreated_DoesNotThrow()
    {
        var meter = new MicrophoneLevelMeterService(_ => throw new InvalidOperationException("no device"));

        meter.Start(null);
        meter.Stop();
    }

    [Fact]
    public void Stop_DisposesAStartedCaptureOnce()
    {
        var capture = new FakeWaveIn();
        var meter = new MicrophoneLevelMeterService(_ => capture);

        meter.Start(null);
        meter.Stop();
        meter.Stop();

        Assert.Equal(1, capture.DisposeCalls);
    }
}
