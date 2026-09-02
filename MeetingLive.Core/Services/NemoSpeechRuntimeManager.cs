using System.IO.Compression;
using System.Security.Cryptography;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// On-demand download of the pinned NeMo-Speech.cpp v0.1.0 Windows zip: SHA-256 verify,
/// extract into a backend-named folder, <see cref="IsReady"/> when
/// <c>bin\nemo_speech_asr_c.dll</c> exists. Directory is overridable for tests.
/// </summary>
public sealed class NemoSpeechRuntimeManager(HttpClient httpClient, string? runtimeDirectory = null) : INemoSpeechRuntimeManager
{
    private readonly string _runtimeDirectory = runtimeDirectory ?? AppPaths.NemoSpeechRuntimeDirectory;

    public static NemoSpeechBackend SelectBackend(HardwareProfile hardware) =>
        hardware.HasNvidiaGpu() ? NemoSpeechBackend.Cuda : NemoSpeechBackend.Cpu;

    public bool IsReady(NemoSpeechBackend backend) =>
        FindBinDirectory(backend) is not null;

    public string GetBinDirectory(NemoSpeechBackend backend) =>
        FindBinDirectory(backend)
        ?? throw new InvalidOperationException($"The NeMo-Speech {backend} runtime is not installed.");

    public async Task DownloadRuntimeAsync(NemoSpeechBackend backend, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_runtimeDirectory);

        var zipUrl = NemotronAsrCatalog.ZipUrl(backend);
        var expectedSha = NemotronAsrCatalog.ZipSha256(backend);
        var zipPath = Path.Combine(_runtimeDirectory, $"{NemotronAsrCatalog.BackendFolderName(backend)}.zip.part");
        var extractRoot = Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend));
        var extractTemp = extractRoot + ".extracting";

        try
        {
            using (var response = await httpClient.GetAsync(zipUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
            {
                response.EnsureSuccessStatusCode();

                var totalBytes = response.Content.Headers.ContentLength;
                await using var contentStream = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var fileStream = File.Create(zipPath);

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

            var actualSha = await HashFileSha256Async(zipPath, cancellationToken);
            if (!actualSha.Equals(expectedSha, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"NeMo-Speech {backend} zip SHA-256 mismatch (expected {expectedSha}, got {actualSha}).");
            }

            TryDeleteDirectory(extractTemp);

            ZipFile.ExtractToDirectory(zipPath, extractTemp);
            await PromoteExtractedDirectoryAsync(extractTemp, extractRoot, cancellationToken);

            if (FindBinDirectory(backend) is null)
            {
                throw new InvalidOperationException(
                    $"NeMo-Speech {backend} zip extracted but {NemotronAsrCatalog.NativeLibraryFileName} was not found.");
            }
        }
        catch
        {
            TryDeleteDirectory(extractTemp);
            throw;
        }
        finally
        {
            TryDeleteFile(zipPath);
        }
    }

    public void DeleteRuntime()
    {
        if (Directory.Exists(_runtimeDirectory))
            Directory.Delete(_runtimeDirectory, recursive: true);
    }

    private string? FindBinDirectory(NemoSpeechBackend backend)
    {
        var extractRoot = Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend));
        if (!Directory.Exists(extractRoot))
            return null;

        var direct = Path.Combine(extractRoot, "bin", NemotronAsrCatalog.NativeLibraryFileName);
        if (File.Exists(direct))
            return Path.Combine(extractRoot, "bin");

        foreach (var directory in Directory.EnumerateDirectories(extractRoot, "*", SearchOption.AllDirectories))
        {
            var candidate = Path.Combine(directory, NemotronAsrCatalog.NativeLibraryFileName);
            if (File.Exists(candidate))
                return directory;

            var nestedBin = Path.Combine(directory, "bin", NemotronAsrCatalog.NativeLibraryFileName);
            if (File.Exists(nestedBin))
                return Path.Combine(directory, "bin");
        }

        return null;
    }

    private static async Task PromoteExtractedDirectoryAsync(
        string source, string destination, CancellationToken cancellationToken)
    {
        // Directory.Move of a freshly extracted tree of DLLs often fails on Windows
        // (Defender scan, AppContainer) with "Access denied". Retry, then copy.
        const int attempts = 8;
        for (var i = 0; i < attempts; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                TryDeleteDirectory(destination);
                Directory.Move(source, destination);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (i == attempts - 1)
                    break;

                await Task.Delay(150 * (i + 1), cancellationToken);
            }
        }

        TryDeleteDirectory(destination);
        CopyDirectory(source, destination);
        TryDeleteDirectory(source);
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: true);
        }

        foreach (var directory in Directory.EnumerateDirectories(source))
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Best-effort cleanup; a later retry or copy fallback still proceeds.
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Best-effort cleanup of the .part zip.
        }
    }

    private static async Task<string> HashFileSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
