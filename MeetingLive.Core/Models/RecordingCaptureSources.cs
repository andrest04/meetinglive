namespace MeetingLive.Core.Models;

/// <summary>
/// Per-recording capture request. Microphone and output are independent.
/// <see cref="CaptureMicrophone"/> false means do not open a microphone. That is not an empty
/// device id: a null or empty <see cref="MicrophoneDeviceId"/> with capture enabled is the OS default.
/// Output is exactly one of system loopback or one process tree.
/// </summary>
public sealed class RecordingCaptureSources
{
    public RecordingCaptureSources(
        bool captureMicrophone,
        string? microphoneDeviceId,
        RecordingOutputKind output,
        uint processId)
    {
        CaptureMicrophone = captureMicrophone;
        MicrophoneDeviceId = microphoneDeviceId;
        Output = output;
        ProcessId = processId;
        ThrowIfInvalid();
    }

    public bool CaptureMicrophone { get; }

    public string? MicrophoneDeviceId { get; }

    public RecordingOutputKind Output { get; }

    public uint ProcessId { get; }

    public bool UsesSystemLoopback => Output == RecordingOutputKind.SystemLoopback;

    /// <summary>Microphone (or none) plus all system audio. Does not require a process id.</summary>
    public static RecordingCaptureSources SystemLoopback(bool captureMicrophone, string? microphoneDeviceId) =>
        new(captureMicrophone, microphoneDeviceId, RecordingOutputKind.SystemLoopback, 0);

    /// <summary>
    /// Microphone (or none) plus one process tree. Does not also capture system loopback.
    /// Process id 0 throws <see cref="ArgumentOutOfRangeException"/> before any device is opened.
    /// </summary>
    public static RecordingCaptureSources ProcessTree(bool captureMicrophone, string? microphoneDeviceId, uint processId) =>
        new(captureMicrophone, microphoneDeviceId, RecordingOutputKind.ProcessTree, processId);

    /// <summary>
    /// Rejects neither output, both outputs, an undefined kind, and process id 0.
    /// Safe to call before opening a device.
    /// </summary>
    public void ThrowIfInvalid()
    {
        if (!Enum.IsDefined(Output))
            throw new ArgumentException("Output must be exactly system loopback or one process tree.", nameof(Output));

        if (Output == RecordingOutputKind.ProcessTree)
        {
            if (ProcessId == 0)
                throw new ArgumentOutOfRangeException("processId", ProcessId, "Process id 0 is not a valid capture target.");

            return;
        }

        if (ProcessId != 0)
            throw new ArgumentException("System loopback cannot also target a process.", "processId");
    }
}

/// <summary>Where the other side of the meeting is captured from. Exactly one value is valid.</summary>
public enum RecordingOutputKind
{
    SystemLoopback = 0,
    ProcessTree = 1,
}
