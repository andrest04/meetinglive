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
    private string _transcriptionAccelerationCaption = "CPU";

    public void ApplyLoadedSettings(
        AppSettings settings,
        bool transcriptionInstalled,
        bool speakerDiarizationInstalled,
        string transcriptionCaption)
    {
        IsLiveTranscriptionEnabled = settings.LiveTranscriptionEnabled;
        IsSpeakerDiarizationEnabled = settings.SpeakerDiarizationEnabled;
        IsSpeakerDiarizationModelInstalled = speakerDiarizationInstalled;
        IsTranscriptionEngineInstalled = transcriptionInstalled;
        TranscriptionAccelerationCaption = transcriptionCaption;
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
        TranscriptionAccelerationCaption = TranscriptionEngineInstaller.AccelerationCaption(
            hardware, AppServices.NemoSpeechRuntime);
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
