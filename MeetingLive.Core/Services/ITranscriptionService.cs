namespace MeetingLive.Core.Services;

public interface ITranscriptionService
{
    Task<string> TranscribeAsync(string wavFilePath, string language = "auto", IProgress<int>? progress = null, CancellationToken cancellationToken = default);
}
