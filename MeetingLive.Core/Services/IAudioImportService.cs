namespace MeetingLive.Core.Services;

/// <summary>Converts an arbitrary audio file into the 16 kHz mono PCM WAV Nemotron expects.</summary>
public interface IAudioImportService
{
    /// <summary>
    /// Reads <paramref name="sourcePath"/> and writes a 16 kHz mono PCM16 WAV to
    /// <paramref name="destinationWavPath"/>. The destination directory is created if needed.
    /// Throws when the source is missing, unreadable, or contains no audio. Deletes a partial
    /// destination file on failure.
    /// </summary>
    void ConvertToNemotronWav(
        string sourcePath,
        string destinationWavPath,
        CancellationToken cancellationToken = default);
}
