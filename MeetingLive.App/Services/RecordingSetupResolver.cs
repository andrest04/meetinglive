using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Dialogs;

namespace MeetingLive_App.Services;

/// <summary>Display strings plus <see cref="RecordingReadiness"/> for the pre-record checklist.</summary>
public sealed record RecordingSetupSnapshot(
    RecordingReadiness Readiness,
    string LiveStatusText,
    string LiveDetailText,
    string EngineStatusText,
    string EngineDetailText,
    string SummaryStatusText,
    string SummaryDetailText);

/// <summary>
/// Gates Record on Nemotron (always, for the saved transcript) and a chosen summary engine.
/// Live preview uses the same Nemotron install when enabled.
/// </summary>
public static class RecordingSetupResolver
{
    public static async Task<RecordingSetupSnapshot> EvaluateAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();
        var provider = ParseChosenProvider(settings);
        var localSelected = provider == SummaryProviderKind.Local;
        var localDownloaded = localSelected && IsLocalModelDownloaded(settings);
        var cliOnPath = provider is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex
            && CliProviderResolver.IsOnPath(provider.Value);
        var engineReady = TranscriptionEngineInstaller.IsReady(
            AppServices.NemotronModels, AppServices.NemoSpeechRuntime);

        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: settings.LiveTranscriptionEnabled,
            engineReady: engineReady,
            summaryProviderChosen: provider is not null,
            localSummarySelected: localSelected,
            localModelDownloaded: localDownloaded,
            cliOnPath: cliOnPath);

        return new RecordingSetupSnapshot(
            Readiness: readiness,
            LiveStatusText: LiveStatusLabel(readiness),
            LiveDetailText: readiness.LiveRequired
                ? AppStrings.Get("RecordingSetup_LiveDetail")
                : AppStrings.Get("RecordingSetup_LiveNotNeededDetail"),
            EngineStatusText: readiness.EngineReady
                ? AppStrings.Get("RecordingSetup_Ready")
                : AppStrings.Get("RecordingSetup_NeedsSetup"),
            EngineDetailText: AppStrings.Get("RecordingSetup_EngineDetail"),
            SummaryStatusText: readiness.SummaryReady
                ? AppStrings.Get("RecordingSetup_Ready")
                : AppStrings.Get("RecordingSetup_NeedsSetup"),
            SummaryDetailText: SummaryCaption(provider, settings.SelectedSummaryModelId));
    }

    /// <summary>Returns true when Record may start. Shows the checklist only when something is missing.</summary>
    public static async Task<bool> EnsureReadyAsync(XamlRoot xamlRoot)
    {
        var snapshot = await EvaluateAsync();
        if (snapshot.Readiness.CanRecord)
            return true;

        while (true)
        {
            var dialog = new RecordingSetupDialog { XamlRoot = xamlRoot };
            dialog.Apply(snapshot);
            var result = await dialog.ShowAsync();
            if (result != ContentDialogResult.Primary)
                return false;

            if (dialog.ViewModel.CanRecord)
                return true;

            await RunMissingStepsAsync(xamlRoot);
            snapshot = await EvaluateAsync();
            if (snapshot.Readiness.CanRecord)
                return true;
        }
    }

    private static async Task RunMissingStepsAsync(XamlRoot xamlRoot)
    {
        var snapshot = await EvaluateAsync();
        var readiness = snapshot.Readiness;

        if (!readiness.EngineReady)
        {
            var engineReady = await TranscriptionEngineSetupDialog.ShowAsync(xamlRoot);
            if (!engineReady)
                return;
            snapshot = await EvaluateAsync();
            readiness = snapshot.Readiness;
        }

        if (!readiness.SummaryReady)
        {
            var chosen = await SummaryModelSetupDialog.ShowAsync(xamlRoot);
            if (chosen is null)
                return;

            var (kind, _) = chosen.Value;
            if (kind is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex)
                await CliProviderResolver.EnsureAvailableAsync(kind, xamlRoot);
        }
    }

    private static SummaryProviderKind? ParseChosenProvider(AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.SelectedSummaryProvider))
            return null;

        return Enum.TryParse<SummaryProviderKind>(settings.SelectedSummaryProvider, out var kind)
            ? kind
            : null;
    }

    private static bool IsLocalModelDownloaded(AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.SelectedSummaryModelId))
            return false;

        var model = ModelCatalog.SummaryModels.FirstOrDefault(m => m.FileName == settings.SelectedSummaryModelId);
        return model is not null && AppServices.LocalLlmModels.IsModelDownloaded(model);
    }

    private static string LiveStatusLabel(RecordingReadiness readiness)
    {
        if (!readiness.LiveRequired)
            return AppStrings.Get("RecordingSetup_NotNeeded");

        return readiness.LiveReady
            ? AppStrings.Get("RecordingSetup_Ready")
            : AppStrings.Get("RecordingSetup_NeedsSetup");
    }

    private static string SummaryCaption(SummaryProviderKind? provider, string? modelId)
    {
        if (provider is null)
            return AppStrings.Get("RecordingSetup_SummaryNotChosen");

        return provider switch
        {
            SummaryProviderKind.Local => LocalSummaryCaption(modelId),
            SummaryProviderKind.ClaudeCode => AppStrings.Get("Cli_ClaudeName"),
            SummaryProviderKind.Codex => AppStrings.Get("Cli_CodexName"),
            _ => AppStrings.Get("RecordingSetup_SummaryNotChosen"),
        };
    }

    private static string LocalSummaryCaption(string? modelId)
    {
        if (string.IsNullOrWhiteSpace(modelId))
            return AppStrings.Get("RecordingSetup_SummaryLocal");

        var model = ModelCatalog.SummaryModels.FirstOrDefault(m => m.FileName == modelId);
        return model is null
            ? AppStrings.Get("RecordingSetup_SummaryLocal")
            : AppStrings.Format("RecordingSetup_SummaryLocalModel", model.DisplayName);
    }
}
