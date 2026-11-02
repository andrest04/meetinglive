using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Downloads, verifies, extracts, and deletes the pinned NVIDIA NeMo-Speech.cpp Windows
/// runtime zip (CPU or CUDA). CPU and CUDA live in separate subfolders so they never mix.
/// </summary>
public interface INemoSpeechRuntimeManager
{
    bool IsReady(NemoSpeechBackend backend);

    string GetBinDirectory(NemoSpeechBackend backend);

    Task DownloadRuntimeAsync(NemoSpeechBackend backend, IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes every runtime. Throws <see cref="NemoSpeechRuntimeInUseException"/> with nothing
    /// removed when a runtime file is held open, which is always the case after a transcription
    /// ran in this process: the native library cannot be unloaded. Throws
    /// <see cref="IOException"/> or <see cref="UnauthorizedAccessException"/> if the removal
    /// fails partway, and the affected runtime then no longer reports ready.
    /// </summary>
    void DeleteRuntime();
}

/// <summary>A runtime file is held open, so nothing was deleted and the runtime still works.</summary>
public sealed class NemoSpeechRuntimeInUseException(string path, Exception innerException)
    : IOException($"The NeMo-Speech runtime file is in use: {Path.GetFileName(path)}", innerException);

/// <summary>How a request to delete the transcription engine ended.</summary>
public enum TranscriptionEngineDeletion
{
    /// <summary>The runtime and the model are gone.</summary>
    Deleted,

    /// <summary>Nothing was deleted: the runtime is held open until the app restarts.</summary>
    RuntimeInUse,

    /// <summary>The deletion failed partway. What is left does not report ready.</summary>
    Incomplete,
}
