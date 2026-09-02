using System.Diagnostics;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveTranscriptionServiceTests
{
    [Fact]
    public void OnPcmFrame_WhenNativePushBlocks_DoesNotBlockTheCaller()
    {
        var capture = new FakeAudioCapture();
        var stream = new BlockingStream();
        var service = new LiveTranscriptionService(
            capture,
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(stream),
            new FakeHardware());

        service.Start("en", DateTimeOffset.UnixEpoch);
        try
        {
            var samples = new float[3200];
            var elapsed = Stopwatch.StartNew();
            capture.Raise(samples, 16000);
            elapsed.Stop();

            Assert.True(
                elapsed.ElapsedMilliseconds < 100,
                $"OnPcmFrame blocked the caller for {elapsed.ElapsedMilliseconds}ms.");
            Assert.True(stream.PushEntered.Wait(TimeSpan.FromSeconds(2)));
        }
        finally
        {
            stream.AllowPush.Set();
            service.Stop();
        }
    }

    [Fact]
    public void Stop_ClosesStreamWithoutFinishAndDrain()
    {
        var capture = new FakeAudioCapture();
        var stream = new TrackingStream();
        var recognizer = new TrackingRecognizer(stream);
        var service = new LiveTranscriptionService(
            capture,
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(recognizer),
            new FakeHardware());

        service.Start("en", DateTimeOffset.UnixEpoch);
        var text = service.Stop();

        Assert.Equal(string.Empty, text);
        Assert.Equal(0, stream.FinishAndDrainCalls);
        Assert.Equal(1, stream.DisposeCalls);
        Assert.Equal(1, recognizer.DisposeCalls);
    }

    private sealed class FakeAudioCapture : IAudioCaptureService
    {
        public bool IsRecording { get; private set; }

        public bool IsPaused { get; private set; }

        public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

        public void Start(string outputWavPath, string? microphoneDeviceId = null) => IsRecording = true;

        public void Stop() => IsRecording = false;

        public void Pause() => IsPaused = true;

        public void Resume() => IsPaused = false;

        public Task StopAsync()
        {
            IsRecording = false;
            return Task.CompletedTask;
        }

        public void Raise(float[] samples, int sampleRate) =>
            PcmFrameAvailable?.Invoke(this, new PcmFrameEventArgs(samples, sampleRate));
    }

    private sealed class FakeModels : INemotronModelManager
    {
        public string GetModelPath() => "model.gguf";

        public bool IsModelDownloaded() => true;

        public Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public void DeleteModel()
        {
        }
    }

    private sealed class FakeRuntime : INemoSpeechRuntimeManager
    {
        public bool IsReady(NemoSpeechBackend backend) => backend == NemoSpeechBackend.Cpu;

        public string GetBinDirectory(NemoSpeechBackend backend) => "bin";

        public Task DownloadRuntimeAsync(
            NemoSpeechBackend backend,
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public void DeleteRuntime()
        {
        }
    }

    private sealed class FakeHardware : IHardwareDetectionService
    {
        public HardwareProfile DetectHardware() => new(16, null, null);
    }

    private sealed class FakeEngine : INemoSpeechAsrEngine
    {
        private readonly INemoSpeechRecognizer _recognizer;

        public FakeEngine(INemoSpeechStream stream) : this(new FakeRecognizer(stream))
        {
        }

        public FakeEngine(INemoSpeechRecognizer recognizer) => _recognizer = recognizer;

        public INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu) =>
            _recognizer;
    }

    private sealed class FakeRecognizer(INemoSpeechStream stream) : INemoSpeechRecognizer
    {
        public INemoSpeechStream StartStream(string languageCode) => stream;

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode) =>
            new(true, string.Empty, 0, []);

        public void Dispose()
        {
        }
    }

    private sealed class BlockingStream : INemoSpeechStream
    {
        public ManualResetEventSlim PushEntered { get; } = new(false);

        public ManualResetEventSlim AllowPush { get; } = new(false);

        public void Push(float[] samples, int sampleRate)
        {
            PushEntered.Set();
            if (!AllowPush.Wait(TimeSpan.FromSeconds(5)))
                throw new TimeoutException("AllowPush was never signaled.");
        }

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable() => [];

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain() => [];

        public void Dispose()
        {
        }
    }

    private sealed class TrackingRecognizer(INemoSpeechStream stream) : INemoSpeechRecognizer
    {
        public int DisposeCalls { get; private set; }

        public INemoSpeechStream StartStream(string languageCode) => stream;

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode) =>
            new(true, string.Empty, 0, []);

        public void Dispose() => DisposeCalls++;
    }

    private sealed class TrackingStream : INemoSpeechStream
    {
        public int FinishAndDrainCalls { get; private set; }

        public int DisposeCalls { get; private set; }

        public void Push(float[] samples, int sampleRate)
        {
        }

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable() => [];

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain()
        {
            FinishAndDrainCalls++;
            return [];
        }

        public void Dispose() => DisposeCalls++;
    }
}
