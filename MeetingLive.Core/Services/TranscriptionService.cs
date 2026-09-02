using MeetingLive.Core.Models;
using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>
/// Offline Nemotron ASR over a finished 16 kHz mono WAV. Streams the file in bounded
/// chunks through the same ABI as live preview so long meetings stay RAM-bounded and
/// <see cref="CancellationToken"/> is observed between chunks. Whole-file peak gain is
/// applied with a constant factor — never per-chunk AGC, which wrecks streaming RNNT.
/// </summary>
public sealed class TranscriptionService(
    INemotronModelManager models,
    INemoSpeechRuntimeManager runtime,
    INemoSpeechAsrEngine engine,
    IHardwareDetectionService hardware) : ITranscriptionService
{
    /// <summary>200 ms at 16 kHz — matches the capture pump frame size.</summary>
    public const int ChunkSampleCount = 3200;

    private const int SampleRate = 16000;

    private readonly NemoSpeechRecognizerFactory _factory = new(models, runtime, engine, hardware);

    public Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(Transcribe(wavFilePath, language, progress, cancellationToken));
    }

    private string Transcribe(
        string wavFilePath,
        string language,
        IProgress<int>? progress,
        CancellationToken cancellationToken)
    {
        var locale = NemotronLanguageMapper.ToNemotronLocale(language);
        var peak = ScanPeak(wavFilePath, cancellationToken);
        var gain = PcmLevelNormalizer.ResolveGain(peak);

        using var recognizer = _factory.Create();
        using var stream = recognizer.StartStream(locale);
        var accumulator = new StreamingTranscriptAccumulator();
        var buffer = new float[ChunkSampleCount];

        using (var reader = new AudioFileReader(wavFilePath))
        {
            int read;
            while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                ApplyGain(buffer, read, gain);
                stream.Push(ExactChunk(buffer, read), SampleRate);
                ApplyResults(stream.PullAvailable(), accumulator, progress);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        ApplyResults(stream.FinishAndDrain(), accumulator, progress);
        accumulator.CommitRemainingInterim();
        return accumulator.CommittedText;
    }

    private static float ScanPeak(string wavFilePath, CancellationToken cancellationToken)
    {
        using var reader = new AudioFileReader(wavFilePath);
        var buffer = new float[ChunkSampleCount];
        var peak = 0f;
        int read;
        while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            for (var i = 0; i < read; i++)
            {
                var abs = Math.Abs(buffer[i]);
                if (abs > peak)
                    peak = abs;
            }
        }

        return peak;
    }

    private static void ApplyGain(float[] buffer, int read, float gain)
    {
        if (gain <= 1f)
            return;

        for (var i = 0; i < read; i++)
            buffer[i] = Math.Clamp(buffer[i] * gain, -1f, 1f);
    }

    private static float[] ExactChunk(float[] buffer, int read)
    {
        if (read == buffer.Length)
            return buffer;

        var chunk = new float[read];
        Array.Copy(buffer, chunk, read);
        return chunk;
    }

    private static void ApplyResults(
        IReadOnlyList<NemoSpeechAsrResult> results,
        StreamingTranscriptAccumulator accumulator,
        IProgress<int>? progress)
    {
        foreach (var result in results)
        {
            accumulator.Apply(result);
            progress?.Report((int)Math.Max(0, result.AudioProcessedSeconds));
        }
    }
}
