using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// Hand-rolled composition root — the app has no DI container yet, so this
/// wires up the Core services once and exposes them as app-lifetime
/// singletons for ViewModels to consume.
/// </summary>
public static class AppServices
{
    private static readonly Lazy<HttpClient> LazyModelDownloadHttpClient = new(() => new HttpClient
    {
        Timeout = Timeout.InfiniteTimeSpan,
    });

    private static readonly Lazy<HttpClient> LazyXaiHttpClient = new(CreateXaiHttpClient);

    private static readonly Lazy<HttpClient> LazyTypeSafeHttpClient = new(() => new HttpClient
    {
        Timeout = TimeSpan.FromMinutes(2),
    });

    private static HttpClient CreateXaiHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MeetingLive");
        return client;
    }

    public static IAudioCaptureService AudioCapture { get; } = new AudioCaptureService();

    public static IAudioImportService AudioImport { get; } = new AudioImportService();

    public static IMicrophoneDeviceService Microphones { get; } = new MicrophoneDeviceService();

    public static IMicrophoneLevelMeterService MicrophoneLevelMeter { get; } = new MicrophoneLevelMeterService();

    public static INemotronModelManager NemotronModels { get; } = new NemotronModelManager(LazyModelDownloadHttpClient.Value);

    public static INemoSpeechRuntimeManager NemoSpeechRuntime { get; } = new NemoSpeechRuntimeManager(LazyModelDownloadHttpClient.Value);

    public static INemoSpeechAsrEngine NemoSpeechEngine { get; } = new NativeNemoSpeechAsrEngine();

    public static IHardwareDetectionService HardwareDetection { get; } = new HardwareDetectionService();

    public static ITranscriptionService Transcription { get; } = new TranscriptionService(
        NemotronModels, NemoSpeechRuntime, NemoSpeechEngine, HardwareDetection);

    public static ILiveTranscriptionService LiveTranscription { get; } = new LiveTranscriptionService(
        AudioCapture, NemotronModels, NemoSpeechRuntime, NemoSpeechEngine, HardwareDetection);

    public static ILocalLlmModelManager LocalLlmModels { get; } = new LocalLlmModelManager(LazyModelDownloadHttpClient.Value);

    public static IMeetingRepository Meetings { get; } = new MarkdownMeetingRepository();

    public static IFolderRepository Folders { get; } = new JsonFolderRepository();

    public static IChatThreadRepository ChatThreads { get; } = new JsonChatThreadRepository();

    public static IChatRecipeRepository ChatRecipes { get; } = new JsonChatRecipeRepository();

    public static IAppSettingsService Settings { get; } = new AppSettingsService();

    public static IXaiCredentialStore XaiCredentials { get; } = new FileDpapiXaiCredentialStore();

    public static XaiOAuthClient XaiOAuth { get; } = new(LazyXaiHttpClient.Value);

    public static XaiApiClient XaiApi { get; } = new(LazyXaiHttpClient.Value);

    public static XaiAuthSession XaiAuth { get; } = new(XaiCredentials, XaiOAuth);

    public static ITypeSafeCredentialStore TypeSafeCredentials { get; } = new FileDpapiTypeSafeCredentialStore();

    public static TypeSafeApiClient TypeSafeApi { get; } = new(LazyTypeSafeHttpClient.Value);

    public static MeetingJevService MeetingJev { get; } = new(TypeSafeApi, TypeSafeCredentials);

    public static WorkspaceService Workspace { get; } = new();

    /// <summary>
    /// Creates a summary provider for the given <paramref name="kind"/>. A factory (rather
    /// than a singleton) because the selection can change between recordings, and the Local
    /// provider owns its own loaded model weights per instance. <paramref name="localModelPath"/>
    /// is required for <see cref="SummaryProviderKind.Local"/> and ignored otherwise.
    /// </summary>
    public static ISummaryProvider CreateSummaryProvider(SummaryProviderKind kind, string? localModelPath) => kind switch
    {
        SummaryProviderKind.Local => new LocalLlmSummaryProvider(
            localModelPath ?? throw new ArgumentNullException(nameof(localModelPath), "A local model path is required for the Local summary provider.")),
        SummaryProviderKind.ClaudeCode => CreateClaudeSummary(),
        SummaryProviderKind.Codex => CreateCodexSummary(),
        SummaryProviderKind.Xai => new XaiSummaryProvider(XaiAuth, XaiApi, ResolveXaiModelId(), ResolveXaiEffort()),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown summary provider kind."),
    };

    /// <summary>
    /// Creates a transcript polisher matching <paramref name="kind"/> so polish and summary
    /// use the same engine. <paramref name="localModelPath"/> is required for Local.
    /// </summary>
    public static ITranscriptPolisher CreateTranscriptPolisher(SummaryProviderKind kind, string? localModelPath) => kind switch
    {
        SummaryProviderKind.Local => new LocalLlmTranscriptPolisher(
            localModelPath ?? throw new ArgumentNullException(nameof(localModelPath), "A local model path is required for the Local transcript polisher.")),
        SummaryProviderKind.ClaudeCode => CreateClaudePolisher(),
        SummaryProviderKind.Codex => CreateCodexPolisher(),
        SummaryProviderKind.Xai => new XaiTranscriptPolisher(XaiAuth, XaiApi, ResolveXaiModelId(), ResolveXaiEffort()),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown summary provider kind."),
    };

    private static ClaudeCodeCliSummaryProvider CreateClaudeSummary()
    {
        var settings = LoadSettingsSnapshot();
        return new ClaudeCodeCliSummaryProvider(
            new CliProcessRunner(),
            settings.ResolveClaudeModelId(),
            settings.ResolveClaudeEffort());
    }

    private static CodexCliSummaryProvider CreateCodexSummary()
    {
        var settings = LoadSettingsSnapshot();
        return new CodexCliSummaryProvider(
            new CliProcessRunner(),
            settings.ResolveCodexModelId(),
            settings.ResolveCodexEffort());
    }

    private static ClaudeCodeCliTranscriptPolisher CreateClaudePolisher()
    {
        var settings = LoadSettingsSnapshot();
        return new ClaudeCodeCliTranscriptPolisher(
            new CliProcessRunner(),
            settings.ResolveClaudeModelId(),
            settings.ResolveClaudeEffort());
    }

    private static CodexCliTranscriptPolisher CreateCodexPolisher()
    {
        var settings = LoadSettingsSnapshot();
        return new CodexCliTranscriptPolisher(
            new CliProcessRunner(),
            settings.ResolveCodexModelId(),
            settings.ResolveCodexEffort());
    }

    private static string ResolveXaiModelId() =>
        XaiApiClient.ResolveModelId(LoadSettingsSnapshot().SelectedXaiModelId, []);

    private static string ResolveXaiEffort() => LoadSettingsSnapshot().ResolveXaiEffort();

    private static AppSettings LoadSettingsSnapshot()
    {
        try
        {
            // Sync file read — LoadAsync().GetResult() can deadlock on the UI thread.
            var path = AppPaths.SettingsFilePath;
            if (!File.Exists(path))
                return new AppSettings();

            var json = File.ReadAllText(path);
            return System.Text.Json.JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
        }
        catch (Exception)
        {
            return new AppSettings();
        }
    }
}
