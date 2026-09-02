using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the guided "set up summary generation" wizard: first lets the user pick the engine
/// (Claude Code CLI, Codex CLI, or a local GGUF model), then — only for the Local choice — walks
/// through hardware detection, the curated model catalog, and the download. For a CLI choice it
/// just confirms the tool is on PATH; no download involved there.
/// </summary>
public partial class SummaryModelSetupDialogViewModel : ObservableObject
{
    [ObservableProperty]
    private SummaryModelWizardState _state = SummaryModelWizardState.ChoosingEngine;

    [ObservableProperty]
    private string _hardwareSummary = string.Empty;

    [ObservableProperty]
    private ModelOption? _selectedModel;

    [ObservableProperty]
    private string _downloadStatusText = string.Empty;

    [ObservableProperty]
    private string _cliCheckStatusText = string.Empty;

    private SummaryProviderKind _pendingCliKind;

    public ObservableCollection<ModelOption> Models { get; } = [];

    /// <summary>The engine the user ended up with once the wizard completes.</summary>
    public SummaryProviderKind ResultProviderKind { get; private set; } = SummaryProviderKind.Local;

    /// <summary>The local model file path the user ended up with, or null when the result is a CLI provider.</summary>
    public string? ResultModelPath { get; private set; }

    /// <summary>True only once the wizard actually produced a result (as opposed to being cancelled).</summary>
    public bool IsResolved { get; private set; }

    /// <summary>Raised once the wizard has a result and the host dialog should close.</summary>
    public event EventHandler? Completed;

    public bool IsChoosingEngine => State == SummaryModelWizardState.ChoosingEngine;
    public bool IsDetectingHardware => State == SummaryModelWizardState.DetectingHardware;
    public bool IsSelectingModel => State == SummaryModelWizardState.SelectingModel;
    public bool IsDownloading => State == SummaryModelWizardState.Downloading;
    public bool IsCheckingCli => State == SummaryModelWizardState.CheckingCli;
    public bool IsCompleted => State == SummaryModelWizardState.Completed;

    /// <summary>Skips straight to hardware detection / model selection, bypassing the engine
    /// chooser — used when the caller already knows the engine is Local (e.g. re-picking a model
    /// after the previously selected one was deleted).</summary>
    public Task InitializeForLocalOnlyAsync()
    {
        ResultProviderKind = SummaryProviderKind.Local;
        return DetectAsync();
    }

    [RelayCommand]
    private async Task ChooseEngineAsync(string kindName)
    {
        var kind = Enum.Parse<SummaryProviderKind>(kindName);

        if (kind == SummaryProviderKind.Local)
        {
            ResultProviderKind = SummaryProviderKind.Local;
            await DetectAsync();
            return;
        }

        await CheckCliAsync(kind);
    }

    private async Task CheckCliAsync(SummaryProviderKind kind)
    {
        _pendingCliKind = kind;
        ResultProviderKind = kind;
        State = SummaryModelWizardState.CheckingCli;

        if (CliProviderResolver.IsOnPath(kind))
        {
            await FinishWithCliAsync(kind);
            return;
        }

        var (name, installHint) = DescribeCli(kind);
        CliCheckStatusText = AppStrings.Format(
            "Cli_NotFoundCheckAgain",
            CliProviderResolver.ExecutableNameFor(kind),
            installHint);
    }

    [RelayCommand]
    private async Task RecheckCliAsync()
    {
        if (CliProviderResolver.IsOnPath(_pendingCliKind))
        {
            await FinishWithCliAsync(_pendingCliKind);
            return;
        }

        CliCheckStatusText = AppStrings.Format(
            "Cli_StillMissing",
            CliProviderResolver.ExecutableNameFor(_pendingCliKind));
    }

    [RelayCommand]
    private void BackToEngineChoice()
    {
        State = SummaryModelWizardState.ChoosingEngine;
    }

    private async Task FinishWithCliAsync(SummaryProviderKind kind)
    {
        await SaveSettingsAsync(settings => settings.SelectedSummaryProvider = kind.ToString());
        ResultProviderKind = kind;
        ResultModelPath = null;
        IsResolved = true;
        State = SummaryModelWizardState.Completed;
        Completed?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand]
    private Task DetectAsync()
    {
        State = SummaryModelWizardState.DetectingHardware;

        var hardware = AppServices.HardwareDetection.DetectHardware();
        HardwareSummary = hardware.HasDedicatedGpu
            ? AppStrings.Format("Hardware_WithGpu", hardware.TotalRamGb, hardware.GpuName ?? string.Empty, hardware.GpuVramGb)
            : AppStrings.Format("Hardware_NoGpu", hardware.TotalRamGb);

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
            await FinishWithLocalModelAsync(SelectedModel.Info);
            return;
        }

        State = SummaryModelWizardState.Downloading;
        SelectedModel.IsDownloading = true;
        DownloadStatusText = AppStrings.Format("Download_ModelProgress", SelectedModel.Info.DisplayName, 0);

        try
        {
            var progress = new Progress<double>(percent =>
            {
                SelectedModel.DownloadProgressPercent = percent;
                DownloadStatusText = AppStrings.Format("Download_ModelProgress", SelectedModel.Info.DisplayName, percent);
            });
            await AppServices.LocalLlmModels.DownloadModelAsync(SelectedModel.Info, progress);
            SelectedModel.IsDownloaded = true;
            await FinishWithLocalModelAsync(SelectedModel.Info);
        }
        catch (Exception ex)
        {
            DownloadStatusText = AppStrings.Format("Error_DownloadModel", ex.Message);
            State = SummaryModelWizardState.SelectingModel;
        }
        finally
        {
            SelectedModel.IsDownloading = false;
        }
    }

    private async Task FinishWithLocalModelAsync(SummaryModelInfo model)
    {
        ResultModelPath = AppServices.LocalLlmModels.GetModelPath(model);
        ResultProviderKind = SummaryProviderKind.Local;
        await SaveSettingsAsync(settings =>
        {
            settings.SelectedSummaryModelId = model.FileName;
            settings.SelectedSummaryProvider = SummaryProviderKind.Local.ToString();
        });
        IsResolved = true;
        State = SummaryModelWizardState.Completed;
        Completed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary><see cref="IAppSettingsService.SaveAsync"/> overwrites the settings file wholesale,
    /// so every write here must round-trip the fields it isn't touching rather than construct a
    /// fresh <see cref="AppSettings"/> (that would silently wipe out, e.g., the other field this
    /// wizard doesn't set on this particular path).</summary>
    private static async Task SaveSettingsAsync(Action<AppSettings> mutate)
    {
        var settings = await AppServices.Settings.LoadAsync();
        mutate(settings);
        await AppServices.Settings.SaveAsync(settings);
    }

    private static (string Name, string InstallHint) DescribeCli(SummaryProviderKind kind) => kind switch
    {
        SummaryProviderKind.ClaudeCode => (
            AppStrings.Get("Cli_ClaudeName"),
            AppStrings.Get("Cli_ClaudeHint")),
        SummaryProviderKind.Codex => (
            AppStrings.Get("Cli_CodexName"),
            AppStrings.Get("Cli_CodexHint")),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Only ClaudeCode and Codex are CLI-backed providers."),
    };

    partial void OnStateChanged(SummaryModelWizardState value)
    {
        OnPropertyChanged(nameof(IsChoosingEngine));
        OnPropertyChanged(nameof(IsDetectingHardware));
        OnPropertyChanged(nameof(IsSelectingModel));
        OnPropertyChanged(nameof(IsDownloading));
        OnPropertyChanged(nameof(IsCheckingCli));
        OnPropertyChanged(nameof(IsCompleted));
    }
}
