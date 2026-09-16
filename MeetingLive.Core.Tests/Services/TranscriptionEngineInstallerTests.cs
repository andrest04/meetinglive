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

    private sealed class SyncProgress(List<string> statuses) : IProgress<TranscriptionEngineInstallProgress>
    {
        public void Report(TranscriptionEngineInstallProgress value) => statuses.Add(value.StatusText);
    }
}
