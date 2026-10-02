using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: live transcription toggle, the transcription-engine (NeMo) install,
/// and the optional speaker-diarization model install.
/// </summary>
public sealed partial class TranscriptionEngineSectionViewModel : SettingsSectionViewModelBase
{
    [ObservableProperty]
    private bool _isLiveTranscriptionEnabled = true;

    [ObservableProperty]
    private bool _isSpeakerDiarizationEnabled;

    [ObservableProperty]
    private bool _isSpeakerDiarizationModelInstalled;

    [ObservableProperty]
    private bool _isSpeakerDiarizationDownloading;

    [ObservableProperty]
    private double _speakerDiarizationDownloadProgressPercent;

    [ObservableProperty]
    private string _speakerDiarizationDownloadStatusText = string.Empty;

    public bool ShowSpeakerDiarizationProgress =>
        IsSpeakerDiarizationDownloading || !string.IsNullOrEmpty(SpeakerDiarizationDownloadStatusText);

    partial void OnIsSpeakerDiarizationDownloadingChanged(bool value) =>
        OnPropertyChanged(nameof(ShowSpeakerDiarizationProgress));

    partial void OnSpeakerDiarizationDownloadStatusTextChanged(string value) =>
        OnPropertyChanged(nameof(ShowSpeakerDiarizationProgress));

    [ObservableProperty]
    private bool _isTranscriptionEngineInstalled;

    [ObservableProperty]
    private bool _isTranscriptionDownloading;

    [ObservableProperty]
    private double _transcriptionDownloadProgressPercent;

    [ObservableProperty]
    private string _transcriptionDownloadStatusText = string.Empty;

    [ObservableProperty]
    private string _transcriptionAccelerationCaption = string.Empty;

    [ObservableProperty]
    private bool _isBackendFallbackWarningOpen;

    [ObservableProperty]
    private string _backendFallbackMessage = string.Empty;

    [ObservableProperty]
    private string _liveDropsCaption = string.Empty;

    [ObservableProperty]
    private bool _isLiveDropsCaptionVisible;

    [ObservableProperty]
    private bool _isLiveDropsWarningOpen;

    [ObservableProperty]
    private string _liveDropsWarningMessage = string.Empty;

    /// <summary>Above this share of skipped audio the live drops are worth a warning.</summary>
    private const double LiveDropsWarningPercent = 5;

    /// <summary>What the factory will try first; only shown until a recognizer has really been created.</summary>
    private NemoSpeechBackend _expectedBackend = NemoSpeechBackend.Cpu;

    public void ApplyLoadedSettings(
        AppSettings settings,
        bool transcriptionInstalled,
        bool speakerDiarizationInstalled,
        NemoSpeechBackend expectedBackend)
    {
        IsLiveTranscriptionEnabled = settings.LiveTranscriptionEnabled;
        IsSpeakerDiarizationEnabled = settings.SpeakerDiarizationEnabled;
        IsSpeakerDiarizationModelInstalled = speakerDiarizationInstalled;
        IsTranscriptionEngineInstalled = transcriptionInstalled;
        _expectedBackend = expectedBackend;
        ApplyBackendStatus();
    }

    /// <summary>Follows the shared backend status while Settings is visible. Pair with
    /// <see cref="StopObservingBackend"/> so the app-lifetime singleton never keeps this view model alive.</summary>
    public void StartObservingBackend()
    {
        AppServices.AsrBackend.Changed -= OnBackendChanged;
        AppServices.AsrBackend.Changed += OnBackendChanged;
        AppServices.AsrBackend.LiveDropsChanged -= OnLiveDropsChanged;
        AppServices.AsrBackend.LiveDropsChanged += OnLiveDropsChanged;
        ApplyBackendStatus();
    }

    public void StopObservingBackend()
    {
        AppServices.AsrBackend.Changed -= OnBackendChanged;
        AppServices.AsrBackend.LiveDropsChanged -= OnLiveDropsChanged;
    }

    // Raised on the recording / transcription thread that created the recognizer.
    private void OnBackendChanged(object? sender, AsrBackendUsage usage) =>
        App.DispatcherQueue.TryEnqueue(ApplyBackendStatus);

    // Raised on the thread that stopped the live session.
    private void OnLiveDropsChanged(object? sender, LiveDropSummary summary) =>
        App.DispatcherQueue.TryEnqueue(ApplyBackendStatus);

    private void ApplyBackendStatus()
    {
        ApplyLiveDrops(AppServices.AsrBackend.LastLiveDrops);

        var usage = AppServices.AsrBackend.Current;
        TranscriptionAccelerationCaption = usage is null
            ? AppStrings.Get(_expectedBackend == NemoSpeechBackend.Cuda
                ? "Settings_AccelerationExpectedCuda"
                : "Settings_AccelerationExpectedCpu")
            : AppStrings.Get(usage.Backend == NemoSpeechBackend.Cuda
                ? "Settings_AccelerationActiveCuda"
                : "Settings_AccelerationActiveCpu");

        var reason = usage?.FallbackReason;
        BackendFallbackMessage = reason is null
            ? string.Empty
            : AppStrings.Format("Settings_AccelerationFallbackMessage", reason);
        IsBackendFallbackWarningOpen = reason is not null;
    }

    private void ApplyLiveDrops(LiveDropSummary? summary)
    {
        if (summary is null)
        {
            IsLiveDropsCaptionVisible = false;
            IsLiveDropsWarningOpen = false;
            LiveDropsCaption = string.Empty;
            LiveDropsWarningMessage = string.Empty;
            return;
        }

        var percent = summary.DroppedPercent.ToString("0.#", CultureInfo.CurrentCulture);
        var warn = summary.DroppedPercent > LiveDropsWarningPercent;
        LiveDropsCaption = AppStrings.Format("Settings_LiveDropsCaption", percent);
        IsLiveDropsCaptionVisible = !warn;
        LiveDropsWarningMessage = warn ? AppStrings.Format("Settings_LiveDropsWarningMessage", percent) : string.Empty;
        IsLiveDropsWarningOpen = warn;
    }

    [RelayCommand]
    private async Task DownloadTranscriptionEngineAsync()
    {
        IsTranscriptionDownloading = true;
        TranscriptionDownloadProgressPercent = 0;
        TranscriptionDownloadStatusText = AppStrings.Get("Status_StartingDownload");
        try
        {
            var hardware = AppServices.HardwareDetection.DetectHardware();
            var progress = new Progress<TranscriptionEngineInstallProgress>(update =>
            {
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    TranscriptionDownloadProgressPercent = update.Percent;
                    TranscriptionDownloadStatusText = $"{update.StatusText}  {update.Percent:0}%";
                });
            });
            await TranscriptionEngineInstaller.EnsureAsync(
                AppServices.NemotronModels,
                AppServices.NemoSpeechRuntime,
                hardware,
                progress);
            RefreshTranscriptionStatus(hardware);
        }
        catch (Exception ex)
        {
            TranscriptionAccelerationCaption = AppStrings.Format("Error_DownloadFailedCaption", ex.Message);
        }
        finally
        {
            IsTranscriptionDownloading = false;
            TranscriptionDownloadStatusText = string.Empty;
            TranscriptionDownloadProgressPercent = 0;
        }
    }

    [RelayCommand]
    private void DeleteTranscriptionEngine()
    {
        AppServices.NemotronModels.DeleteModel();
        AppServices.NemoSpeechRuntime.DeleteRuntime();
        var hardware = AppServices.HardwareDetection.DetectHardware();
        RefreshTranscriptionStatus(hardware);
    }

    private void RefreshTranscriptionStatus(HardwareProfile hardware)
    {
        IsTranscriptionEngineInstalled = TranscriptionEngineInstaller.IsReady(
            AppServices.NemotronModels, AppServices.NemoSpeechRuntime);
        _expectedBackend = TranscriptionEngineInstaller.ExpectedBackend(hardware, AppServices.NemoSpeechRuntime);
        ApplyBackendStatus();
    }

    [RelayCommand]
    private async Task ToggleLiveTranscriptionAsync(bool isEnabled)
    {
        if (isEnabled == IsLiveTranscriptionEnabled)
            return;

        IsLiveTranscriptionEnabled = isEnabled;
        await SaveSettingsAsync(settings => settings.LiveTranscriptionEnabled = isEnabled);
    }

    [RelayCommand]
    private async Task ToggleSpeakerDiarizationAsync(bool isEnabled)
    {
        if (isEnabled == IsSpeakerDiarizationEnabled)
            return;

        IsSpeakerDiarizationEnabled = isEnabled;
        await SaveSettingsAsync(settings => settings.SpeakerDiarizationEnabled = isEnabled);
        if (isEnabled && !AppServices.NemotronModels.IsDiarizationModelDownloaded())
            await DownloadSpeakerDiarizationModelAsync();
    }

    [RelayCommand]
    private async Task DownloadSpeakerDiarizationModelAsync()
    {
        if (IsSpeakerDiarizationDownloading)
            return;

        IsSpeakerDiarizationDownloading = true;
        SpeakerDiarizationDownloadProgressPercent = 0;
        SpeakerDiarizationDownloadStatusText = AppStrings.Get("Status_DownloadingSpeakerModel");
        try
        {
            var progress = new Progress<double>(percent =>
            {
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    SpeakerDiarizationDownloadProgressPercent = percent;
                    SpeakerDiarizationDownloadStatusText =
                        $"{AppStrings.Get("Status_DownloadingSpeakerModel")}  {percent:0}%";
                });
            });
            await AppServices.NemotronModels.DownloadDiarizationModelAsync(progress);
            IsSpeakerDiarizationModelInstalled = AppServices.NemotronModels.IsDiarizationModelDownloaded();
            SpeakerDiarizationDownloadStatusText = string.Empty;
        }
        catch (Exception ex)
        {
            SpeakerDiarizationDownloadStatusText = AppStrings.Format("Error_DownloadFailedCaption", ex.Message);
        }
        finally
        {
            IsSpeakerDiarizationDownloading = false;
            SpeakerDiarizationDownloadProgressPercent = 0;
        }
    }

    [RelayCommand]
    private void DeleteSpeakerDiarizationModel()
    {
        AppServices.NemotronModels.DeleteDiarizationModel();
        IsSpeakerDiarizationModelInstalled = false;
    }
}
