using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Abstraction over the NVIDIA NeMo-Speech.cpp C ABI so unit tests never load the real DLL.
/// </summary>
public interface INemoSpeechAsrEngine
{
    INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu);
}

public interface INemoSpeechRecognizer : IDisposable
{
    INemoSpeechStream StartStream(string languageCode);

    NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode);
}

public interface INemoSpeechStream : IDisposable
{
    void Push(float[] samples, int sampleRate);

    IReadOnlyList<NemoSpeechAsrResult> PullAvailable();

    IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain();
}
