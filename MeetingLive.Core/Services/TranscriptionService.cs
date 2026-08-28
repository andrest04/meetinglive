using System.Text;
using Whisper.net;
using Whisper.net.Ggml;

namespace MeetingLive.Core.Services;

public sealed class TranscriptionService(string modelDirectory, GgmlType modelType = GgmlType.Base) : ITranscriptionService
{
    public async Task<string> TranscribeAsync(string wavFilePath, IProgress<int>? progress = null, CancellationToken cancellationToken = default)
    {
        var modelPath = await EnsureModelDownloadedAsync(cancellationToken);

        using var whisperFactory = WhisperFactory.FromPath(modelPath);
        await using var processor = whisperFactory.CreateBuilder()
            .WithLanguage("auto")
            .Build();

        await using var audioStream = File.OpenRead(wavFilePath);

        var transcript = new StringBuilder();
        await foreach (var segment in processor.ProcessAsync(audioStream, cancellationToken))
        {
            transcript.AppendLine($"[{segment.Start:hh\\:mm\\:ss} -> {segment.End:hh\\:mm\\:ss}] {segment.Text}");
            progress?.Report((int)segment.End.TotalSeconds);
        }

        return transcript.ToString();
    }

    private async Task<string> EnsureModelDownloadedAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(modelDirectory);
        var modelPath = Path.Combine(modelDirectory, $"ggml-{modelType.ToString().ToLowerInvariant()}.bin");

        if (!File.Exists(modelPath))
        {
            await using var modelStream = await WhisperGgmlDownloader.Default.GetGgmlModelAsync(modelType, cancellationToken: cancellationToken);
            await using var fileStream = File.Create(modelPath);
            await modelStream.CopyToAsync(fileStream, cancellationToken);
        }

        return modelPath;
    }
}
