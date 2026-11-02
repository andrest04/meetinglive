using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using NAudio.Wave;

namespace MeetingLive.Core.Tests.Services;

/// <summary>Runs the real pump and a real WAV file against fake devices. Whether NAudio and Windows raise
/// these errors on a real unplug is a runtime scenario, not something these tests can prove.</summary>
public sealed class AudioCaptureServiceTests : IDisposable
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private readonly string _directory = Path.Combine(Path.GetTempPath(), "MeetingLiveCapture_" + Guid.NewGuid());
    private readonly FakeWaveIn _microphone = new();
    private readonly FakeWaveIn _output = new();

    public AudioCaptureServiceTests()
    {
        Directory.CreateDirectory(_directory);
    }

    private string WavPath => Path.Combine(_directory, "take.wav");

    private static RecordingCaptureSources MicAndSystem => RecordingCaptureSources.SystemLoopback(true, null);

    private static RecordingCaptureSources SystemOnly => RecordingCaptureSources.SystemLoopback(false, null);

    private static RecordingCaptureSources MicAndProcess => RecordingCaptureSources.ProcessTree(true, null, 4242);

    [Fact]
    public async Task PumpFault_ReachesTheCallerWhileStillRecording()
    {
        var service = NewDiskFullService();
        var faulted = new TaskCompletionSource<Exception>(TaskCreationOptions.RunContinuationsAsynchronously);
        service.CaptureFaulted += (_, error) => faulted.TrySetResult(error);

        service.Start(WavPath, MicAndSystem);

        var error = await faulted.Task.WaitAsync(Timeout);
        Assert.IsType<IOException>(error);
        Assert.True(service.IsRecording);

        await Assert.ThrowsAsync<IOException>(service.StopAsync);
    }

    [Fact]
    public async Task PumpFault_StopRethrowsCleansUpAndLeavesReadableAudio()
    {
        var service = NewDiskFullService();
        var faulted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        service.CaptureFaulted += (_, _) => faulted.TrySetResult();
        service.Start(WavPath, MicAndSystem);
        await WaitForFaultOrDiskFullAsync(faulted);

        await Assert.ThrowsAsync<IOException>(service.StopAsync);

        Assert.False(service.IsRecording);
        Assert.Equal(1, _microphone.DisposeCalls);
        Assert.Equal(1, _output.DisposeCalls);
        using var reader = new WaveFileReader(WavPath);
        Assert.Equal(16000, reader.WaveFormat.SampleRate);
        Assert.True(reader.Length > 0, "The audio written before the fault must be readable.");
    }

    [Fact]
    public async Task PumpFault_AfterStopANewRecordingCanStart()
    {
        var failing = true;
        var service = new AudioCaptureService(
            _ => new FakeWaveIn(),
            _ => new FakeWaveIn(),
            (path, format) => failing
                ? new WaveFileWriter(new DiskFullStream(path, 7000), format)
                : new WaveFileWriter(path, format));
        var faulted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        service.CaptureFaulted += (_, _) => faulted.TrySetResult();
        service.Start(WavPath, MicAndSystem);
        await WaitForFaultOrDiskFullAsync(faulted);
        await Assert.ThrowsAsync<IOException>(service.StopAsync);

        failing = false;
        service.Start(Path.Combine(_directory, "next.wav"), MicAndSystem);
        Assert.True(service.IsRecording);

        await service.StopAsync();
        Assert.False(service.IsRecording);
    }

    [Fact]
    public async Task PumpFault_ThrowingFrameSubscriberIsAlsoSurfaced()
    {
        var service = NewService();
        var faulted = new TaskCompletionSource<Exception>(TaskCreationOptions.RunContinuationsAsynchronously);
        service.CaptureFaulted += (_, error) => faulted.TrySetResult(error);
        service.PcmFrameAvailable += (_, _) => throw new InvalidOperationException("subscriber failed");

        service.Start(WavPath, MicAndSystem);

        Assert.IsType<InvalidOperationException>(await faulted.Task.WaitAsync(Timeout));
        await Assert.ThrowsAsync<InvalidOperationException>(service.StopAsync);
        Assert.False(service.IsRecording);
    }

    [Fact]
    public async Task TeardownStepFailure_RunsTheRestAndReachesTheCaller()
    {
        var microphone = new FakeWaveIn { StopError = new InvalidOperationException("mic stop failed") };
        var service = new AudioCaptureService(
            _ => microphone,
            _ => _output,
            (path, format) => new WaveFileWriter(path, format));
        service.Start(WavPath, MicAndSystem);

        await Assert.ThrowsAsync<InvalidOperationException>(service.StopAsync);

        Assert.False(service.IsRecording);
        Assert.Equal(1, _output.StopCalls);
        Assert.Equal(1, microphone.DisposeCalls);
        Assert.Equal(1, _output.DisposeCalls);
        using var reader = new WaveFileReader(WavPath);
        Assert.Equal(16000, reader.WaveFormat.SampleRate);
    }

    [Fact]
    public async Task MicrophoneLost_WarnsAndKeepsRecordingWithTheOutput()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        var stopping = new List<Exception>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.OutputCaptureFailed += (_, e) => stopping.Add(e);
        service.Start(WavPath, MicAndSystem);

        _microphone.RaiseStopped(new InvalidOperationException("unplugged"));

        var warning = Assert.Single(lost);
        Assert.Equal(CaptureSource.Microphone, warning.Source);
        Assert.Equal(1, warning.RemainingSources);
        Assert.Equal("unplugged", warning.Error.Message);
        Assert.Empty(stopping);
        Assert.True(service.IsRecording);

        await service.StopAsync();
    }

    [Fact]
    public async Task MicrophoneLost_TheOutputStillReachesTheMix()
    {
        var service = NewService();
        var heard = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        service.PcmFrameAvailable += (_, e) =>
        {
            if (e.Samples.Any(sample => sample > 0.1f))
                heard.TrySetResult();
        };
        service.Start(WavPath, MicAndSystem);

        _microphone.RaiseStopped(new InvalidOperationException("unplugged"));
        _output.RaiseSamples(0.5f, 16000);

        await heard.Task.WaitAsync(Timeout);
        await service.StopAsync();
    }

    [Fact]
    public async Task SystemLoopbackLost_WarnsAndKeepsRecordingWithTheMicrophone()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        var stopping = new List<Exception>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.OutputCaptureFailed += (_, e) => stopping.Add(e);
        service.Start(WavPath, MicAndSystem);

        _output.RaiseStopped(new InvalidOperationException("device invalidated"));

        var warning = Assert.Single(lost);
        Assert.Equal(CaptureSource.Output, warning.Source);
        Assert.Equal(1, warning.RemainingSources);
        Assert.Empty(stopping);
        Assert.True(service.IsRecording);

        await service.StopAsync();
    }

    [Fact]
    public async Task BothSourcesLost_TheLastWarningSaysNothingIsLeft()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.Start(WavPath, MicAndSystem);

        _microphone.RaiseStopped(new InvalidOperationException("unplugged"));
        _output.RaiseStopped(new InvalidOperationException("device invalidated"));

        Assert.Equal(new[] { 1, 0 }, lost.Select(e => e.RemainingSources));
        Assert.True(service.IsRecording);

        await service.StopAsync();
    }

    [Fact]
    public async Task OnlySourceLost_SaysNothingIsLeft()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.Start(WavPath, SystemOnly);

        _output.RaiseStopped(new InvalidOperationException("device invalidated"));

        Assert.Equal(0, Assert.Single(lost).RemainingSources);

        await service.StopAsync();
    }

    [Fact]
    public async Task ProcessOutputLost_KeepsItsExistingStopBehavior()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        var stopping = new List<Exception>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.OutputCaptureFailed += (_, e) => stopping.Add(e);
        service.Start(WavPath, MicAndProcess);

        _output.RaiseStopped(new InvalidOperationException("process exited"));

        Assert.Single(stopping);
        Assert.Empty(lost);
        await Assert.ThrowsAsync<InvalidOperationException>(service.StopAsync);
        Assert.False(service.IsRecording);
    }

    [Fact]
    public async Task MicrophoneLost_DuringProcessCapture_WarnsAndKeepsRecording()
    {
        var service = NewService();
        var lost = new List<CaptureSourceLostEventArgs>();
        service.CaptureSourceLost += (_, e) => lost.Add(e);
        service.Start(WavPath, MicAndProcess);

        _microphone.RaiseStopped(new InvalidOperationException("unplugged"));

        Assert.Equal(CaptureSource.Microphone, Assert.Single(lost).Source);
        Assert.True(service.IsRecording);

        await service.StopAsync();
    }

    [Fact]
    public async Task UserStop_IsNeverReportedAsAFailure()
    {
        var service = NewService();
        var reports = 0;
        service.CaptureSourceLost += (_, _) => Interlocked.Increment(ref reports);
        service.OutputCaptureFailed += (_, _) => Interlocked.Increment(ref reports);
        service.CaptureFaulted += (_, _) => Interlocked.Increment(ref reports);
        service.Start(WavPath, MicAndSystem);

        await service.StopAsync();

        Assert.Equal(0, reports);
    }

    [Theory]
    [InlineData(false, false, true)]
    [InlineData(false, true, false)]
    [InlineData(true, false, false)]
    [InlineData(true, true, false)]
    public void IsSourceLost_NeedsAnErrorAndNoUserStop(bool nullError, bool userStop, bool expected)
    {
        Exception? error = nullError ? null : new InvalidOperationException("device invalidated");

        Assert.Equal(expected, AudioCaptureService.IsSourceLost(error, userStop));
    }

    [Fact]
    public async Task ConcurrentStops_TearDownOnceAndAllComplete()
    {
        var microphone = new FakeWaveIn { StopDelay = TimeSpan.FromMilliseconds(100) };
        var output = new FakeWaveIn { StopDelay = TimeSpan.FromMilliseconds(100) };
        var service = new AudioCaptureService(
            _ => microphone,
            _ => output,
            (path, format) => new WaveFileWriter(path, format));
        service.Start(WavPath, MicAndSystem);

        var stops = Enumerable.Range(0, 8).Select(_ => Task.Run(service.StopAsync)).ToArray();
        await Task.WhenAll(stops).WaitAsync(Timeout);

        Assert.False(service.IsRecording);
        Assert.Equal(1, microphone.StopCalls);
        Assert.Equal(1, output.StopCalls);
        Assert.Equal(1, microphone.DisposeCalls);
        Assert.Equal(1, output.DisposeCalls);
    }

    [Fact]
    public async Task ConcurrentStops_EveryCallerSeesTheSameFailure()
    {
        var microphone = new FakeWaveIn
        {
            StopDelay = TimeSpan.FromMilliseconds(100),
            StopError = new InvalidOperationException("mic stop failed"),
        };
        var service = new AudioCaptureService(
            _ => microphone,
            _ => _output,
            (path, format) => new WaveFileWriter(path, format));
        service.Start(WavPath, MicAndSystem);

        var first = service.StopAsync();
        var second = service.StopAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => first.WaitAsync(Timeout));
        await Assert.ThrowsAsync<InvalidOperationException>(() => second.WaitAsync(Timeout));
        Assert.Equal(1, microphone.DisposeCalls);
    }

    [Fact]
    public void Stop_WhenNotRecording_DoesNothing()
    {
        var service = NewService();

        service.Stop();

        Assert.False(service.IsRecording);
        Assert.Equal(0, _output.StopCalls);
    }

    [Fact]
    public void Dispose_AfterAFault_DoesNotThrow()
    {
        var microphone = new FakeWaveIn { StopError = new InvalidOperationException("mic stop failed") };
        var service = new AudioCaptureService(
            _ => microphone,
            _ => _output,
            (path, format) => new WaveFileWriter(path, format));
        service.Start(WavPath, MicAndSystem);

        service.Dispose();

        Assert.False(service.IsRecording);
        Assert.Equal(1, microphone.DisposeCalls);
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_directory, recursive: true);
        }
        catch (IOException)
        {
            // Best effort: a failed test may still hold the file open.
        }
    }

    private AudioCaptureService NewService() => new(
        _ => _microphone,
        _ => _output,
        (path, format) => new WaveFileWriter(path, format));

    /// <summary>The header takes 44 bytes and each pump write 6400, so the second write hits the full disk.</summary>
    private AudioCaptureService NewDiskFullService() => new(
        _ => _microphone,
        _ => _output,
        (path, format) => new WaveFileWriter(new DiskFullStream(path, 7000), format));

    /// <summary>The second pump write lands well inside this wait, so a missing event only costs time.</summary>
    private static async Task WaitForFaultOrDiskFullAsync(TaskCompletionSource faulted)
    {
        await Task.WhenAny(faulted.Task, Task.Delay(TimeSpan.FromSeconds(2)));
    }
}
