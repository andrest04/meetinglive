using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Downloads GGUF models straight from Hugging Face into a models directory (by default
/// <see cref="AppPaths.SummaryModelsDirectory"/>, overridable for tests), mirroring the
/// on-demand download/cache pattern used for the Nemotron ASR GGUF.
/// Downloads land in a ".part" file first and are only moved into place once complete, so a cancelled or
/// failed download never leaves a corrupt file that <see cref="IsModelDownloaded"/> would report as ready.
/// </summary>
public sealed class LocalLlmModelManager(HttpClient httpClient, string? modelsDirectory = null) : ILocalLlmModelManager
{
    private readonly string _modelsDirectory = modelsDirectory ?? AppPaths.SummaryModelsDirectory;

    public string GetModelPath(SummaryModelInfo model) =>
        Path.Combine(_modelsDirectory, model.FileName);

    public bool IsModelDownloaded(SummaryModelInfo model) =>
        File.Exists(GetModelPath(model));

    public Task DownloadModelAsync(SummaryModelInfo model, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_modelsDirectory);

        return ResumableFileDownloader.DownloadAsync(httpClient, model.DownloadUrl, GetModelPath(model), progress, cancellationToken);
    }

    public void DeleteModel(SummaryModelInfo model)
    {
        var path = GetModelPath(model);
        if (File.Exists(path))
            File.Delete(path);
    }
}
