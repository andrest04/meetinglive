using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>One input of a recording's mix.</summary>
public enum CaptureSource
{
    Microphone,

    /// <summary>System loopback or a process tree, whichever the recording opened.</summary>
    Output,
}

/// <summary>A source died mid-recording. <paramref name="RemainingSources"/> counts the sources still
/// capturing, so zero means the recording is only writing silence.</summary>
public sealed record CaptureSourceLostEventArgs(CaptureSource Source, int RemainingSources, Exception Error);

public interface IAudioCaptureService
{
    bool IsRecording { get; }

    bool IsPaused { get; }

    /// <summary>Raised from the capture pump with the same mixed 16 kHz mono stream that is
    /// written to the WAV, converted to float32 in [-1, 1]. Only fired when there are subscribers.</summary>
    event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

    /// <summary>
    /// Raised when a process-tree output capture stops with an error after start.
    /// Not raised for system loopback errors or for a caller-initiated stop. The WAV pump is
    /// cancelled so the file does not keep growing with silence.
    /// </summary>
    event EventHandler<Exception>? OutputCaptureFailed;

    /// <summary>
    /// Raised when a microphone or system-loopback source stops with an error after start. Recording
    /// continues with whatever is left; the caller decides what to tell the user. Not raised for a
    /// caller-initiated stop, nor for a process-tree failure, which is <see cref="OutputCaptureFailed"/>.
    /// Raised on a capture thread.
    /// </summary>
    event EventHandler<CaptureSourceLostEventArgs>? CaptureSourceLost
    {
        add { }
        remove { }
    }

    /// <summary>
    /// Raised when the WAV pump dies after start, for example on a full disk, so no more audio is being
    /// written. The caller should stop: <see cref="StopAsync"/> closes the file so the audio already
    /// written stays readable, and rethrows this error. Raised on the pump thread.
    /// </summary>
    event EventHandler<Exception>? CaptureFaulted
    {
        add { }
        remove { }
    }

    /// <summary>Starts capturing the microphone plus system loopback, mixed into a single 16 kHz mono WAV.
    /// <paramref name="microphoneDeviceId"/> is the <see cref="NAudio.CoreAudioApi.MMDevice.ID"/> of
    /// the microphone to record from; null/empty (or a device that no longer exists) falls back to
    /// the OS default input device. This overload always opens a microphone. To skip it, or to
    /// capture one process tree instead of system loopback, use
    /// <see cref="Start(string, RecordingCaptureSources)"/>.</summary>
    void Start(string outputWavPath, string? microphoneDeviceId = null);

    /// <summary>
    /// Starts capture into a 16 kHz mono WAV using <paramref name="sources"/>.
    /// <see cref="RecordingCaptureSources.CaptureMicrophone"/> false does not open a microphone.
    /// A null or empty device id with capture enabled is the OS default, not "no microphone".
    /// Output is system loopback or one process tree, never both.
    /// </summary>
    void Start(string outputWavPath, RecordingCaptureSources sources);

    /// <summary>Stops capture and flushes the WAV file to disk. Prefer
    /// <see cref="StopAsync"/> from UI code — this sync overload waits for the pump thread.</summary>
    void Stop();

    /// <summary>Stops capture and flushes the WAV file without blocking the caller on
    /// <see cref="Task.Wait"/> / <c>GetResult</c>.</summary>
    Task StopAsync();

    /// <summary>Keeps the WAV open but drops incoming audio so a break is not recorded.
    /// No-op when not recording. Resume with <see cref="Resume"/>.</summary>
    void Pause();

    /// <summary>Continues appending to the same WAV after <see cref="Pause"/>.</summary>
    void Resume();
}
