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

    private string? _selectedSummaryModelId;

    public ObservableCollection<ModelOption> Models { get; } = [];

    public IReadOnlyList<TranscriptionLanguageOption> Languages { get; } = TranscriptionLanguageCatalog.Languages;

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

            Models.Clear();
            foreach (var model in ModelCatalog.SummaryModels)
            {
                Models.Add(new ModelOption(model, model.RateFor(hardware), AppServices.LocalLlmModels.IsModelDownloaded(model))
                {
                    IsActive = model.FileName == _selectedSummaryModelId,
                });
            }
        }
        finally
        {
            IsLoading = false;
        }
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
    private async Task SelectProviderAsync(SummaryProviderKind kind)
    {
        if (kind == SelectedProviderKind)
            return;

        SelectedProviderKind = kind;
        await SaveSettingsAsync(settings => settings.SelectedSummaryProvider = kind.ToString());
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
