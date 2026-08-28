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

    private string? _selectedSummaryModelId;

    public ObservableCollection<ModelOption> Models { get; } = [];

    public string DataDirectoryPath { get; } = AppPaths.RootDirectory;

    [RelayCommand]
    private async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            var hardware = AppServices.HardwareDetection.DetectHardware();
            var settings = await AppServices.Settings.LoadAsync();
            _selectedSummaryModelId = settings.SelectedSummaryModelId;

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
            await AppServices.Settings.SaveAsync(new AppSettings { SelectedSummaryModelId = null });
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
        await AppServices.Settings.SaveAsync(new AppSettings { SelectedSummaryModelId = _selectedSummaryModelId });
    }

    [RelayCommand]
    private void OpenDataFolder()
    {
        AppPaths.EnsureDirectoriesExist();
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{DataDirectoryPath}\"") { UseShellExecute = true });
    }
}
