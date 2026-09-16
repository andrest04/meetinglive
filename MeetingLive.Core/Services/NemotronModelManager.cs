namespace MeetingLive.Core.Services;

/// <summary>
/// Downloads the Nemotron 3.5 ASR GGUF and Sortformer diarization sidecar from Hugging Face
/// into <see cref="AppPaths.TranscriptionModelsDirectory"/> (overridable for tests).
/// Downloads land in a ".part" file first and are only moved into place once complete,
/// so a cancelled or failed download never leaves a corrupt file that
/// <see cref="IsModelDownloaded"/> / <see cref="IsDiarizationModelDownloaded"/> would report as ready.
/// </summary>
public sealed class NemotronModelManager(HttpClient httpClient, string? modelsDirectory = null) : INemotronModelManager
{
    private readonly string _modelsDirectory = modelsDirectory ?? AppPaths.TranscriptionModelsDirectory;

    public string GetModelPath() => Path.Combine(_modelsDirectory, NemotronAsrCatalog.FileName);

    public bool IsModelDownloaded() => File.Exists(GetModelPath());

    public Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default) =>
        DownloadFileAsync(NemotronAsrCatalog.DownloadUrl, GetModelPath(), progress, cancellationToken);

    public void DeleteModel() => DeleteIfExists(GetModelPath());

    public string GetDiarizationModelPath() =>
        Path.Combine(_modelsDirectory, NemotronAsrCatalog.DiarizationFileName);

    public bool IsDiarizationModelDownloaded() => File.Exists(GetDiarizationModelPath());

    public Task DownloadDiarizationModelAsync(
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default) =>
        DownloadFileAsync(
            NemotronAsrCatalog.DiarizationDownloadUrl,
            GetDiarizationModelPath(),
            progress,
            cancellationToken);

    public void DeleteDiarizationModel() => DeleteIfExists(GetDiarizationModelPath());

    private Task DownloadFileAsync(
        string url,
        string finalPath,
        IProgress<double>? progress,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_modelsDirectory);

        return ResumableFileDownloader.DownloadAsync(httpClient, url, finalPath, progress, cancellationToken);
    }

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path))
            File.Delete(path);
    }
}
