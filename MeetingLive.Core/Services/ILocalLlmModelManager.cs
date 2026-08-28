using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Manages the on-disk lifecycle of the GGUF models in <see cref="ModelCatalog"/>:
/// resolving where a model lives, whether it has been downloaded, downloading it
/// on demand with progress, and deleting it to reclaim disk space.
/// </summary>
public interface ILocalLlmModelManager
{
    string GetModelPath(SummaryModelInfo model);

    bool IsModelDownloaded(SummaryModelInfo model);

    Task DownloadModelAsync(SummaryModelInfo model, IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    void DeleteModel(SummaryModelInfo model);
}
