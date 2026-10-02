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
        var engine = new FakeEngine(recognizer);
        var service = new LiveTranscriptionService(
            capture,
            new FakeModels(),
            new FakeRuntime(),
            engine,
            new FakeHardware());

        service.Start("en", DateTimeOffset.UnixEpoch);
        var text = service.Stop();

        Assert.Equal(string.Empty, text);
        Assert.Equal(SortformerGeometry.Streaming, engine.LastGeometry);
        Assert.Equal(AsrLatencyProfile.Live, engine.LastLatency);
        Assert.Equal(0, stream.FinishAndDrainCalls);
        Assert.Equal(1, stream.DisposeCalls);
        Assert.Equal(1, recognizer.DisposeCalls);
    }

    [Fact]
    public async Task TranscriptUpdated_RaisesCommittedTextSeparatelyFromDisplay()
    {
        var capture = new FakeAudioCapture();
        var stream = new ScriptedStream(
        [
            new NemoSpeechAsrResult(true, "What is the third principle?", 1, []),
            new NemoSpeechAsrResult(false, "still talking", 1.4f, []),
        ]);
        var service = new LiveTranscriptionService(
            capture,
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(stream),
            new FakeHardware());
        var raised = new TaskCompletionSource<LiveTranscriptUpdate>(TaskCreationOptions.RunContinuationsAsynchronously);
        service.TranscriptUpdated += (_, update) =>
        {
            if (update.DisplayText.Contains("still talking", StringComparison.Ordinal))
                raised.TrySetResult(update);
        };

        service.Start("en", DateTimeOffset.UnixEpoch);
        try
        {
            capture.Raise(new float[1600], 16000);
            var update = await raised.Task.WaitAsync(TimeSpan.FromSeconds(2));

            Assert.Contains("What is the third principle?", update.CommittedText, StringComparison.Ordinal);
            Assert.DoesNotContain("still talking", update.CommittedText, StringComparison.Ordinal);
            Assert.Contains("What is the third principle?", update.DisplayText, StringComparison.Ordinal);
            Assert.Contains("still talking", update.DisplayText, StringComparison.Ordinal);
        }
        finally
        {
            service.Stop();
        }
    }

    [Fact]
    public void Stop_WhenNothingWasDropped_PublishesZeroPercent()
    {
        var capture = new FakeAudioCapture();
        var status = new AsrBackendStatus();
        var service = NewService(capture, new TrackingStream(), status);

        service.Start("en", DateTimeOffset.UnixEpoch);
        for (var i = 0; i < 3; i++)
            capture.Raise(new float[1600], 16000);
        service.Stop();

        var summary = Assert.IsType<LiveDropSummary>(status.LastLiveDrops);
        Assert.Equal(TimeSpan.Zero, summary.DroppedDuration);
        Assert.Equal(TimeSpan.FromMilliseconds(300), summary.TotalDuration);
        Assert.Equal(0, summary.DroppedPercent);
    }

    [Fact]
    public void Stop_WhenNativePushIsSlow_PublishesTheDroppedDuration()
    {
        var capture = new FakeAudioCapture();
        var stream = new BlockingStream();
        var status = new AsrBackendStatus();
        var service = NewService(capture, stream, status);

        service.Start("en", DateTimeOffset.UnixEpoch);
        try
        {
            // The first frame is taken by the worker, which then blocks inside Push.
            capture.Raise(new float[1600], 16000);
            Assert.True(stream.PushEntered.Wait(TimeSpan.FromSeconds(2)));

            // 12 more 100 ms frames: the queue keeps 8, so the 4 oldest are dropped.
            for (var i = 0; i < 12; i++)
                capture.Raise(new float[1600], 16000);
        }
        finally
        {
            stream.AllowPush.Set();
            service.Stop();
        }

        var summary = Assert.IsType<LiveDropSummary>(status.LastLiveDrops);
        Assert.Equal(TimeSpan.FromMilliseconds(400), summary.DroppedDuration);
        Assert.Equal(TimeSpan.FromMilliseconds(1300), summary.TotalDuration);
        Assert.Equal(400.0 / 1300.0 * 100, summary.DroppedPercent, precision: 6);
    }

    [Fact]
    public void Stop_RaisesLiveDropsChangedOnce()
    {
        var capture = new FakeAudioCapture();
        var status = new AsrBackendStatus();
        var raised = new List<LiveDropSummary>();
        status.LiveDropsChanged += (_, summary) => raised.Add(summary);
        var service = NewService(capture, new TrackingStream(), status);

        service.Start("en", DateTimeOffset.UnixEpoch);
        Assert.Empty(raised);
        Assert.Null(status.LastLiveDrops);
        service.Stop();
        service.Stop();

        Assert.Single(raised);
        Assert.Same(status.LastLiveDrops, raised[0]);
    }

    [Fact]
    public void Start_ResetsTheCountersOfThePreviousSession()
    {
        var capture = new FakeAudioCapture();
        var stream = new BlockingStream();
        var status = new AsrBackendStatus();
        var service = NewService(capture, stream, status);

        service.Start("en", DateTimeOffset.UnixEpoch);
        capture.Raise(new float[1600], 16000);
        Assert.True(stream.PushEntered.Wait(TimeSpan.FromSeconds(2)));
        for (var i = 0; i < 12; i++)
            capture.Raise(new float[1600], 16000);
        stream.AllowPush.Set();
        service.Stop();
        Assert.NotEqual(TimeSpan.Zero, status.LastLiveDrops!.DroppedDuration);

        service.Start("en", DateTimeOffset.UnixEpoch);
        capture.Raise(new float[1600], 16000);
        service.Stop();

        Assert.Equal(TimeSpan.Zero, status.LastLiveDrops!.DroppedDuration);
        Assert.Equal(TimeSpan.FromMilliseconds(100), status.LastLiveDrops.TotalDuration);
    }

    private static LiveTranscriptionService NewService(
        FakeAudioCapture capture,
        INemoSpeechStream stream,
        IAsrBackendStatus status) =>
        new(capture, new FakeModels(), new FakeRuntime(), new FakeEngine(stream), new FakeHardware(), status);

    private sealed class FakeAudioCapture : IAudioCaptureService
    {
        public bool IsRecording { get; private set; }

        public bool IsPaused { get; private set; }

        public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

#pragma warning disable CS0067 // Interface member. This fake never raises capture failures.
        public event EventHandler<Exception>? OutputCaptureFailed;
#pragma warning restore CS0067

        public void Start(string outputWavPath, string? microphoneDeviceId = null) => IsRecording = true;

        public void Start(string outputWavPath, RecordingCaptureSources sources) => IsRecording = true;

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

        public string GetDiarizationModelPath() => "diar.gguf";

        public bool IsDiarizationModelDownloaded() => true;

        public Task DownloadDiarizationModelAsync(
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public void DeleteDiarizationModel()
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

        public SortformerGeometry LastGeometry { get; private set; }

        public AsrLatencyProfile LastLatency { get; private set; }

        public INemoSpeechRecognizer CreateRecognizer(
            string modelPath,
            string runtimeBinDirectory,
            int gpu,
            string? diarizationModelPath = null,
            SortformerGeometry geometry = SortformerGeometry.Streaming,
            AsrLatencyProfile latency = AsrLatencyProfile.Live)
        {
            LastGeometry = geometry;
            LastLatency = latency;
            return _recognizer;
        }
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

    private sealed class ScriptedStream(IReadOnlyList<NemoSpeechAsrResult> results) : INemoSpeechStream
    {
        private bool _pulled;

        public void Push(float[] samples, int sampleRate)
        {
        }

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable()
        {
            if (_pulled)
                return [];

            _pulled = true;
            return results;
        }

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain() => [];

        public void Dispose()
        {
        }
    }
}
