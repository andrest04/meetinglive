using System.Text;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptionServiceTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    public TranscriptionServiceTests()
    {
        Directory.CreateDirectory(_tempDirectory);
    }

    [Fact]
    public async Task TranscribeAsync_StreamsWavInBoundedChunks_DoesNotCallRecognize()
    {
        var wavPath = WritePcm16Mono16kWav(sampleCount: TranscriptionService.ChunkSampleCount * 2 + 400);
        var stream = new RecordingStream();
        var recognizer = new FakeRecognizer(stream);
        var service = CreateService(recognizer);

        var text = await service.TranscribeAsync(wavPath, "en");

        Assert.False(recognizer.RecognizeCalled);
        Assert.Equal("en-US", recognizer.LastLanguage);
        Assert.Equal(3, stream.PushLengths.Count);
        Assert.All(stream.PushLengths, length => Assert.InRange(length, 1, TranscriptionService.ChunkSampleCount));
        Assert.Equal(TranscriptionService.ChunkSampleCount * 2 + 400, stream.PushLengths.Sum());
        Assert.Contains("hello world", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TranscribeAsync_WhenCancelledAfterFirstPush_StopsPushing()
    {
        var wavPath = WritePcm16Mono16kWav(sampleCount: TranscriptionService.ChunkSampleCount * 3);
        var cts = new CancellationTokenSource();
        var stream = new RecordingStream { OnPush = cts.Cancel };
        var service = CreateService(new FakeRecognizer(stream));

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => service.TranscribeAsync(wavPath, cancellationToken: cts.Token));

        Assert.Single(stream.PushLengths);
        Assert.False(stream.FinishCalled);
    }

    [Fact]
    public async Task TranscribeAsync_QuietWav_AppliesOneWholeFileGain()
    {
        var wavPath = WritePcm16Mono16kWav(sampleCount: TranscriptionService.ChunkSampleCount, value: 1638);
        var stream = new RecordingStream();
        var service = CreateService(new FakeRecognizer(stream));

        await service.TranscribeAsync(wavPath);

        var peak = stream.PushedSamples.Max(Math.Abs);
        Assert.InRange(peak, 0.65f, 0.75f);
    }

    private TranscriptionService CreateService(FakeRecognizer recognizer) =>
        new(
            new FakeModels(),
            new FakeRuntime(),
            new FakeEngine(recognizer),
            new FakeHardware());

    private string WritePcm16Mono16kWav(int sampleCount, short value = 3000)
    {
        var path = Path.Combine(_tempDirectory, Guid.NewGuid() + ".wav");
        const int sampleRate = 16000;
        const int byteRate = sampleRate * 2;
        var dataSize = sampleCount * 2;
        using var writer = new BinaryWriter(File.Create(path), Encoding.ASCII, leaveOpen: false);
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + dataSize);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write((short)1);
        writer.Write((short)1);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write((short)2);
        writer.Write((short)16);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(dataSize);
        for (var i = 0; i < sampleCount; i++)
            writer.Write(value);

        return path;
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
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

    private sealed class FakeEngine(FakeRecognizer recognizer) : INemoSpeechAsrEngine
    {
        public INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu) =>
            recognizer;
    }

    private sealed class FakeRecognizer(INemoSpeechStream stream) : INemoSpeechRecognizer
    {
        public bool RecognizeCalled { get; private set; }

        public string? LastLanguage { get; private set; }

        public INemoSpeechStream StartStream(string languageCode)
        {
            LastLanguage = languageCode;
            return stream;
        }

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode)
        {
            RecognizeCalled = true;
            return new(true, string.Empty, 0, []);
        }

        public void Dispose()
        {
        }
    }

    private sealed class RecordingStream : INemoSpeechStream
    {
        public List<int> PushLengths { get; } = [];

        public List<float> PushedSamples { get; } = [];

        public bool FinishCalled { get; private set; }

        public Action? OnPush { get; init; }

        public void Push(float[] samples, int sampleRate)
        {
            PushLengths.Add(samples.Length);
            PushedSamples.AddRange(samples);
            OnPush?.Invoke();
        }

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable() => [];

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain()
        {
            FinishCalled = true;
            return [new(true, "hello world", 1.5f, [])];
        }

        public void Dispose()
        {
        }
    }
}
