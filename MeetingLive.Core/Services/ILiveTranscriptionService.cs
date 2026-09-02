namespace MeetingLive.Core.Services;

/// <summary>
/// True streaming transcription over the live mixed PCM tap. The text produced while recording
/// is the real transcript (cache-aware RNNT), not a preview. <see cref="Stop"/> finishes the
/// stream and returns the authoritative result. When live transcription is disabled, the
/// caller instead uses <see cref="ITranscriptionService"/> to offline-recognize the WAV with
/// the same Nemotron model.
/// </summary>
public interface ILiveTranscriptionService
{
    /// <summary>Raised on a background thread whenever committed or interim text changes.</summary>
    event EventHandler<string>? TranscriptUpdated;

    /// <summary>Creates the Nemotron recognizer and starts consuming
    /// <see cref="IAudioCaptureService.PcmFrameAvailable"/>. Safe to call while a previous
    /// session is still running — it is stopped first. Does not take a WAV path.</summary>
    void Start(string language);

    /// <summary>Finishes the stream, drains finals, releases native handles, and returns the
    /// authoritative transcript (empty if nothing was recognized). Safe to call when no
    /// session is running.</summary>
    string Stop();
}
