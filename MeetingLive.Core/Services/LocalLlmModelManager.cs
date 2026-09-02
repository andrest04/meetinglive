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

    public async Task DownloadModelAsync(SummaryModelInfo model, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_modelsDirectory);

        var finalPath = GetModelPath(model);
        var partPath = finalPath + ".part";

        try
        {
            using (var response = await httpClient.GetAsync(model.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
            {
                response.EnsureSuccessStatusCode();

                var totalBytes = response.Content.Headers.ContentLength;
                await using var contentStream = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var fileStream = File.Create(partPath);

                var buffer = new byte[81920];
                long totalRead = 0;
                int bytesRead;
                while ((bytesRead = await contentStream.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
                    totalRead += bytesRead;

                    if (totalBytes is > 0)
                        progress?.Report(totalRead * 100.0 / totalBytes.Value);
                }
            }

            File.Move(partPath, finalPath, overwrite: true);
        }
        catch
        {
            if (File.Exists(partPath))
                File.Delete(partPath);
            throw;
        }
    }

    public void DeleteModel(SummaryModelInfo model)
    {
        var path = GetModelPath(model);
        if (File.Exists(path))
            File.Delete(path);
    }
}
