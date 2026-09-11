using NAudio.Wave;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public sealed class AudioImportServiceTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveAudioImport_" + Guid.NewGuid());
    private readonly AudioImportService _sut = new();

    public AudioImportServiceTests()
    {
        Directory.CreateDirectory(_tempDirectory);
    }

    [Fact]
    public void ConvertToNemotronWav_Stereo44100Pcm_Writes16kHzMonoPcm16()
    {
        var source = Path.Combine(_tempDirectory, "stereo44100.wav");
        var dest = Path.Combine(_tempDirectory, "out.wav");
        var duration = TimeSpan.FromMilliseconds(500);
        WritePcmWav(source, sampleRate: 44100, channels: 2, duration);

        _sut.ConvertToNemotronWav(source, dest);

        using var reader = new WaveFileReader(dest);
        Assert.Equal(16000, reader.WaveFormat.SampleRate);
        Assert.Equal(1, reader.WaveFormat.Channels);
        Assert.Equal(16, reader.WaveFormat.BitsPerSample);
        Assert.Equal(WaveFormatEncoding.Pcm, reader.WaveFormat.Encoding);
        Assert.InRange(reader.TotalTime.TotalMilliseconds, duration.TotalMilliseconds - 50, duration.TotalMilliseconds + 50);
    }

    [Fact]
    public void ConvertToNemotronWav_Already16kHzMono_WritesValidDestinationWav()
    {
        var source = Path.Combine(_tempDirectory, "already16k.wav");
        var dest = Path.Combine(_tempDirectory, "copy.wav");
        WritePcmWav(source, sampleRate: 16000, channels: 1, TimeSpan.FromMilliseconds(250));

        _sut.ConvertToNemotronWav(source, dest);

        Assert.True(File.Exists(dest));
        using var reader = new WaveFileReader(dest);
        Assert.Equal(16000, reader.WaveFormat.SampleRate);
        Assert.Equal(1, reader.WaveFormat.Channels);
        Assert.Equal(16, reader.WaveFormat.BitsPerSample);
        Assert.Equal(WaveFormatEncoding.Pcm, reader.WaveFormat.Encoding);
        Assert.True(reader.Length > 0);
    }

    [Fact]
    public void ConvertToNemotronWav_MissingSource_Throws()
    {
        var missing = Path.Combine(_tempDirectory, "missing.wav");
        var dest = Path.Combine(_tempDirectory, "never.wav");

        Assert.Throws<FileNotFoundException>(() => _sut.ConvertToNemotronWav(missing, dest));
        Assert.False(File.Exists(dest));
    }

    [Fact]
    public void ConvertToNemotronWav_NonAudioBytes_ThrowsAndDoesNotLeaveValidWav()
    {
        var source = Path.Combine(_tempDirectory, "garbage.wav");
        var dest = Path.Combine(_tempDirectory, "partial.wav");
        File.WriteAllBytes(source, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

        Assert.ThrowsAny<Exception>(() => _sut.ConvertToNemotronWav(source, dest));

        Assert.False(IsValidNemotronWav(dest));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private static void WritePcmWav(string path, int sampleRate, int channels, TimeSpan duration)
    {
        var format = new WaveFormat(sampleRate, 16, channels);
        using var writer = new WaveFileWriter(path, format);
        var frames = (int)(sampleRate * duration.TotalSeconds);
        var samples = new float[frames * channels];
        for (var i = 0; i < frames; i++)
        {
            var value = (float)Math.Sin(2 * Math.PI * 440 * i / sampleRate) * 0.2f;
            for (var channel = 0; channel < channels; channel++)
                samples[i * channels + channel] = value;
        }

        writer.WriteSamples(samples, 0, samples.Length);
    }

    private static bool IsValidNemotronWav(string path)
    {
        if (!File.Exists(path))
            return false;

        try
        {
            using var reader = new WaveFileReader(path);
            return reader.WaveFormat.SampleRate == 16000
                && reader.WaveFormat.Channels == 1
                && reader.WaveFormat.BitsPerSample == 16
                && reader.WaveFormat.Encoding == WaveFormatEncoding.Pcm
                && reader.Length > 0;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
