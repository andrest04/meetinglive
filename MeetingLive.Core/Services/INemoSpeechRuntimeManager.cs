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

    void DeleteRuntime();
}
