namespace MeetingLive.Core.Services;

/// <summary>
/// On-disk lifecycle of the Nemotron 3.5 ASR GGUF and its Sortformer diarization sidecar:
/// resolve path, download with progress, and delete to reclaim disk. Mirrors
/// <see cref="ILocalLlmModelManager"/>.
/// </summary>
public interface INemotronModelManager
{
    string GetModelPath();

    bool IsModelDownloaded();

    Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    void DeleteModel();

    string GetDiarizationModelPath();

    bool IsDiarizationModelDownloaded();

    Task DownloadDiarizationModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    void DeleteDiarizationModel();
}
