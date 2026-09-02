using NAudio.CoreAudioApi;

namespace MeetingLive.Core.Services;

/// <summary>Shared microphone-endpoint resolution used by both the real recording pipeline
/// (<see cref="AudioCaptureService"/>) and the Settings-page live level preview
/// (<see cref="MicrophoneLevelMeterService"/>), so both agree on the same "which device do we
/// actually open" fallback rules.</summary>
internal static class MicrophoneDeviceResolver
{
    /// <summary>Resolves the microphone to open by device id. Falls back to the OS default
    /// input device when <paramref name="microphoneDeviceId"/> is null/empty, or when the
    /// previously selected device has been unplugged / no longer exists — never throws.</summary>
    public static MMDevice Resolve(string? microphoneDeviceId)
    {
        // Not disposed: matches NAudio's own parameterless WasapiCapture() default-device
        // resolution, which never disposes its MMDeviceEnumerator either — the returned MMDevice
        // is an independent COM object whose lifetime must outlive this method.
        var enumerator = new MMDeviceEnumerator();

        if (!string.IsNullOrEmpty(microphoneDeviceId))
        {
            try
            {
                var device = enumerator.GetDevice(microphoneDeviceId);
                if (device.State == DeviceState.Active)
                    return device;
            }
            catch (Exception)
            {
                // Device id no longer resolves (unplugged / removed) — fall back to default below.
            }
        }

        // Role.Console matches NAudio's own parameterless WasapiCapture() default-device resolution.
        return enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
    }
}
