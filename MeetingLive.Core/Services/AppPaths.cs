namespace MeetingLive.Core.Services;

/// <summary>
/// On-disk locations MeetingLive uses. User-visible meeting files live under
/// Documents so they follow the user's Documents folder (including OneDrive
/// redirection). App configuration, models, and credentials stay under
/// %LOCALAPPDATA%\MeetingLive.
/// </summary>
public static class AppPaths
{
    public static string RootDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeetingLive");

    public static string UserDataDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MeetingLive");

    /// <summary>Unfiled meetings. New recordings land here unless a Library folder is selected.</summary>
    public static string InboxDirectory { get; } = MeetingLibraryLayout.InboxDirectory(UserDataDirectory);

    /// <summary>Legacy flat WAV dump. New audio sits next to its markdown file.</summary>
    public static string RecordingsDirectory { get; } = Path.Combine(UserDataDirectory, "Recordings");

    /// <summary>Legacy model cache. Kept so leftover files from older builds can be cleaned up.</summary>
    public static string ModelsDirectory { get; } = Path.Combine(RootDirectory, "Models");

    /// <summary>Where the Nemotron 3.5 ASR GGUF is cached.</summary>
    public static string TranscriptionModelsDirectory { get; } = Path.Combine(RootDirectory, "TranscriptionModels");

    /// <summary>Where extracted NeMo-Speech.cpp CPU/CUDA runtimes live (<c>cpu\</c> and <c>cuda\</c>).</summary>
    public static string NemoSpeechRuntimeDirectory { get; } = Path.Combine(RootDirectory, "NemoSpeech");

    /// <summary>Where downloaded GGUF summary models are cached, kept separate from transcription models.</summary>
    public static string SummaryModelsDirectory { get; } = Path.Combine(RootDirectory, "SummaryModels");

    /// <summary>Legacy single-file JSON store. Superseded by <see cref="MeetingsDirectory"/>;
    /// kept only so <c>MeetingsMigrationService</c> can find and migrate it.</summary>
    public static string MeetingsFilePath { get; } = Path.Combine(RootDirectory, "meetings.json");

    /// <summary>Legacy flat markdown dump from the first Documents migration.</summary>
    public static string MeetingsDirectory { get; } = Path.Combine(UserDataDirectory, "Meetings");

    public static string SettingsFilePath { get; } = Path.Combine(RootDirectory, "settings.json");

    /// <summary>DPAPI-protected SuperGrok OAuth / xAI API-key blob. JWTs can exceed PasswordVault's
    /// 512-character limit, so this is a CurrentUser-encrypted file rather than Credential Locker.</summary>
    public static string XaiCredentialsFilePath { get; } = Path.Combine(RootDirectory, "xai-credentials.bin");

    /// <summary>Nested Library folders. Lives next to meetings, not as directories on disk.</summary>
    public static string FoldersFilePath { get; } = Path.Combine(UserDataDirectory, "folders.json");

    internal static string LegacyMeetingsDirectory { get; } = Path.Combine(RootDirectory, "Meetings");

    internal static string LegacyRecordingsDirectory { get; } = Path.Combine(RootDirectory, "Recordings");

    internal static string LegacyFoldersFilePath { get; } = Path.Combine(RootDirectory, "folders.json");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(InboxDirectory);
        Directory.CreateDirectory(TranscriptionModelsDirectory);
        Directory.CreateDirectory(NemoSpeechRuntimeDirectory);
        Directory.CreateDirectory(SummaryModelsDirectory);
        TryDeleteLeftoverWhisperCache();
    }

    /// <summary>Best-effort delete of Whisper GGML left by older builds (~1.6 GB).</summary>
    private static void TryDeleteLeftoverWhisperCache()
    {
        TryDeleteDirectory(Path.Combine(RootDirectory, "WhisperModels"));
        TryDeleteFile(Path.Combine(ModelsDirectory, "ggml-base.bin"));
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static void TryDeleteFile(string path)
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
