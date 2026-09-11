using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace MeetingLive.Core.Services;

/// <summary>
/// Copies a user-picked audio file into a 16 kHz mono PCM WAV under our recordings folder
/// so the existing post-Stop Nemotron pipeline can run without live ASR.
/// </summary>
public sealed class AudioImportService : IAudioImportService
{
    private const int TargetSampleRate = 16000;

    public void ConvertToNemotronWav(
        string sourcePath,
        string destinationWavPath,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourcePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationWavPath);

        if (!File.Exists(sourcePath))
            throw new FileNotFoundException("The audio file was not found.", sourcePath);

        var destinationDirectory = Path.GetDirectoryName(destinationWavPath);
        if (!string.IsNullOrEmpty(destinationDirectory))
            Directory.CreateDirectory(destinationDirectory);

        try
        {
            using var reader = new AudioFileReader(sourcePath);
            ISampleProvider sample = reader.WaveFormat.Channels == 2 ? reader.ToMono() : reader;
            if (sample.WaveFormat.SampleRate != TargetSampleRate)
                sample = new WdlResamplingSampleProvider(sample, TargetSampleRate);

            var pcm16 = sample.ToWaveProvider16();
            using var writer = new WaveFileWriter(destinationWavPath, pcm16.WaveFormat);
            var buffer = new byte[Math.Max(pcm16.WaveFormat.AverageBytesPerSecond, 4096)];
            long bytesWritten = 0;
            int read;
            while ((read = pcm16.Read(buffer, 0, buffer.Length)) > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                writer.Write(buffer, 0, read);
                bytesWritten += read;
            }

            if (bytesWritten == 0)
                throw new InvalidDataException("The audio file contained no samples.");
        }
        catch
        {
            TryDelete(destinationWavPath);
            throw;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }
}
