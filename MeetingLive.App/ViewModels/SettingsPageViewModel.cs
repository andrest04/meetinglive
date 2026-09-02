using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the central Settings page: the catalog of local GGUF summary models
/// (download/delete/select, with fit-rating badges so disk space is a visible
/// tradeoff), where app data lives on disk, and the (today single-option)
/// summary provider choice — the seat reserved for a future cloud <see cref="ISummaryProvider"/>.
/// </summary>
public partial class SettingsPageViewModel : ObservableObject
{
    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private SummaryProviderKind _selectedProviderKind = SummaryProviderKind.Local;

    [ObservableProperty]
    private string _cliProviderStatusText = string.Empty;

    [ObservableProperty]
    private TranscriptionLanguageOption _selectedLanguage = TranscriptionLanguageCatalog.Languages[0];

    [ObservableProperty]
    private MicrophoneDeviceOption _selectedMicrophone = DefaultMicrophoneOption;

    [ObservableProperty]
    private double _micLevel;

    [ObservableProperty]
    private bool _isLiveTranscriptionEnabled = true;

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

    private readonly IMicrophoneLevelMeterService _levelMeter = AppServices.MicrophoneLevelMeter;

    private string? _selectedSummaryModelId;

    /// <summary>Sentinel entry meaning "use the OS default input device" — its empty
    /// <see cref="MicrophoneDeviceOption.Id"/> is never a real WASAPI device id.</summary>
    private static readonly MicrophoneDeviceOption DefaultMicrophoneOption = new(string.Empty, "System default");

    public SettingsPageViewModel()
    {
        _levelMeter.LevelChanged += OnMicLevelChanged;
    }

    public ObservableCollection<ModelOption> Models { get; } = [];

    public IReadOnlyList<TranscriptionLanguageOption> Languages { get; } = TranscriptionLanguageCatalog.Languages;

    public ObservableCollection<MicrophoneDeviceOption> Microphones { get; } = [];

    public string DataDirectoryPath { get; } = AppPaths.RootDirectory;

    public bool IsLocalSelected => SelectedProviderKind == SummaryProviderKind.Local;
    public bool IsClaudeCodeSelected => SelectedProviderKind == SummaryProviderKind.ClaudeCode;
    public bool IsCodexSelected => SelectedProviderKind == SummaryProviderKind.Codex;

    /// <summary>Only CLI-backed providers have a PATH-detection status to show; Local always
    /// works (it just may need a model download, handled by the model list above).</summary>
    public bool ShowCliProviderStatus => SelectedProviderKind != SummaryProviderKind.Local;

    [RelayCommand]
    private async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            var hardware = AppServices.HardwareDetection.DetectHardware();
            var settings = await AppServices.Settings.LoadAsync();
            _selectedSummaryModelId = settings.SelectedSummaryModelId;
            SelectedProviderKind = settings.ResolveSummaryProviderKind();
            var languageCode = settings.ResolveTranscriptionLanguage();
            SelectedLanguage = TranscriptionLanguageCatalog.Languages.FirstOrDefault(l => l.Code == languageCode)
                ?? TranscriptionLanguageCatalog.Languages[0];
            IsLiveTranscriptionEnabled = settings.LiveTranscriptionEnabled;
            RefreshTranscriptionStatus(hardware);

            Models.Clear();
            foreach (var model in ModelCatalog.SummaryModels)
            {
                Models.Add(new ModelOption(model, model.RateFor(hardware), AppServices.LocalLlmModels.IsModelDownloaded(model))
                {
                    IsActive = model.FileName == _selectedSummaryModelId,
                });
            }

            Microphones.Clear();
            Microphones.Add(DefaultMicrophoneOption);
            foreach (var microphone in AppServices.Microphones.GetAvailableMicrophones())
                Microphones.Add(microphone);

            // Falls back to "System default" if the previously selected device was unplugged
            // or no longer exists — mirrors the fallback AudioCaptureService applies at record time.
            SelectedMicrophone = Microphones.FirstOrDefault(m => m.Id == settings.SelectedMicrophoneDeviceId)
                ?? DefaultMicrophoneOption;

            RestartLevelMeter();
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Called by the page when it unloads, so the preview microphone isn't held open
    /// indefinitely while the user is elsewhere in the app, and so this (per-navigation)
    /// view model instance doesn't leak a subscription on the app-lifetime <see cref="_levelMeter"/>
    /// singleton.</summary>
    public void StopLevelMeter()
    {
        _levelMeter.Stop();
        _levelMeter.LevelChanged -= OnMicLevelChanged;
    }

    private void RestartLevelMeter()
    {
        var deviceId = string.IsNullOrEmpty(SelectedMicrophone.Id) ? null : SelectedMicrophone.Id;
        _levelMeter.Start(deviceId);
    }

    private void OnMicLevelChanged(object? sender, float level)
    {
        App.DispatcherQueue.TryEnqueue(() => MicLevel = Math.Clamp(level * 100.0, 0, 100));
    }

    [RelayCommand]
    private async Task DownloadModelAsync(ModelOption option)
    {
        option.IsDownloading = true;
        try
        {
            var progress = new Progress<double>(percent => option.DownloadProgressPercent = percent);
            await AppServices.LocalLlmModels.DownloadModelAsync(option.Info, progress);
            option.IsDownloaded = true;
        }
        finally
        {
            option.IsDownloading = false;
        }
    }

    [RelayCommand]
    private async Task DeleteModelAsync(ModelOption option)
    {
        AppServices.LocalLlmModels.DeleteModel(option.Info);
        option.IsDownloaded = false;

        if (option.IsActive)
        {
            option.IsActive = false;
            _selectedSummaryModelId = null;
            await SaveSettingsAsync(settings => settings.SelectedSummaryModelId = null);
        }
    }

    [RelayCommand]
    private async Task SelectModelAsync(ModelOption option)
    {
        if (!option.IsDownloaded || option.Info.FileName == _selectedSummaryModelId)
            return;

        foreach (var other in Models)
            other.IsActive = ReferenceEquals(other, option);

        _selectedSummaryModelId = option.Info.FileName;
        await SaveSettingsAsync(settings => settings.SelectedSummaryModelId = _selectedSummaryModelId);
    }

    [RelayCommand]
    private async Task SelectLanguageAsync(TranscriptionLanguageOption option)
    {
        if (option.Code == SelectedLanguage.Code)
            return;

        SelectedLanguage = option;
        await SaveSettingsAsync(settings => settings.TranscriptionLanguage = option.Code);
    }

    [RelayCommand]
    private async Task SelectMicrophoneAsync(MicrophoneDeviceOption option)
    {
        if (option.Id == SelectedMicrophone.Id)
            return;

        SelectedMicrophone = option;
        RestartLevelMeter();
        var deviceId = string.IsNullOrEmpty(option.Id) ? null : option.Id;
        await SaveSettingsAsync(settings => settings.SelectedMicrophoneDeviceId = deviceId);
    }

    [RelayCommand]
    private async Task SelectProviderAsync(SummaryProviderKind kind)
    {
        if (kind == SelectedProviderKind)
            return;

        SelectedProviderKind = kind;
        await SaveSettingsAsync(settings => settings.SelectedSummaryProvider = kind.ToString());
    }

    [RelayCommand]
    private async Task DownloadTranscriptionEngineAsync()
    {
        IsTranscriptionDownloading = true;
        TranscriptionDownloadProgressPercent = 0;
        TranscriptionDownloadStatusText = "Starting download...";
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
            TranscriptionAccelerationCaption = $"Download failed: {ex.Message}";
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
    private void OpenDataFolder()
    {
        AppPaths.EnsureDirectoriesExist();
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{DataDirectoryPath}\"") { UseShellExecute = true });
    }

    /// <summary>Loads the current settings, applies <paramref name="mutate"/>, and saves the whole
    /// blob back — <see cref="IAppSettingsService.SaveAsync"/> overwrites the file wholesale, so
    /// every call site must round-trip the fields it isn't touching (model id vs. provider kind)
    /// rather than construct a fresh <see cref="AppSettings"/>.</summary>
    private static async Task SaveSettingsAsync(Action<AppSettings> mutate)
    {
        var settings = await AppServices.Settings.LoadAsync();
        mutate(settings);
        await AppServices.Settings.SaveAsync(settings);
    }

    partial void OnSelectedProviderKindChanged(SummaryProviderKind value)
    {
        OnPropertyChanged(nameof(IsLocalSelected));
        OnPropertyChanged(nameof(IsClaudeCodeSelected));
        OnPropertyChanged(nameof(IsCodexSelected));
        OnPropertyChanged(nameof(ShowCliProviderStatus));

        CliProviderStatusText = value == SummaryProviderKind.Local
            ? string.Empty
            : CliProviderResolver.IsOnPath(value)
                ? "Detected on PATH."
                : "Not found on PATH — install it before recording.";
    }
}
