namespace MeetingLive.Core.Services;

/// <summary>
/// Central place for the on-disk locations MeetingLive uses for recordings,
/// Whisper models, and JSON persistence. Everything lives under
/// %LOCALAPPDATA%\MeetingLive so the app needs no installer-level setup.
/// </summary>
public static class AppPaths
{
    public static string RootDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeetingLive");

    public static string RecordingsDirectory { get; } = Path.Combine(RootDirectory, "Recordings");

    public static string ModelsDirectory { get; } = Path.Combine(RootDirectory, "Models");

    /// <summary>Where downloaded GGUF summary models are cached, kept separate from the Whisper models.</summary>
    public static string SummaryModelsDirectory { get; } = Path.Combine(RootDirectory, "SummaryModels");

    public static string MeetingsFilePath { get; } = Path.Combine(RootDirectory, "meetings.json");

    public static string SettingsFilePath { get; } = Path.Combine(RootDirectory, "settings.json");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(RecordingsDirectory);
        Directory.CreateDirectory(ModelsDirectory);
        Directory.CreateDirectory(SummaryModelsDirectory);
    }
}
