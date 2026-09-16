using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Creates a Nemotron recognizer with CUDA when an NVIDIA GPU and CUDA runtime are present,
/// falling back to the CPU zip/runtime if CUDA create fails.
/// </summary>
public sealed class NemoSpeechRecognizerFactory(
    INemotronModelManager models,
    INemoSpeechRuntimeManager runtime,
    INemoSpeechAsrEngine engine,
    IHardwareDetectionService hardware)
{
    public INemoSpeechRecognizer Create(
        bool enableSpeakerDiarization = false,
        SortformerGeometry geometry = SortformerGeometry.Streaming)
    {
        var modelPath = models.GetModelPath();
        if (!models.IsModelDownloaded())
            throw new InvalidOperationException("The Nemotron ASR model is not installed.");

        string? diarizationModelPath = null;
        if (enableSpeakerDiarization && models.IsDiarizationModelDownloaded())
            diarizationModelPath = models.GetDiarizationModelPath();

        var preferred = NemoSpeechRuntimeManager.SelectBackend(hardware.DetectHardware());
        if (preferred == NemoSpeechBackend.Cuda && runtime.IsReady(NemoSpeechBackend.Cuda))
        {
            try
            {
                return engine.CreateRecognizer(
                    modelPath,
                    runtime.GetBinDirectory(NemoSpeechBackend.Cuda),
                    gpu: 0,
                    diarizationModelPath,
                    geometry);
            }
            catch
            {
                // CUDA zip loaded or recognizer create failed (missing driver, VRAM, etc.).
            }
        }

        if (!runtime.IsReady(NemoSpeechBackend.Cpu))
            throw new InvalidOperationException("The Nemotron ASR CPU runtime is not installed.");

        return engine.CreateRecognizer(
            modelPath,
            runtime.GetBinDirectory(NemoSpeechBackend.Cpu),
            gpu: -1,
            diarizationModelPath,
            geometry);
    }
}
