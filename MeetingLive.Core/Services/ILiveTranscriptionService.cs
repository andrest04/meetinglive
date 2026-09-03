namespace MeetingLive.Core.Services;

/// <summary>
/// Streaming transcription over the live mixed PCM tap for on-screen preview.
/// The saved meeting transcript is produced by <see cref="ITranscriptionService"/> (Nemotron
/// over the finished WAV). <see cref="Stop"/> closes the live stream without native
/// <c>stream_finish</c> — that flush aborts the CUDA runtime after a long session.
/// </summary>
public interface ILiveTranscriptionService
{
    /// <summary>Raised on a background thread whenever committed or interim text changes.</summary>
    event EventHandler<string>? TranscriptUpdated;

    /// <summary>Creates the Nemotron recognizer and starts consuming
    /// <see cref="IAudioCaptureService.PcmFrameAvailable"/>. Safe to call while a previous
    /// session is still running — it is stopped first. Does not take a WAV path.
    /// <paramref name="recordedAt"/> stamps committed lines with elapsed and wall-clock time.</summary>
    void Start(string language, DateTimeOffset recordedAt);

    /// <summary>Closes the live stream and releases native handles without a CUDA
    /// <c>stream_finish</c> flush. The returned text is the last live preview, not the
    /// saved transcript. Safe to call when no session is running.</summary>
    string Stop();

    /// <summary>Adds pause duration to wall-clock stamps without changing elapsed WAV time.</summary>
    void SetClockSkew(TimeSpan skew);
}
