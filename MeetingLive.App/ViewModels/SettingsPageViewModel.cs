using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Reflection;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.UI.Dispatching;
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
    private string _xaiStatusText = string.Empty;

    [ObservableProperty]
    private string? _selectedXaiModelId;

    [ObservableProperty]
    private bool _isXaiSignedIn;

    [ObservableProperty]
    private bool _isXaiBusy;

    [ObservableProperty]
    private string _xaiStatusDetail = string.Empty;

    [ObservableProperty]
    private bool _isXaiFeedbackOpen;

    [ObservableProperty]
    private string _xaiFeedbackMessage = string.Empty;

    [ObservableProperty]
    private string _xaiApiKeyDraft = string.Empty;

    public bool CanSaveXaiApiKey => !string.IsNullOrWhiteSpace(XaiApiKeyDraft);

    [ObservableProperty]
    private string _selectedClaudeModelId = InferenceCatalog.DefaultClaudeModel;

    [ObservableProperty]
    private string _selectedClaudeEffort = InferenceCatalog.DefaultEffort;

    [ObservableProperty]
    private string _selectedCodexModelId = InferenceCatalog.DefaultCodexModel;

    [ObservableProperty]
    private string _selectedCodexEffort = InferenceCatalog.DefaultEffort;

    [ObservableProperty]
    private string _selectedXaiEffort = InferenceCatalog.DefaultEffort;

    [ObservableProperty]
    private TranscriptionLanguageOption _selectedLanguage = TranscriptionLanguageCatalog.Languages[0];

    [ObservableProperty]
    private TranscriptionLanguageOption _selectedSummaryLanguage = SummaryLanguageCatalog.Languages[0];

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

    private bool _suppressXaiModelCommit;

    private bool _suppressCliInferenceCommit;

    private DispatcherQueueTimer? _xaiFeedbackTimer;

    /// <summary>True while rebuilding the mic list. ComboBox SelectionChanged after
    /// <see cref="ObservableCollection{T}.Clear"/> would otherwise save System default
    /// and wipe the user's device.</summary>
    private bool _suppressMicrophoneCommit;

    /// <summary>False after <see cref="StopLevelMeter"/> so a load that finishes after
    /// the user left Settings does not reopen WASAPI on another page.</summary>
    private bool _isPageVisible;

    /// <summary>Sentinel entry meaning "use the OS default input device" — its empty
    /// <see cref="MicrophoneDeviceOption.Id"/> is never a real WASAPI device id.</summary>
    private static MicrophoneDeviceOption DefaultMicrophoneOption =>
        new(string.Empty, AppStrings.Get("Microphone_SystemDefault"));

    public ObservableCollection<ModelOption> Models { get; } = [];

    public ObservableCollection<string> XaiModels { get; } = [];

    public IReadOnlyList<string> ClaudeModels { get; } = InferenceCatalog.ClaudeModels;

    public IReadOnlyList<string> ClaudeEfforts { get; } = InferenceCatalog.ClaudeEfforts;

    public IReadOnlyList<string> CodexModels { get; } = InferenceCatalog.CodexModels;

    public IReadOnlyList<string> CodexEfforts { get; } = InferenceCatalog.CodexEfforts;

    public IReadOnlyList<string> XaiEfforts { get; } = InferenceCatalog.XaiEfforts;

    public IReadOnlyList<TranscriptionLanguageOption> Languages { get; } = TranscriptionLanguageCatalog.Languages;

    public IReadOnlyList<TranscriptionLanguageOption> SummaryLanguages { get; } = SummaryLanguageCatalog.Languages;

    public ObservableCollection<MicrophoneDeviceOption> Microphones { get; } = [];

    public string DataDirectoryPath { get; } = AppPaths.RootDirectory;

    public string AppVersion { get; } = ResolveAppVersion();

    public bool IsLocalSelected => SelectedProviderKind == SummaryProviderKind.Local;
    public bool IsClaudeCodeSelected => SelectedProviderKind == SummaryProviderKind.ClaudeCode;
    public bool IsCodexSelected => SelectedProviderKind == SummaryProviderKind.Codex;
    public bool IsXaiSelected => SelectedProviderKind == SummaryProviderKind.Xai;

    /// <summary>Only CLI-backed providers have a PATH-detection status to show.</summary>
    public bool ShowCliProviderStatus =>
        SelectedProviderKind is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex;

    private static string ResolveAppVersion()
    {
        try
        {
            var version = Windows.ApplicationModel.Package.Current.Id.Version;
            return $"{version.Major}.{version.Minor}.{version.Build}.{version.Revision}";
        }
        catch (Exception)
        {
            var informational = typeof(SettingsPageViewModel).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion;
            return string.IsNullOrWhiteSpace(informational) ? "1.0.0.0" : informational;
        }
    }

    [RelayCommand]
    private async Task LoadAsync()
    {
        _isPageVisible = true;
        IsLoading = true;
        _suppressMicrophoneCommit = true;
        try
        {
            // Paint the page (and the loading ring) before WMI / disk / WASAPI.
            await Task.Yield();

            var settingsTask = AppServices.Settings.LoadAsync();
            var snapshot = await Task.Run(CollectLoadSnapshot);
            var settings = await settingsTask;
            if (!_isPageVisible)
                return;

            _selectedSummaryModelId = settings.SelectedSummaryModelId;
            SelectedProviderKind = settings.ResolveSummaryProviderKind();
            _suppressXaiModelCommit = true;
            SelectedXaiModelId = settings.SelectedXaiModelId;
            SelectedXaiEffort = settings.ResolveXaiEffort();
            _suppressXaiModelCommit = false;
            _suppressCliInferenceCommit = true;
            SelectedClaudeModelId = settings.ResolveClaudeModelId();
            SelectedClaudeEffort = settings.ResolveClaudeEffort();
            SelectedCodexModelId = settings.ResolveCodexModelId();
            SelectedCodexEffort = settings.ResolveCodexEffort();
            _suppressCliInferenceCommit = false;
            if (SelectedProviderKind == SummaryProviderKind.Xai)
                await RefreshXaiAccountAsync();
            var languageCode = settings.ResolveTranscriptionLanguage();
            SelectedLanguage = TranscriptionLanguageCatalog.Languages.FirstOrDefault(l => l.Code == languageCode)
                ?? TranscriptionLanguageCatalog.Languages[0];
            var summaryLanguageCode = settings.ResolveSummaryLanguage();
            SelectedSummaryLanguage = SummaryLanguageCatalog.Languages.FirstOrDefault(l => l.Code == summaryLanguageCode)
                ?? SummaryLanguageCatalog.Languages[0];
            IsLiveTranscriptionEnabled = settings.LiveTranscriptionEnabled;
            IsTranscriptionEngineInstalled = snapshot.TranscriptionInstalled;
            TranscriptionAccelerationCaption = snapshot.TranscriptionCaption;

            Models.Clear();
            foreach (var (info, rating, downloaded) in snapshot.Models)
            {
                Models.Add(new ModelOption(info, rating, downloaded)
                {
                    IsActive = info.FileName == _selectedSummaryModelId,
                });
            }

            Microphones.Clear();
            var systemDefault = DefaultMicrophoneOption;
            Microphones.Add(systemDefault);
            foreach (var microphone in snapshot.Microphones)
                Microphones.Add(microphone);

            // ComboBox only displays SelectedItem when it is the same instance as an
            // ItemsSource row. Null saved id means system default (empty Id).
            var savedId = settings.SelectedMicrophoneDeviceId ?? string.Empty;
            var chosen = Microphones.FirstOrDefault(m => m.Id == savedId) ?? systemDefault;
            // Record equality would skip the generated setter (field already looks like
            // System default), so the ComboBox never gets SelectedItem and stays blank.
            _selectedMicrophone = chosen;
            OnPropertyChanged(nameof(SelectedMicrophone));

            // Opening WASAPI is another hitch — start after this frame paints.
            App.DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, RestartLevelMeter);
        }
        finally
        {
            IsLoading = false;
            App.DispatcherQueue.TryEnqueue(() => _suppressMicrophoneCommit = false);
        }
    }

    private static SettingsLoadSnapshot CollectLoadSnapshot()
    {
        var hardware = AppServices.HardwareDetection.DetectHardware();
        var models = new List<(SummaryModelInfo Info, FitRating Rating, bool Downloaded)>(ModelCatalog.SummaryModels.Count);
        foreach (var model in ModelCatalog.SummaryModels)
            models.Add((model, model.RateFor(hardware), AppServices.LocalLlmModels.IsModelDownloaded(model)));

        return new SettingsLoadSnapshot(
            models,
            TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime),
            TranscriptionEngineInstaller.AccelerationCaption(hardware, AppServices.NemoSpeechRuntime),
            AppServices.Microphones.GetAvailableMicrophones());
    }

    /// <summary>Called when navigating away so the preview microphone isn't held open
    /// on another page, and so this view model doesn't leak a subscription on the
    /// app-lifetime <see cref="_levelMeter"/> singleton.</summary>
    public void StopLevelMeter()
    {
        _isPageVisible = false;
        _levelMeter.Stop();
        _levelMeter.LevelChanged -= OnMicLevelChanged;
    }

    private void RestartLevelMeter()
    {
        if (!_isPageVisible)
            return;

        _levelMeter.LevelChanged -= OnMicLevelChanged;
        _levelMeter.LevelChanged += OnMicLevelChanged;
        var deviceId = string.IsNullOrEmpty(SelectedMicrophone.Id) ? null : SelectedMicrophone.Id;
        _levelMeter.Start(deviceId);
    }

    private sealed record SettingsLoadSnapshot(
        IReadOnlyList<(SummaryModelInfo Info, FitRating Rating, bool Downloaded)> Models,
        bool TranscriptionInstalled,
        string TranscriptionCaption,
        IReadOnlyList<MicrophoneDeviceOption> Microphones);

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
    private async Task SelectSummaryLanguageAsync(TranscriptionLanguageOption option)
    {
        if (option.Code == SelectedSummaryLanguage.Code)
            return;

        SelectedSummaryLanguage = option;
        await SaveSettingsAsync(settings => settings.SummaryLanguage = option.Code);
    }

    [RelayCommand]
    private async Task SelectMicrophoneAsync(MicrophoneDeviceOption option)
    {
        if (IsLoading || _suppressMicrophoneCommit)
            return;

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
        if (kind == SummaryProviderKind.Xai)
            await RefreshXaiAccountAsync();
    }

    [RelayCommand]
    private async Task SelectClaudeModelAsync(string? modelId)
    {
        if (IsLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(modelId))
            return;
        if (modelId == SelectedClaudeModelId)
            return;

        SelectedClaudeModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedClaudeModelId = modelId);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedClaudeModelId} · {SelectedClaudeEffort}"));
    }

    [RelayCommand]
    private async Task SelectClaudeEffortAsync(string? effort)
    {
        if (IsLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedClaudeEffort)
            return;

        SelectedClaudeEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedClaudeEffort = effort);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedClaudeModelId} · {SelectedClaudeEffort}"));
    }

    [RelayCommand]
    private async Task SelectCodexModelAsync(string? modelId)
    {
        if (IsLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(modelId))
            return;
        if (modelId == SelectedCodexModelId)
            return;

        SelectedCodexModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedCodexModelId = modelId);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedCodexModelId} · {SelectedCodexEffort}"));
    }

    [RelayCommand]
    private async Task SelectCodexEffortAsync(string? effort)
    {
        if (IsLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedCodexEffort)
            return;

        SelectedCodexEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedCodexEffort = effort);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedCodexModelId} · {SelectedCodexEffort}"));
    }

    [RelayCommand]
    private async Task SelectXaiEffortAsync(string? effort)
    {
        if (IsLoading || _suppressXaiModelCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedXaiEffort)
            return;

        SelectedXaiEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedXaiEffort = effort);
        UpdateXaiReadyDetail();
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedXaiModelId} · {SelectedXaiEffort}"));
    }

    [RelayCommand]
    private async Task SaveXaiApiKeyAsync()
    {
        if (!CanSaveXaiApiKey)
            return;

        AppServices.XaiAuth.SaveApiKey(XaiApiKeyDraft);
        XaiApiKeyDraft = string.Empty;
        await RefreshXaiAccountAsync();
        ShowXaiFeedback(AppStrings.Get("Xai_FeedbackApiKey"));
    }

    [RelayCommand]
    private async Task SignOutXaiAsync()
    {
        AppServices.XaiAuth.SignOut();
        await RefreshXaiAccountAsync();
        ShowXaiFeedback(AppStrings.Get("Xai_FeedbackSignedOut"));
    }

    [RelayCommand]
    private async Task SelectXaiModelAsync(string? modelId)
    {
        if (IsLoading || _suppressXaiModelCommit || string.IsNullOrWhiteSpace(modelId))
            return;

        if (modelId == SelectedXaiModelId)
            return;

        SelectedXaiModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedXaiModelId = modelId);
        UpdateXaiReadyDetail();
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedXaiModelId} · {SelectedXaiEffort}"));
    }

    [RelayCommand]
    private async Task RefreshXaiAccountAsync()
    {
        var kind = AppServices.XaiAuth.CredentialKind;
        IsXaiSignedIn = kind is not null;
        XaiStatusText = kind switch
        {
            XaiCredentialKind.OAuth => AppStrings.Get("Xai_StatusSuperGrok"),
            XaiCredentialKind.ApiKey => AppStrings.Get("Xai_StatusApiKey"),
            _ => AppStrings.Get("Xai_StatusSignedOut"),
        };
        XaiStatusDetail = IsXaiSignedIn
            ? AppStrings.Get("Xai_StatusLoadingModels")
            : AppStrings.Get("Xai_StatusSignedOutDetail");

        if (!IsXaiSignedIn)
        {
            _suppressXaiModelCommit = true;
            XaiModels.Clear();
            _suppressXaiModelCommit = false;
            return;
        }

        IsXaiBusy = true;
        try
        {
            var token = await AppServices.XaiAuth.GetAccessTokenAsync();
            var models = await AppServices.XaiApi.ListModelsAsync(token);
            var settings = await AppServices.Settings.LoadAsync();
            var resolved = XaiApiClient.ResolveModelId(settings.SelectedXaiModelId, models);

            _suppressXaiModelCommit = true;
            XaiModels.Clear();
            foreach (var id in models)
                XaiModels.Add(id);
            if (XaiModels.Count == 0)
                XaiModels.Add(resolved);
            SelectedXaiModelId = null;
            SelectedXaiModelId = resolved;
            _suppressXaiModelCommit = false;

            if (!string.Equals(settings.SelectedXaiModelId, resolved, StringComparison.Ordinal))
                await SaveSettingsAsync(s => s.SelectedXaiModelId = resolved);

            UpdateXaiReadyDetail();
        }
        catch (Exception ex)
        {
            XaiStatusText = AppStrings.Get("Xai_StatusErrorTitle");
            XaiStatusDetail = ex.Message;
        }
        finally
        {
            IsXaiBusy = false;
            _suppressXaiModelCommit = false;
        }
    }

    partial void OnXaiApiKeyDraftChanged(string value) =>
        OnPropertyChanged(nameof(CanSaveXaiApiKey));

    private void UpdateXaiReadyDetail()
    {
        if (!IsXaiSignedIn || string.IsNullOrWhiteSpace(SelectedXaiModelId))
            return;

        XaiStatusDetail = AppStrings.Format(
            "Xai_StatusReady",
            $"{SelectedXaiModelId} · {SelectedXaiEffort}");
    }

    public void ShowXaiFeedback(string message)
    {
        XaiFeedbackMessage = message;
        IsXaiFeedbackOpen = true;
        _xaiFeedbackTimer ??= CreateXaiFeedbackTimer();
        _xaiFeedbackTimer.Stop();
        _xaiFeedbackTimer.Start();
    }

    private DispatcherQueueTimer CreateXaiFeedbackTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(4);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => IsXaiFeedbackOpen = false;
        return timer;
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
        OnPropertyChanged(nameof(IsXaiSelected));
        OnPropertyChanged(nameof(ShowCliProviderStatus));

        CliProviderStatusText = value is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex
            ? CliProviderResolver.IsOnPath(value)
                ? AppStrings.Get("Status_CliOnPath")
                : AppStrings.Get("Status_CliMissing")
            : string.Empty;
    }
}
