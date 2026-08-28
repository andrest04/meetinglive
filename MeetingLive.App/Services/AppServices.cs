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

    public static ITranscriptionService Transcription { get; } = new TranscriptionService(AppPaths.ModelsDirectory);

    public static ILocalLlmModelManager LocalLlmModels { get; } = new LocalLlmModelManager(LazyModelDownloadHttpClient.Value);

    public static IHardwareDetectionService HardwareDetection { get; } = new HardwareDetectionService();

    public static IMeetingRepository Meetings { get; } = new MeetingRepository();

    public static IAppSettingsService Settings { get; } = new AppSettingsService();

    /// <summary>
    /// Creates a summary provider bound to the given catalog model file. A factory
    /// (rather than a singleton) because the model can change if the user picks a
    /// different one in Settings, and each provider owns its own loaded weights.
    /// </summary>
    public static ISummaryProvider CreateSummaryProvider(string modelPath) =>
        new LocalLlmSummaryProvider(modelPath);
}
