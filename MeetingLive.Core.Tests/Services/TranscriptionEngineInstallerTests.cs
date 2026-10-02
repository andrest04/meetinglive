using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptionEngineInstallerTests
{
    [Fact]
    public void IsReady_WhenAsrAndRuntimeReadyButDiarMissing_ReturnsTrue()
    {
        var models = new FakeModels { ModelDownloaded = true, DiarDownloaded = false };
        var runtime = new FakeRuntime();

        Assert.True(TranscriptionEngineInstaller.IsReady(models, runtime));
    }

    [Fact]
    public void IsReady_WhenAsrAndRuntimeReady_ReturnsTrue()
    {
        var models = new FakeModels { ModelDownloaded = true, DiarDownloaded = true };
        var runtime = new FakeRuntime();

        Assert.True(TranscriptionEngineInstaller.IsReady(models, runtime));
    }

    [Fact]
    public async Task EnsureAsync_WhenDiarMissing_DoesNotDownloadSortformer()
    {
        var models = new FakeModels { ModelDownloaded = true, DiarDownloaded = false };
        var runtime = new FakeRuntime();
        var statuses = new List<string>();
        var progress = new SyncProgress(statuses);

        await TranscriptionEngineInstaller.EnsureAsync(
            models,
            runtime,
            new HardwareProfile(16, null, null),
            progress);

        Assert.Equal(0, models.AsrDownloadCalls);
        Assert.Equal(0, models.DiarDownloadCalls);
        Assert.DoesNotContain(statuses, status => status.Contains("Sortformer", StringComparison.Ordinal));
    }

    private static readonly HardwareProfile NvidiaGpu = new(16, "NVIDIA GeForce RTX 4070", 12);

    [Fact]
    public void ExpectedBackend_WhenNvidiaGpuAndCudaRuntimeReady_ReturnsCuda()
    {
        var runtime = new FakeRuntime { CudaReady = true };

        Assert.Equal(NemoSpeechBackend.Cuda, TranscriptionEngineInstaller.ExpectedBackend(NvidiaGpu, runtime));
    }

    [Fact]
    public void ExpectedBackend_WhenCudaRuntimeOnDiskButNoNvidiaGpu_ReturnsCpu()
    {
        var runtime = new FakeRuntime { CudaReady = true };

        Assert.Equal(
            NemoSpeechBackend.Cpu,
            TranscriptionEngineInstaller.ExpectedBackend(new HardwareProfile(16, null, null), runtime));
    }

    [Fact]
    public void ExpectedBackend_WhenNvidiaGpuAndOnlyCpuRuntimeReady_ReturnsCpu()
    {
        var runtime = new FakeRuntime();

        Assert.Equal(NemoSpeechBackend.Cpu, TranscriptionEngineInstaller.ExpectedBackend(NvidiaGpu, runtime));
    }

    [Fact]
    public void ExpectedBackend_WhenNothingInstalledAndNvidiaGpu_ReturnsCuda()
    {
        var runtime = new FakeRuntime { CpuReady = false };

        Assert.Equal(NemoSpeechBackend.Cuda, TranscriptionEngineInstaller.ExpectedBackend(NvidiaGpu, runtime));
    }

    private sealed class FakeModels : INemotronModelManager
    {
        public bool ModelDownloaded { get; set; }

        public bool DiarDownloaded { get; set; }

        public int AsrDownloadCalls { get; private set; }

        public int DiarDownloadCalls { get; private set; }

        public string GetModelPath() => "model.gguf";

        public bool IsModelDownloaded() => ModelDownloaded;

        public Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default)
        {
            AsrDownloadCalls++;
            ModelDownloaded = true;
            return Task.CompletedTask;
        }

        public void DeleteModel() => ModelDownloaded = false;

        public string GetDiarizationModelPath() => "diar.gguf";

        public bool IsDiarizationModelDownloaded() => DiarDownloaded;

        public Task DownloadDiarizationModelAsync(
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default)
        {
            DiarDownloadCalls++;
            DiarDownloaded = true;
            return Task.CompletedTask;
        }

        public void DeleteDiarizationModel() => DiarDownloaded = false;
    }

    private sealed class FakeRuntime : INemoSpeechRuntimeManager
    {
        public bool CudaReady { get; set; }

        public bool CpuReady { get; set; } = true;

        public bool IsReady(NemoSpeechBackend backend) =>
            backend == NemoSpeechBackend.Cpu ? CpuReady : CudaReady;

        public string GetBinDirectory(NemoSpeechBackend backend) => "bin";

        public Task DownloadRuntimeAsync(
            NemoSpeechBackend backend,
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public void DeleteRuntime()
        {
        }
    }

    private sealed class SyncProgress(List<string> statuses) : IProgress<TranscriptionEngineInstallProgress>
    {
        public void Report(TranscriptionEngineInstallProgress value) => statuses.Add(value.StatusText);
    }
}
