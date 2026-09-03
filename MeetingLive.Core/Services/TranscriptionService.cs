using NAudio.Wave;
using Whisper.net;

namespace MeetingLive.Core.Services;

/// <summary>
/// Offline Whisper.net ASR over a finished 16 kHz mono WAV. Live preview stays on Nemotron;
/// this is the authoritative transcript after Stop. GPU is used when HardwareDetection
/// reports an NVIDIA adapter, with a CPU fallback only if GPU factory create fails.
/// A failed ProcessAsync is not retried on CPU.
/// </summary>
public sealed class TranscriptionService(
    IWhisperModelManager models,
    IHardwareDetectionService hardware) : ITranscriptionService
{
    public async Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default,
        DateTimeOffset? recordedAt = null,
        TimeSpan clockSkew = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!models.IsModelDownloaded())
            throw new InvalidOperationException("The Whisper model is not installed.");

        var modelPath = models.GetModelPath();
        var whisperLanguage = WhisperLanguageMapper.ToWhisperLanguage(language);
        var recorded = recordedAt ?? default;
        var preferGpu = hardware.DetectHardware().HasNvidiaGpu();
        var duration = ReadWavDuration(wavFilePath);

        WhisperFactory factory;
        WhisperProcessor processor;
        try
        {
            (factory, processor) = CreateFactoryAndProcessor(modelPath, whisperLanguage, useGpu: preferGpu);
        }
        catch (Exception ex) when (preferGpu && ex is not OperationCanceledException)
        {
            (factory, processor) = CreateFactoryAndProcessor(modelPath, whisperLanguage, useGpu: false);
        }

        using (factory)
        using (processor)
        {
            return await ProcessWavAsync(
                processor, wavFilePath, duration, progress, cancellationToken, recorded, clockSkew);
        }
    }

    private static (WhisperFactory Factory, WhisperProcessor Processor) CreateFactoryAndProcessor(
        string modelPath,
        string language,
        bool useGpu)
    {
        var factory = WhisperFactory.FromPath(modelPath, new WhisperFactoryOptions
        {
            UseGpu = useGpu,
            UseFlashAttention = useGpu,
        });

        try
        {
            var processor = factory.CreateBuilder()
                .WithLanguage(language)
                .WithThreads(Environment.ProcessorCount)
                .Build();
            return (factory, processor);
        }
        catch
        {
            factory.Dispose();
            throw;
        }
    }

    private static TimeSpan ReadWavDuration(string wavFilePath)
    {
        using var reader = new AudioFileReader(wavFilePath);
        return reader.TotalTime;
    }

    private static async Task<string> ProcessWavAsync(
        WhisperProcessor processor,
        string wavFilePath,
        TimeSpan duration,
        IProgress<int>? progress,
        CancellationToken cancellationToken,
        DateTimeOffset recordedAt,
        TimeSpan clockSkew)
    {
        await using var wavStream = File.OpenRead(wavFilePath);

        var lines = new List<string>();
        var wroteHeader = false;

        await foreach (var result in processor.ProcessAsync(wavStream, cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            progress?.Report(TranscriptionProgress.ToPercent(result.End, duration));

            var text = result.Text?.Trim();
            if (string.IsNullOrEmpty(text))
                continue;

            if (!wroteHeader && recordedAt != default)
            {
                lines.Add(TranscriptStampFormatter.FormatHeader(recordedAt));
                wroteHeader = true;
            }

            lines.Add(TranscriptStampFormatter.FormatLine(result.Start, text, recordedAt, clockSkew));
        }

        progress?.Report(100);
        return string.Join(Environment.NewLine, lines);
    }
}
