namespace MeetingLive.Core.Services;

/// <summary>
/// Shared HTTP download loop used by the model/runtime managers (<see cref="LocalLlmModelManager"/>,
/// <see cref="NemotronModelManager"/>, <see cref="NemoSpeechRuntimeManager"/>): streams the response body
/// into a ".part" sibling of <paramref name="finalPath"/> in 80 KiB chunks, reporting progress as a
/// 0-100 percentage whenever the response declares a content length, and only moves the ".part" file into
/// place once the transfer completes successfully. On failure or cancellation the partial ".part" file is
/// deleted so a caller's "is this already downloaded" check never sees a half-written file at
/// <paramref name="finalPath"/>.
/// </summary>
public static class ResumableFileDownloader
{
    private const int BufferSize = 81920;

    public static async Task DownloadAsync(
        HttpClient httpClient,
        string url,
        string finalPath,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var partPath = finalPath + ".part";

        try
        {
            using (var response = await httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
            {
                response.EnsureSuccessStatusCode();

                var totalBytes = response.Content.Headers.ContentLength;
                await using var contentStream = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var fileStream = File.Create(partPath);

                var buffer = new byte[BufferSize];
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
}
