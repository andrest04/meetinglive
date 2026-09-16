using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>Reads duration from a WAV (or other NAudio-readable) file without converting it.</summary>
public static class WavFileDuration
{
    public static TimeSpan ReadTotalTime(string wavPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(wavPath);
        using var reader = new AudioFileReader(wavPath);
        return reader.TotalTime;
    }
}
