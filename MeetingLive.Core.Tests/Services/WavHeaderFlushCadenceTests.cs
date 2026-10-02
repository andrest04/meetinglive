using MeetingLive.Core.Services;
using NAudio.Wave;

namespace MeetingLive.Core.Tests.Services;

public sealed class WavHeaderFlushCadenceTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveHeaderFlush_" + Guid.NewGuid());

    public WavHeaderFlushCadenceTests()
    {
        Directory.CreateDirectory(_tempDirectory);
    }

    [Fact]
    public void ShouldFlush_BelowInterval_ReturnsFalse()
    {
        var sut = new WavHeaderFlushCadence(intervalBytes: 1000);

        Assert.False(sut.ShouldFlush(999));
    }

    [Fact]
    public void ShouldFlush_AtInterval_ReturnsTrueOnce()
    {
        var sut = new WavHeaderFlushCadence(intervalBytes: 1000);

        Assert.True(sut.ShouldFlush(1000));
        Assert.False(sut.ShouldFlush(1000));
    }

    [Fact]
    public void ShouldFlush_NextIntervalCountsFromLastFlush()
    {
        var sut = new WavHeaderFlushCadence(intervalBytes: 1000);
        Assert.True(sut.ShouldFlush(1200));

        Assert.False(sut.ShouldFlush(2199));
        Assert.True(sut.ShouldFlush(2200));
    }

    [Fact]
    public void ForFormat_UsesSecondsOfAudio()
    {
        var format = new WaveFormat(16000, 16, 1);

        var sut = WavHeaderFlushCadence.ForFormat(format, TimeSpan.FromSeconds(5));

        Assert.False(sut.ShouldFlush(5 * format.AverageBytesPerSecond - 1));
        Assert.True(sut.ShouldFlush(5 * format.AverageBytesPerSecond));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Ctor_NonPositiveInterval_Throws(long interval)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new WavHeaderFlushCadence(interval));
    }

    [Fact]
    public void WriterFlush_WhileOpen_LeavesCopyReadableWithWrittenLength()
    {
        var path = Path.Combine(_tempDirectory, "open.wav");
        var copy = Path.Combine(_tempDirectory, "open-copy.wav");
        var format = new WaveFormat(16000, 16, 1);
        var pcm = new byte[format.AverageBytesPerSecond * 2];

        using var writer = new WaveFileWriter(path, format);
        writer.Write(pcm, 0, pcm.Length);
        writer.Flush();
        CopyShared(path, copy);

        using var reader = new WaveFileReader(copy);
        Assert.Equal(pcm.Length, reader.Length);
        Assert.Equal(2, (int)reader.TotalTime.TotalSeconds);
    }

    [Fact]
    public void WriterFlush_ThenMoreWrites_NextFlushCoversAllAudio()
    {
        var path = Path.Combine(_tempDirectory, "open2.wav");
        var copy = Path.Combine(_tempDirectory, "open2-copy.wav");
        var format = new WaveFormat(16000, 16, 1);
        var pcm = new byte[format.AverageBytesPerSecond];

        using var writer = new WaveFileWriter(path, format);
        writer.Write(pcm, 0, pcm.Length);
        writer.Flush();
        writer.Write(pcm, 0, pcm.Length);
        writer.Flush();
        CopyShared(path, copy);

        using var reader = new WaveFileReader(copy);
        Assert.Equal(pcm.Length * 2L, reader.Length);
    }

    [Fact]
    public void WriterWithoutFlush_WhileOpen_CopyHasUnreadableHeader()
    {
        // Characterizes the bug: without a periodic header update an abrupt exit loses the audio.
        var path = Path.Combine(_tempDirectory, "noflush.wav");
        var copy = Path.Combine(_tempDirectory, "noflush-copy.wav");
        var format = new WaveFormat(16000, 16, 1);
        var pcm = new byte[format.AverageBytesPerSecond];

        using var writer = new WaveFileWriter(path, format);
        writer.Write(pcm, 0, pcm.Length);
        CopyShared(path, copy);

        Assert.ThrowsAny<Exception>(() =>
        {
            using var reader = new AudioFileReader(copy);
            if (reader.Length == 0)
                throw new InvalidDataException("Empty data chunk.");
        });
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private static void CopyShared(string source, string destination)
    {
        using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var output = File.Create(destination);
        input.CopyTo(output);
    }
}
