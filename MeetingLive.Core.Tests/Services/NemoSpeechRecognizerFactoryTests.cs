using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NemoSpeechRecognizerFactoryTests
{
    [Fact]
    public void Create_WhenDiarizationDisabled_DoesNotRequireDiarModel()
    {
        var engine = new FakeEngine();
        var factory = new NemoSpeechRecognizerFactory(
            new FakeModels { ModelDownloaded = true, DiarDownloaded = false },
            new FakeRuntime(),
            engine,
            new FakeHardware());

        factory.Create();

        Assert.Null(engine.LastDiarizationModelPath);
        Assert.Equal(-1, engine.LastGpu);
        Assert.Equal(SortformerGeometry.Streaming, engine.LastGeometry);
    }

    [Fact]
    public void Create_WhenDiarizationEnabledAndFilePresent_PassesPath()
    {
        var engine = new FakeEngine();
        var factory = new NemoSpeechRecognizerFactory(
            new FakeModels { ModelDownloaded = true, DiarDownloaded = true },
            new FakeRuntime(),
            engine,
            new FakeHardware());

        factory.Create(enableSpeakerDiarization: true);

        Assert.Equal("diar.gguf", engine.LastDiarizationModelPath);
        Assert.Equal(-1, engine.LastGpu);
        Assert.Equal(SortformerGeometry.Streaming, engine.LastGeometry);
    }

    [Fact]
    public void Create_WhenDiarizationEnabledAndFileMissing_CreatesWithoutThrowing()
    {
        var engine = new FakeEngine();
        var factory = new NemoSpeechRecognizerFactory(
            new FakeModels { ModelDownloaded = true, DiarDownloaded = false },
            new FakeRuntime(),
            engine,
            new FakeHardware());

        factory.Create(enableSpeakerDiarization: true);

        Assert.Null(engine.LastDiarizationModelPath);
        Assert.Equal(SortformerGeometry.Streaming, engine.LastGeometry);
    }

    [Fact]
    public void Create_WhenMeetingGeometryAndDiarFilePresent_PassesMeetingToEngine()
    {
        var engine = new FakeEngine();
        var factory = new NemoSpeechRecognizerFactory(
            new FakeModels { ModelDownloaded = true, DiarDownloaded = true },
            new FakeRuntime(),
            engine,
            new FakeHardware());

        factory.Create(enableSpeakerDiarization: true, SortformerGeometry.Meeting);

        Assert.Equal("diar.gguf", engine.LastDiarizationModelPath);
        Assert.Equal(SortformerGeometry.Meeting, engine.LastGeometry);
    }

    [Fact]
    public void Create_DefaultGeometry_IsStreaming()
    {
        var engine = new FakeEngine();
        var factory = new NemoSpeechRecognizerFactory(
            new FakeModels { ModelDownloaded = true, DiarDownloaded = true },
            new FakeRuntime(),
            engine,
            new FakeHardware());

        factory.Create(enableSpeakerDiarization: true);

        Assert.Equal(SortformerGeometry.Streaming, engine.LastGeometry);
    }

    private sealed class FakeModels : INemotronModelManager
    {
        public bool ModelDownloaded { get; set; }

        public bool DiarDownloaded { get; set; }

        public string GetModelPath() => "model.gguf";

        public bool IsModelDownloaded() => ModelDownloaded;

        public Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public void DeleteModel()
        {
        }

        public string GetDiarizationModelPath() => "diar.gguf";

        public bool IsDiarizationModelDownloaded() => DiarDownloaded;

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
        public string? LastDiarizationModelPath { get; private set; }

        public int LastGpu { get; private set; }

        public SortformerGeometry LastGeometry { get; private set; }

        public INemoSpeechRecognizer CreateRecognizer(
            string modelPath,
            string runtimeBinDirectory,
            int gpu,
            string? diarizationModelPath = null,
            SortformerGeometry geometry = SortformerGeometry.Streaming)
        {
            LastGpu = gpu;
            LastDiarizationModelPath = diarizationModelPath;
            LastGeometry = geometry;
            return new FakeRecognizer();
        }
    }

    private sealed class FakeRecognizer : INemoSpeechRecognizer
    {
        public INemoSpeechStream StartStream(string languageCode) => throw new NotSupportedException();

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode) =>
            new(true, string.Empty, 0, []);

        public void Dispose()
        {
        }
    }
}
