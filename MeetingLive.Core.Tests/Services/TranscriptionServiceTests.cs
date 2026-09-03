using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using NAudio.Wave;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptionServiceTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(
        Path.GetTempPath(), "meetinglive-nemo-offline-" + Guid.NewGuid().ToString("N"));

    public TranscriptionServiceTests() => Directory.CreateDirectory(_tempDirectory);

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempDirectory))
                Directory.Delete(_tempDirectory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    [Fact]
    public async Task TranscribeAsync_PushesWavThroughStream_WithoutFinishAndDrain()
    {
        var wavPath = WriteSilenceWav();
        var stream = new ScriptedStream("hello there");
        var recognizer = new TrackingRecognizer(stream);
        var service = new TranscriptionService(
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(recognizer),
            new FakeHardware());

        var text = await service.TranscribeAsync(
            wavPath, language: "en", recordedAt: DateTimeOffset.UnixEpoch);

        Assert.Contains("hello there", text, StringComparison.Ordinal);
        Assert.Equal("en-US", recognizer.LastLanguage);
        Assert.True(stream.PushCalls > 0);
        Assert.Equal(0, stream.FinishAndDrainCalls);
        Assert.Equal(1, stream.DisposeCalls);
        Assert.Equal(1, recognizer.DisposeCalls);
    }

    [Fact]
    public async Task TranscribeAsync_WhenStreamYieldsNothing_ReturnsEmpty()
    {
        var wavPath = WriteSilenceWav();
        var stream = new ScriptedStream(transcript: null);
        var service = new TranscriptionService(
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(new TrackingRecognizer(stream)),
            new FakeHardware());

        var text = await service.TranscribeAsync(wavPath);

        Assert.Equal(string.Empty, text);
        Assert.Equal(0, stream.FinishAndDrainCalls);
    }

    private string WriteSilenceWav()
    {
        var path = Path.Combine(_tempDirectory, "take.wav");
        using var writer = new WaveFileWriter(path, WaveFormat.CreateIeeeFloatWaveFormat(16000, 1));
        writer.WriteSamples(new float[16000], 0, 16000);
        return path;
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

    private sealed class FakeEngine(INemoSpeechRecognizer recognizer) : INemoSpeechAsrEngine
    {
        public INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu) =>
            recognizer;
    }

    private sealed class TrackingRecognizer(INemoSpeechStream stream) : INemoSpeechRecognizer
    {
        public string? LastLanguage { get; private set; }

        public int DisposeCalls { get; private set; }

        public INemoSpeechStream StartStream(string languageCode)
        {
            LastLanguage = languageCode;
            return stream;
        }

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode) =>
            new(true, string.Empty, 0, []);

        public void Dispose() => DisposeCalls++;
    }

    private sealed class ScriptedStream(string? transcript) : INemoSpeechStream
    {
        public int PushCalls { get; private set; }

        public int FinishAndDrainCalls { get; private set; }

        public int DisposeCalls { get; private set; }

        private bool _emitted;

        public void Push(float[] samples, int sampleRate) => PushCalls++;

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable()
        {
            if (_emitted || transcript is null)
                return [];

            _emitted = true;
            return
            [
                new NemoSpeechAsrResult(
                    true,
                    transcript,
                    1f,
                    [
                        new NemoSpeechWordTiming(TimeSpan.Zero, TimeSpan.FromSeconds(0.5)),
                        new NemoSpeechWordTiming(TimeSpan.FromSeconds(0.5), TimeSpan.FromSeconds(1)),
                    ]),
            ];
        }

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain()
        {
            FinishAndDrainCalls++;
            return [];
        }

        public void Dispose() => DisposeCalls++;
    }
}
