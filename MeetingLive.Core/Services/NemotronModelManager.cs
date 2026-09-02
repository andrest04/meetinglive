namespace MeetingLive.Core.Services;

/// <summary>
/// Downloads the Nemotron 3.5 ASR GGUF from Hugging Face into
/// <see cref="AppPaths.TranscriptionModelsDirectory"/> (overridable for tests).
/// Downloads land in a ".part" file first and are only moved into place once complete,
/// so a cancelled or failed download never leaves a corrupt file that
/// <see cref="IsModelDownloaded"/> would report as ready.
/// </summary>
public sealed class NemotronModelManager(HttpClient httpClient, string? modelsDirectory = null) : INemotronModelManager
{
    private readonly string _modelsDirectory = modelsDirectory ?? AppPaths.TranscriptionModelsDirectory;

    public string GetModelPath() => Path.Combine(_modelsDirectory, NemotronAsrCatalog.FileName);

    public bool IsModelDownloaded() => File.Exists(GetModelPath());

    public async Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_modelsDirectory);

        var finalPath = GetModelPath();
        var partPath = finalPath + ".part";

        try
        {
            using (var response = await httpClient.GetAsync(NemotronAsrCatalog.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
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

    public void DeleteModel()
    {
        var path = GetModelPath();
        if (File.Exists(path))
            File.Delete(path);
    }
}
