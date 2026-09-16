using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: the catalog of local GGUF summary models — download/delete/select,
/// with fit-rating badges so disk space is a visible tradeoff.
/// </summary>
public sealed partial class LocalModelSectionViewModel : SettingsSectionViewModelBase
{
    private string? _selectedSummaryModelId;

    public ObservableCollection<ModelOption> Models { get; } = [];

    /// <summary>Populates <see cref="Models"/> from a snapshot collected on the settings page's load.</summary>
    public void ApplyLoadedModels(
        IReadOnlyList<(SummaryModelInfo Info, FitRating Rating, bool Downloaded)> models,
        string? selectedSummaryModelId)
    {
        _selectedSummaryModelId = selectedSummaryModelId;

        Models.Clear();
        foreach (var (info, rating, downloaded) in models)
        {
            Models.Add(new ModelOption(info, rating, downloaded)
            {
                IsActive = info.FileName == _selectedSummaryModelId,
            });
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
}
