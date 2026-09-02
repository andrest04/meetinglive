using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IAudioCaptureService
{
    bool IsRecording { get; }

    /// <summary>Raised from the capture pump with the same mixed 16 kHz mono stream that is
    /// written to the WAV, converted to float32 in [-1, 1]. Only fired when there are subscribers.</summary>
    event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

    /// <summary>Starts capturing mic + system loopback, mixed into a single 16kHz mono WAV file.
    /// <paramref name="microphoneDeviceId"/> is the <see cref="NAudio.CoreAudioApi.MMDevice.ID"/> of
    /// the microphone to record from; null/empty (or a device that no longer exists) falls back to
    /// the OS default input device.</summary>
    void Start(string outputWavPath, string? microphoneDeviceId = null);

    /// <summary>Stops capture and flushes the WAV file to disk.</summary>
    void Stop();
}
