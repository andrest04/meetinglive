namespace MeetingLive.Core.Services;

/// <summary>One enumerated microphone (WASAPI capture endpoint): its stable device id
/// (<see cref="NAudio.CoreAudioApi.MMDevice.ID"/>) and friendly display name.</summary>
public sealed record MicrophoneDeviceOption(string Id, string Name);

public interface IMicrophoneDeviceService
{
    /// <summary>Lists the currently active microphones (capture endpoints) available for recording.</summary>
    IReadOnlyList<MicrophoneDeviceOption> GetAvailableMicrophones();
}
