using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Shared "is the Nemotron engine on disk?" / "download whatever is missing" policy used by
/// Settings and the Record-time gate. Prefers CUDA when an NVIDIA GPU is present; always
/// keeps a CPU runtime as fallback because CUDA create can still fail at load time.
/// </summary>
public static class TranscriptionEngineInstaller
{
    public static bool IsReady(INemotronModelManager models, INemoSpeechRuntimeManager runtime) =>
        models.IsModelDownloaded()
        && (runtime.IsReady(NemoSpeechBackend.Cuda) || runtime.IsReady(NemoSpeechBackend.Cpu));

    public static async Task EnsureAsync(
        INemotronModelManager models,
        INemoSpeechRuntimeManager runtime,
        HardwareProfile hardware,
        IProgress<TranscriptionEngineInstallProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var preferred = NemoSpeechRuntimeManager.SelectBackend(hardware);

        if (!runtime.IsReady(preferred))
        {
            progress?.Report(new TranscriptionEngineInstallProgress(
                preferred == NemoSpeechBackend.Cuda
                    ? "Downloading NVIDIA CUDA runtime..."
                    : "Downloading NVIDIA CPU runtime...",
                0));
            var runtimeProgress = new Progress<double>(percent =>
                progress?.Report(new TranscriptionEngineInstallProgress(
                    preferred == NemoSpeechBackend.Cuda
                        ? "Downloading NVIDIA CUDA runtime..."
                        : "Downloading NVIDIA CPU runtime...",
                    percent)));
            await runtime.DownloadRuntimeAsync(preferred, runtimeProgress, cancellationToken);
        }

        if (preferred == NemoSpeechBackend.Cuda && !runtime.IsReady(NemoSpeechBackend.Cpu))
        {
            progress?.Report(new TranscriptionEngineInstallProgress("Downloading NVIDIA CPU fallback runtime...", 0));
            var cpuProgress = new Progress<double>(percent =>
                progress?.Report(new TranscriptionEngineInstallProgress("Downloading NVIDIA CPU fallback runtime...", percent)));
            await runtime.DownloadRuntimeAsync(NemoSpeechBackend.Cpu, cpuProgress, cancellationToken);
        }

        if (!models.IsModelDownloaded())
        {
            progress?.Report(new TranscriptionEngineInstallProgress("Downloading Nemotron 3.5 ASR model...", 0));
            var modelProgress = new Progress<double>(percent =>
                progress?.Report(new TranscriptionEngineInstallProgress("Downloading Nemotron 3.5 ASR model...", percent)));
            await models.DownloadModelAsync(modelProgress, cancellationToken);
        }
    }

    public static string AccelerationCaption(HardwareProfile hardware, INemoSpeechRuntimeManager runtime)
    {
        if (runtime.IsReady(NemoSpeechBackend.Cuda))
            return "GPU acceleration (CUDA)";

        if (runtime.IsReady(NemoSpeechBackend.Cpu))
            return "CPU";

        return NemoSpeechRuntimeManager.SelectBackend(hardware) == NemoSpeechBackend.Cuda
            ? "GPU acceleration (CUDA)"
            : "CPU";
    }
}

public sealed record TranscriptionEngineInstallProgress(string StatusText, double Percent);
