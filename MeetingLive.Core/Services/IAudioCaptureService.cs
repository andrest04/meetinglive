namespace MeetingLive.Core.Services;

public interface IAudioCaptureService
{
    bool IsRecording { get; }

    /// <summary>Starts capturing mic + system loopback, mixed into a single 16kHz mono WAV file.</summary>
    void Start(string outputWavPath);

    /// <summary>Stops capture and flushes the WAV file to disk.</summary>
    void Stop();
}
