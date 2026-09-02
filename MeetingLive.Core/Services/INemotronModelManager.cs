namespace MeetingLive.Core.Services;

/// <summary>
/// On-disk lifecycle of the Nemotron 3.5 ASR GGUF: resolve path, download with progress,
/// and delete to reclaim disk. Mirrors <see cref="ILocalLlmModelManager"/>.
/// </summary>
public interface INemotronModelManager
{
    string GetModelPath();

    bool IsModelDownloaded();

    Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    void DeleteModel();
}
