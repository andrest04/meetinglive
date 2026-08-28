namespace MeetingLive.Core.Services;

public interface ITranscriptionService
{
    Task<string> TranscribeAsync(string wavFilePath, IProgress<int>? progress = null, CancellationToken cancellationToken = default);
}
