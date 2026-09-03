using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>
/// Offline Nemotron ASR over a finished 16 kHz mono WAV. Re-reads the file through a
/// streaming session so dropped live frames are recovered. Never calls
/// <c>FinishAndDrain</c> (that flush aborts CUDA after a long session). Live preview
/// stays on <see cref="ILiveTranscriptionService"/>.
/// </summary>
public sealed class TranscriptionService(
    INemotronModelManager models,
    INemoSpeechRuntimeManager runtime,
    INemoSpeechAsrEngine engine,
    IHardwareDetectionService hardware) : ITranscriptionService
{
    /// <summary>100 ms of 16 kHz mono float32.</summary>
    private const int FrameFloats = 1600;

    public Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default,
        DateTimeOffset? recordedAt = null,
        TimeSpan clockSkew = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(
            () => TranscribeWav(
                wavFilePath, language, progress, cancellationToken, recordedAt ?? default, clockSkew),
            cancellationToken);
    }

    private string TranscribeWav(
        string wavFilePath,
        string language,
        IProgress<int>? progress,
        CancellationToken cancellationToken,
        DateTimeOffset recordedAt,
        TimeSpan clockSkew)
    {
        var factory = new NemoSpeechRecognizerFactory(models, runtime, engine, hardware);
        var recognizer = factory.Create();
        INemoSpeechStream? stream = null;
        try
        {
            stream = recognizer.StartStream(NemotronLanguageMapper.ToNemotronLocale(language));
            var accumulator = new StreamingTranscriptAccumulator(recordedAt)
            {
                ClockSkew = clockSkew,
            };

            using var reader = new AudioFileReader(wavFilePath);
            var duration = reader.TotalTime;
            var channels = Math.Max(1, reader.WaveFormat.Channels);
            var buffer = new float[FrameFloats * channels];
            int read;
            while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var samples = ToMono(buffer, read, channels);
                if (samples.Length == 0)
                    continue;

                stream.Push(samples, reader.WaveFormat.SampleRate);
                foreach (var result in stream.PullAvailable())
                    accumulator.Apply(result);

                progress?.Report(TranscriptionProgress.ToPercent(reader.CurrentTime, duration));
            }

            accumulator.CommitRemainingInterim();
            progress?.Report(100);
            return accumulator.CommittedText;
        }
        finally
        {
            stream?.Dispose();
            recognizer.Dispose();
        }
    }

    private static float[] ToMono(float[] buffer, int floatsRead, int channels)
    {
        if (channels <= 1)
        {
            var copy = new float[floatsRead];
            Array.Copy(buffer, copy, floatsRead);
            return copy;
        }

        var frames = floatsRead / channels;
        var mono = new float[frames];
        for (var i = 0; i < frames; i++)
        {
            float sum = 0;
            var offset = i * channels;
            for (var c = 0; c < channels; c++)
                sum += buffer[offset + c];
            mono[i] = sum / channels;
        }

        return mono;
    }
}
