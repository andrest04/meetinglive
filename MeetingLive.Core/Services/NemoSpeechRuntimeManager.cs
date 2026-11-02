using System.IO.Compression;
using System.Security.Cryptography;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// On-demand download of the pinned NeMo-Speech.cpp v0.1.0 Windows zip: SHA-256 verify,
/// extract into a backend-named folder, <see cref="IsReady"/> when
/// <c>bin\nemo_speech_asr_c.dll</c> exists and no incomplete marker sits beside the folder.
/// The marker is negative on purpose: it exists only while a promote or a delete is under
/// way, so a complete install from an older version, which has no marker, stays ready.
/// Directory is overridable for tests.
/// </summary>
public sealed class NemoSpeechRuntimeManager(HttpClient httpClient, string? runtimeDirectory = null) : INemoSpeechRuntimeManager
{
    internal const string IncompleteMarkerSuffix = ".incomplete";

    private readonly string _runtimeDirectory = runtimeDirectory ?? AppPaths.NemoSpeechRuntimeDirectory;

    /// <summary>Removes a directory tree. A test seam for a failure the probe could not foresee.</summary>
    internal Action<string> DirectoryDeleter { get; init; } = path => Directory.Delete(path, recursive: true);

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
        var zipPath = Path.Combine(_runtimeDirectory, $"{NemotronAsrCatalog.BackendFolderName(backend)}.zip");
        var extractRoot = Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend));
        var extractTemp = extractRoot + ".extracting";

        try
        {
            await ResumableFileDownloader.DownloadAsync(httpClient, zipUrl, zipPath, progress, cancellationToken);

            var actualSha = await HashFileSha256Async(zipPath, cancellationToken);
            if (!actualSha.Equals(expectedSha, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"NeMo-Speech {backend} zip SHA-256 mismatch (expected {expectedSha}, got {actualSha}).");
            }

            TryDeleteDirectory(extractTemp);

            ZipFile.ExtractToDirectory(zipPath, extractTemp);
            await InstallExtractedAsync(backend, extractTemp, cancellationToken);
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

    /// <summary>
    /// Moves an extracted tree into place. The marker covers the whole step, including the
    /// non-atomic copy fallback, so a failure or a killed process cannot leave a partial
    /// tree that reports ready. Only a verified install clears it.
    /// </summary>
    internal async Task InstallExtractedAsync(
        NemoSpeechBackend backend, string extractTemp, CancellationToken cancellationToken)
    {
        var extractRoot = Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend));
        var marker = IncompleteMarkerPath(backend);
        File.WriteAllBytes(marker, []);
        try
        {
            await PromoteExtractedDirectoryAsync(extractTemp, extractRoot, cancellationToken);

            if (FindBinUnder(extractRoot) is null)
            {
                throw new InvalidOperationException(
                    $"NeMo-Speech {backend} zip extracted but {NemotronAsrCatalog.NativeLibraryFileName} was not found.");
            }
        }
        catch
        {
            TryDeleteDirectory(extractRoot);
            throw;
        }

        File.Delete(marker);
    }

    /// <summary>
    /// Deletes the runtime before the model, because the runtime is the part that can refuse.
    /// A refusal then leaves a working engine, with no model to download again.
    /// </summary>
    public static TranscriptionEngineDeletion DeleteEngine(INemotronModelManager models, INemoSpeechRuntimeManager runtime)
    {
        try
        {
            runtime.DeleteRuntime();
            models.DeleteModel();
            return TranscriptionEngineDeletion.Deleted;
        }
        catch (NemoSpeechRuntimeInUseException)
        {
            return TranscriptionEngineDeletion.RuntimeInUse;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return TranscriptionEngineDeletion.Incomplete;
        }
    }

    public void DeleteRuntime()
    {
        if (!Directory.Exists(_runtimeDirectory))
            return;

        ThrowIfAnyFileIsInUse();

        // One backend at a time, and not as one recursive delete of the root, which could
        // remove a marker before the tree it protects.
        foreach (var backend in Enum.GetValues<NemoSpeechBackend>())
        {
            var extractRoot = Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend));
            if (!Directory.Exists(extractRoot))
                continue;

            var marker = IncompleteMarkerPath(backend);
            File.WriteAllBytes(marker, []);
            DirectoryDeleter(extractRoot);
            File.Delete(marker);
        }

        DirectoryDeleter(_runtimeDirectory);
    }

    /// <summary>
    /// A library the process loaded cannot be unloaded, and Windows refuses to open it for
    /// writing. Probing first turns that case into a clean refusal with nothing removed.
    /// </summary>
    private void ThrowIfAnyFileIsInUse()
    {
        foreach (var file in Directory.EnumerateFiles(_runtimeDirectory, "*", SearchOption.AllDirectories))
        {
            try
            {
                using var handle = File.OpenHandle(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            }
            catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
            {
                // Gone since the listing, so there is nothing left to hold.
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                throw new NemoSpeechRuntimeInUseException(file, ex);
            }
        }
    }

    private string IncompleteMarkerPath(NemoSpeechBackend backend) =>
        Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend) + IncompleteMarkerSuffix);

    private string? FindBinDirectory(NemoSpeechBackend backend) =>
        File.Exists(IncompleteMarkerPath(backend))
            ? null
            : FindBinUnder(Path.Combine(_runtimeDirectory, NemotronAsrCatalog.BackendFolderName(backend)));

    private static string? FindBinUnder(string extractRoot)
    {
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
