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

        service.Start("en");
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

    private sealed class FakeAudioCapture : IAudioCaptureService
    {
        public bool IsRecording { get; private set; }

        public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

        public void Start(string outputWavPath, string? microphoneDeviceId = null) => IsRecording = true;

        public void Stop() => IsRecording = false;

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

    private sealed class FakeEngine(INemoSpeechStream stream) : INemoSpeechAsrEngine
    {
        public INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu) =>
            new FakeRecognizer(stream);
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
}
