namespace MeetingLive.Core.Services;

/// <summary>Authoritative transcript of a finished WAV via Nemotron offline stream.</summary>
public interface ITranscriptionService
{
    /// <param name="progress">0–100 percent of WAV duration transcribed so far.</param>
    Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default,
        DateTimeOffset? recordedAt = null,
        TimeSpan clockSkew = default);
}
