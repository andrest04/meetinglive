namespace MeetingLive.Core.Services;

/// <summary>Nemotron over a finished WAV. Replaces the live draft when it produces text;
/// also the only transcript when live was off or empty.</summary>
public interface ITranscriptionService
{
    /// <param name="progress">0–100 percent of WAV duration transcribed so far.</param>
    Task<string> TranscribeAsync(
        string wavFilePath,
        string language = "auto",
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default,
        DateTimeOffset? recordedAt = null,
        TimeSpan clockSkew = default,
        bool enableSpeakerDiarization = false);
}
