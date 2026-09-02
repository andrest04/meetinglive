namespace MeetingLive.Core.Services;

/// <summary>
/// Central place for the on-disk locations MeetingLive uses for recordings,
/// transcription/summary models, the NeMo-Speech runtime, and persistence.
/// Everything lives under %LOCALAPPDATA%\MeetingLive so the app needs no installer-level setup.
/// </summary>
public static class AppPaths
{
    public static string RootDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeetingLive");

    public static string RecordingsDirectory { get; } = Path.Combine(RootDirectory, "Recordings");

    /// <summary>Legacy Whisper GGML cache. Kept so leftover files from older builds are still findable.</summary>
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

    /// <summary>Where each meeting is persisted as its own <c>{id}.md</c> file.</summary>
    public static string MeetingsDirectory { get; } = Path.Combine(RootDirectory, "Meetings");

    public static string SettingsFilePath { get; } = Path.Combine(RootDirectory, "settings.json");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(RecordingsDirectory);
        Directory.CreateDirectory(ModelsDirectory);
        Directory.CreateDirectory(TranscriptionModelsDirectory);
        Directory.CreateDirectory(NemoSpeechRuntimeDirectory);
        Directory.CreateDirectory(SummaryModelsDirectory);
        Directory.CreateDirectory(MeetingsDirectory);
    }
}
