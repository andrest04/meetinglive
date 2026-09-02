using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>
/// Offline Nemotron 3.5 ASR over a finished 16 kHz mono WAV. Used when live streaming was
/// disabled or produced no text; never Whisper.
/// </summary>
public sealed class TranscriptionService(
    INemotronModelManager models,
    INemoSpeechRuntimeManager runtime,
    INemoSpeechAsrEngine engine,
    IHardwareDetectionService hardware) : ITranscriptionService
{
    private readonly NemoSpeechRecognizerFactory _factory = new(models, runtime, engine, hardware);

    public Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var samples = ReadMonoFloat32(wavFilePath);
        var locale = NemotronLanguageMapper.ToNemotronLocale(language);

        using var recognizer = _factory.Create();
        var result = recognizer.Recognize(samples, sampleRate: 16000, locale);
        progress?.Report((int)Math.Max(0, result.AudioProcessedSeconds));

        var accumulator = new StreamingTranscriptAccumulator();
        accumulator.Apply(result.IsFinal ? result : result with { IsFinal = true });
        accumulator.CommitRemainingInterim();
        return Task.FromResult(accumulator.CommittedText);
    }

    private static float[] ReadMonoFloat32(string wavFilePath)
    {
        using var reader = new AudioFileReader(wavFilePath);
        var sampleCount = (int)(reader.Length / 4);
        var samples = new float[sampleCount];
        var read = reader.Read(samples, 0, samples.Length);
        if (read != samples.Length)
            Array.Resize(ref samples, read);
        return samples;
    }
}
