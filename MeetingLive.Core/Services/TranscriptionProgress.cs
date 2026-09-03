namespace MeetingLive.Core.Services;

/// <summary>
/// Maps a Whisper segment timestamp onto a 0–100 percent of WAV duration.
/// </summary>
public static class TranscriptionProgress
{
    public static int ToPercent(TimeSpan position, TimeSpan duration)
    {
        if (duration <= TimeSpan.Zero)
            return 0;

        var percent = (int)Math.Round(
            100d * position.TotalSeconds / duration.TotalSeconds,
            MidpointRounding.AwayFromZero);
        return Math.Clamp(percent, 0, 100);
    }
}
