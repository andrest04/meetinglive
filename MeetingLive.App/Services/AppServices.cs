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

    public static IAudioCaptureService AudioCapture { get; } = new AudioCaptureService();

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

    public static IAppSettingsService Settings { get; } = new AppSettingsService();

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
        SummaryProviderKind.ClaudeCode => new ClaudeCodeCliSummaryProvider(new CliProcessRunner()),
        SummaryProviderKind.Codex => new CodexCliSummaryProvider(new CliProcessRunner()),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown summary provider kind."),
    };
}
