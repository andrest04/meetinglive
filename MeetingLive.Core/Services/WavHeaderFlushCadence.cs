using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>
/// Decides when the capture pump should rewrite the WAV header (RIFF/data sizes) so a recording
/// that dies abruptly stays readable. Counts written bytes, so paused time never triggers it.
/// Not thread-safe: owned by the single pump thread that also writes the audio.
/// </summary>
internal sealed class WavHeaderFlushCadence
{
    private readonly long _intervalBytes;
    private long _lastFlushBytes;

    public WavHeaderFlushCadence(long intervalBytes)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(intervalBytes, 0);
        _intervalBytes = intervalBytes;
    }

    public static WavHeaderFlushCadence ForFormat(WaveFormat format, TimeSpan interval)
    {
        ArgumentNullException.ThrowIfNull(format);
        return new WavHeaderFlushCadence((long)(format.AverageBytesPerSecond * interval.TotalSeconds));
    }

    public bool ShouldFlush(long totalBytesWritten)
    {
        if (totalBytesWritten - _lastFlushBytes < _intervalBytes)
            return false;

        _lastFlushBytes = totalBytesWritten;
        return true;
    }
}
