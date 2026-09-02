using NAudio.CoreAudioApi;

namespace MeetingLive.Core.Services;

/// <summary>Enumerates active WASAPI capture (microphone) endpoints via NAudio's
/// <see cref="MMDeviceEnumerator"/> for the microphone picker in Settings.</summary>
public sealed class MicrophoneDeviceService : IMicrophoneDeviceService
{
    public IReadOnlyList<MicrophoneDeviceOption> GetAvailableMicrophones()
    {
        using var enumerator = new MMDeviceEnumerator();
        var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);

        return devices
            .Select(device => new MicrophoneDeviceOption(device.ID, device.FriendlyName))
            .ToList();
    }
}
