namespace MeetingLive_App.ViewModels;

/// <summary>
/// One row in the per-meeting microphone combo. None is not an empty device id:
/// an empty id is the OS default, matching Settings.
/// </summary>
public sealed class RecordingMicrophoneChoice
{
    public RecordingMicrophoneChoice(RecordingMicrophoneKind kind, string displayName, string? deviceId = null)
    {
        Kind = kind;
        DisplayName = displayName;
        DeviceId = deviceId;
    }

    public RecordingMicrophoneKind Kind { get; }

    public string DisplayName { get; }

    /// <summary>WASAPI device id when <see cref="Kind"/> is <see cref="RecordingMicrophoneKind.Device"/>.
    /// Null for none and for the OS default.</summary>
    public string? DeviceId { get; }
}

public enum RecordingMicrophoneKind
{
    None = 0,
    SystemDefault = 1,
    Device = 2,
}
