namespace MeetingLive.Core.Models;

/// <summary>
/// Nemotron streaming latency profile. Larger right context lowers WER at the cost of latency.
/// <see cref="Live"/> keeps the on-screen preview responsive (320 ms); <see cref="Offline"/> is
/// for the post-Stop WAV pass, which has no realtime constraint (1.12 s, best accuracy).
/// </summary>
public enum AsrLatencyProfile
{
    Live,
    Offline,
}

public static class AsrLatencyProfileExtensions
{
    /// <summary>
    /// Encoder right-context frames (80 ms each). The model only supports 0, 1, 3, 6 and 13.
    /// </summary>
    public static int RightContextFrames(this AsrLatencyProfile profile) => profile switch
    {
        AsrLatencyProfile.Live => 3,
        AsrLatencyProfile.Offline => 13,
        _ => throw new ArgumentOutOfRangeException(nameof(profile), profile, null),
    };
}
