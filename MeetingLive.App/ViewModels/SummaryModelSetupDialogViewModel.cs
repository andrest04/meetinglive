using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the guided local-model setup wizard: detects hardware, offers the
/// curated GGUF catalog with fit-rating badges, and downloads the chosen model
/// straight to disk — no external process to install or keep running.
/// </summary>
public partial class SummaryModelSetupDialogViewModel : ObservableObject
{
    [ObservableProperty]
    private SummaryModelWizardState _state = SummaryModelWizardState.DetectingHardware;

    [ObservableProperty]
    private string _hardwareSummary = string.Empty;

    [ObservableProperty]
    private ModelOption? _selectedModel;

    [ObservableProperty]
    private string _downloadStatusText = string.Empty;

    public ObservableCollection<ModelOption> Models { get; } = [];

    /// <summary>The model file path the user ended up with once the wizard completes, or null if cancelled.</summary>
    public string? ResultModelPath { get; private set; }

    /// <summary>Raised once the wizard has a result and the host dialog should close.</summary>
    public event EventHandler? Completed;

    public bool IsDetectingHardware => State == SummaryModelWizardState.DetectingHardware;
    public bool IsSelectingModel => State == SummaryModelWizardState.SelectingModel;
    public bool IsDownloading => State == SummaryModelWizardState.Downloading;
    public bool IsCompleted => State == SummaryModelWizardState.Completed;

    public Task InitializeAsync() => DetectAsync();

    [RelayCommand]
    private Task DetectAsync()
    {
        State = SummaryModelWizardState.DetectingHardware;

        var hardware = AppServices.HardwareDetection.DetectHardware();
        HardwareSummary = hardware.HasDedicatedGpu
            ? $"Detected: {hardware.TotalRamGb} GB RAM, GPU {hardware.GpuName} ({hardware.GpuVramGb} GB VRAM)"
            : $"Detected: {hardware.TotalRamGb} GB RAM, no dedicated GPU";

        Models.Clear();
        foreach (var model in ModelCatalog.SummaryModels)
            Models.Add(new ModelOption(model, model.RateFor(hardware), AppServices.LocalLlmModels.IsModelDownloaded(model)));

        SelectedModel = Models.FirstOrDefault(m => m.IsDownloaded)
            ?? Models.FirstOrDefault(m => m.Rating == FitRating.Recommended)
            ?? Models.FirstOrDefault();

        State = SummaryModelWizardState.SelectingModel;
        return Task.CompletedTask;
    }

    [RelayCommand]
    private async Task DownloadSelectedModelAsync()
    {
        if (SelectedModel is null)
            return;

        if (SelectedModel.IsDownloaded)
        {
            await FinishAsync(SelectedModel.Info);
            return;
        }

        State = SummaryModelWizardState.Downloading;
        SelectedModel.IsDownloading = true;
        DownloadStatusText = $"Downloading {SelectedModel.Info.DisplayName} (0%)...";

        try
        {
            var progress = new Progress<double>(percent =>
            {
                SelectedModel.DownloadProgressPercent = percent;
                DownloadStatusText = $"Downloading {SelectedModel.Info.DisplayName} ({percent:0}%)...";
            });
            await AppServices.LocalLlmModels.DownloadModelAsync(SelectedModel.Info, progress);
            SelectedModel.IsDownloaded = true;
            await FinishAsync(SelectedModel.Info);
        }
        catch (Exception ex)
        {
            DownloadStatusText = $"Error downloading the model: {ex.Message}";
            State = SummaryModelWizardState.SelectingModel;
        }
        finally
        {
            SelectedModel.IsDownloading = false;
        }
    }

    private async Task FinishAsync(SummaryModelInfo model)
    {
        ResultModelPath = AppServices.LocalLlmModels.GetModelPath(model);
        await AppServices.Settings.SaveAsync(new AppSettings { SelectedSummaryModelId = model.FileName });
        State = SummaryModelWizardState.Completed;
        Completed?.Invoke(this, EventArgs.Empty);
    }

    partial void OnStateChanged(SummaryModelWizardState value)
    {
        OnPropertyChanged(nameof(IsDetectingHardware));
        OnPropertyChanged(nameof(IsSelectingModel));
        OnPropertyChanged(nameof(IsDownloading));
        OnPropertyChanged(nameof(IsCompleted));
    }
}
