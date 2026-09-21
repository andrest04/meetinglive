namespace MeetingLive.Core.Services;

/// <summary>
/// One live-transcript snapshot. <see cref="DisplayText"/> is committed lines plus the
/// rewritten interim suffix. <see cref="CommittedText"/> is finals only.
/// </summary>
public readonly record struct LiveTranscriptUpdate(string DisplayText, string CommittedText);

/// <summary>
/// Streaming transcription over the live mixed PCM tap. Non-empty <see cref="Stop"/>
/// text is saved immediately as a draft. <see cref="ITranscriptionService"/> then re-reads
/// the WAV and replaces that transcript when it produces text. <see cref="Stop"/> closes
/// the live stream without native <c>stream_finish</c> — that flush aborts CUDA after a long session.
/// </summary>
public interface ILiveTranscriptionService
{
    /// <summary>
    /// Raised on a background thread after a frame is applied. Carries display text and
    /// committed text separately so callers can detect questions without treating interim
    /// rewrites as new lines. Subscribers must not block the caller.
    /// </summary>
    event EventHandler<LiveTranscriptUpdate>? TranscriptUpdated;

    /// <summary>Creates the Nemotron recognizer and starts consuming
    /// <see cref="IAudioCaptureService.PcmFrameAvailable"/>. Safe to call while a previous
    /// session is still running — it is stopped first. Does not take a WAV path.
    /// <paramref name="recordedAt"/> stamps committed lines with elapsed and wall-clock time.</summary>
    void Start(string language, DateTimeOffset recordedAt, bool enableSpeakerDiarization = false);

    /// <summary>Closes the live stream and releases native handles without a CUDA
    /// <c>stream_finish</c> flush. Non-empty returned text is the draft saved at Stop;
    /// the WAV pass may replace it. Safe to call when no session is running.</summary>
    string Stop();

    /// <summary>Adds pause duration to wall-clock stamps without changing elapsed WAV time.</summary>
    void SetClockSkew(TimeSpan skew);
}
