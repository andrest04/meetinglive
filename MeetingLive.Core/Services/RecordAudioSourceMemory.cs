using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public enum RememberedMicrophoneKind
{
    None = 0,
    SystemDefault = 1,
    Device = 2,
}

public readonly record struct RememberedMicrophone(RememberedMicrophoneKind Kind, string? DeviceId);

/// <summary>
/// What the Record page remembers between meetings: the microphone and the kind of meeting audio. Callers load the
/// current <see cref="AppSettings"/>, mutate it here, and save it back; these methods never create a settings object.
/// </summary>
public static class RecordAudioSourceMemory
{
    private const string SystemOutput = "System";
    private const string AppOutput = "App";

    public static void RememberMicrophone(AppSettings settings, RememberedMicrophoneKind kind, string? deviceId)
    {
        settings.RecordMicrophoneKind = kind.ToString();
        settings.RecordMicrophoneDeviceId = kind == RememberedMicrophoneKind.Device ? deviceId : null;
    }

    public static void RememberSystemAudio(AppSettings settings)
    {
        settings.RecordOutputKind = SystemOutput;
        settings.RecordAppExePath = null;
        settings.RecordAppName = null;
    }

    public static void RememberApp(AppSettings settings, string? exePath, string name)
    {
        settings.RecordOutputKind = AppOutput;
        settings.RecordAppExePath = exePath;
        settings.RecordAppName = name;
    }

    /// <summary>
    /// The microphone to preselect. Nothing remembered falls back to the Settings microphone; a remembered or
    /// Settings device that is no longer plugged in falls back to the OS default, never to none.
    /// </summary>
    public static RememberedMicrophone RestoreMicrophone(AppSettings settings, IReadOnlyCollection<string> availableDeviceIds)
    {
        var systemDefault = new RememberedMicrophone(RememberedMicrophoneKind.SystemDefault, null);

        if (Enum.TryParse<RememberedMicrophoneKind>(settings.RecordMicrophoneKind, ignoreCase: true, out var kind)
            && Enum.IsDefined(kind))
        {
            return kind switch
            {
                RememberedMicrophoneKind.None => new RememberedMicrophone(RememberedMicrophoneKind.None, null),
                RememberedMicrophoneKind.Device => DeviceOrDefault(settings.RecordMicrophoneDeviceId, availableDeviceIds),
                _ => systemDefault,
            };
        }

        return DeviceOrDefault(settings.SelectedMicrophoneDeviceId, availableDeviceIds);
    }

    /// <summary>
    /// The remembered app, only if an app with the same executable is playing audio right now. Null means all system
    /// audio: either nothing app-related was remembered, or the app is not playing.
    /// </summary>
    public static ActiveAudioApp? RestoreApp(AppSettings settings, IReadOnlyList<ActiveAudioApp> active)
    {
        if (!string.Equals(settings.RecordOutputKind, AppOutput, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(settings.RecordAppExePath))
            return null;

        return active.FirstOrDefault(app =>
            string.Equals(app.ExePath, settings.RecordAppExePath, StringComparison.OrdinalIgnoreCase));
    }

    private static RememberedMicrophone DeviceOrDefault(string? deviceId, IReadOnlyCollection<string> availableDeviceIds) =>
        !string.IsNullOrEmpty(deviceId) && availableDeviceIds.Contains(deviceId, StringComparer.Ordinal)
            ? new RememberedMicrophone(RememberedMicrophoneKind.Device, deviceId)
            : new RememberedMicrophone(RememberedMicrophoneKind.SystemDefault, null);
}
