namespace MeetingLive.Core.Services;

/// <summary>
/// Streaming transcription over the live mixed PCM tap for on-screen preview.
/// The saved meeting transcript is produced by <see cref="ITranscriptionService"/> over the
/// finished WAV (NVIDIA's full-utterance Recognize path). <see cref="Stop"/> still finishes
/// the stream so native handles are released.
/// </summary>
public interface ILiveTranscriptionService
{
    /// <summary>Raised on a background thread whenever committed or interim text changes.</summary>
    event EventHandler<string>? TranscriptUpdated;

    /// <summary>Creates the Nemotron recognizer and starts consuming
    /// <see cref="IAudioCaptureService.PcmFrameAvailable"/>. Safe to call while a previous
    /// session is still running — it is stopped first. Does not take a WAV path.</summary>
    void Start(string language);

    /// <summary>Finishes the stream, drains finals, and releases native handles. The returned
    /// text is the last live preview, not the saved transcript. Safe to call when no session
    /// is running.</summary>
    string Stop();
}
