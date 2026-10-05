using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.UI.Dispatching;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Composition root for the central Settings page. Owns the page-level loading flag and
/// orchestrates the one-time settings/hardware load; each unrelated configuration domain
/// (local models, summary provider, language, microphone, transcription engine, data
/// folder) lives in its own section view model exposed as a property below, so the page
/// stays "the single place for all app configuration" without being a God object.
/// </summary>
public partial class SettingsPageViewModel : ObservableObject
{
    [ObservableProperty]
    private bool _isLoading;

    public UiLanguageSectionViewModel UiLanguage { get; } = new();

    public LocalModelSectionViewModel LocalModel { get; } = new();

    public SummaryProviderSectionViewModel SummaryProvider { get; } = new();

    public TypeSafeSectionViewModel TypeSafe { get; } = new();

    public LanguageSectionViewModel Language { get; } = new();

    public MicrophoneSectionViewModel Microphone { get; } = new();

    public TranscriptionEngineSectionViewModel TranscriptionEngine { get; } = new();

    public DataFolderSectionViewModel DataFolder { get; } = new();

    public CalendarSectionViewModel Calendar { get; } = new();

    /// <summary>False after <see cref="StopLevelMeter"/> so a load that finishes after
    /// the user left Settings does not reopen WASAPI on another page, and so a settings
    /// snapshot loaded after navigating away is never applied to the sections.</summary>
    private bool _isPageVisible;

    /// <summary>True only until the first successful local load has been applied. The page hides
    /// its content behind a progress ring meanwhile so defaults are never painted; later visits
    /// (the page is cached) already hold data and refresh silently.</summary>
    [ObservableProperty]
    private bool _isInitialLoading = true;

    private bool _hasRevealed;

    private bool _isNetworkLoadRunning;

    [RelayCommand]
    private async Task LoadAsync()
    {
        _isPageVisible = true;
        IsInitialLoading = !_hasRevealed;
        IsLoading = true;
        Microphone.BeginLoad();
        var localPhaseDone = false;
        try
        {
            // Paint the page (and the loading ring) before WMI / disk / WASAPI.
            await Task.Yield();

            var settingsTask = AppServices.Settings.LoadAsync();
            var snapshot = await Task.Run(CollectLoadSnapshot);
            var settings = await settingsTask;
            if (!_isPageVisible)
                return;

            // Local phase: everything below needs no network, so it is all applied in this one
            // synchronous run and the first frame the user sees already has the real values.
            UiLanguage.ApplyLoadedSettings(settings);
            LocalModel.ApplyLoadedModels(snapshot.Models, settings.SelectedSummaryModelId);
            SummaryProvider.ApplyLoadedSettings(settings);
            await TypeSafe.LoadAsync(settings);
            Language.ApplyLoadedSettings(settings);
            TranscriptionEngine.ApplyLoadedSettings(
                settings, snapshot.TranscriptionInstalled, snapshot.SpeakerDiarizationInstalled, snapshot.ExpectedBackend);
            TranscriptionEngine.StartObservingBackend();
            Microphone.ApplyLoadedDevices(snapshot.Microphones, settings.SelectedMicrophoneDeviceId);
            Calendar.ApplySettings(settings);

            // Reveal. The network work below runs after this and shows its own busy state.
            _hasRevealed = true;
            localPhaseDone = true;
            IsInitialLoading = false;
            IsLoading = false;
            Microphone.EndLoad();

            // Opening WASAPI is another hitch — start after this frame paints, and only
            // if the page is still visible when this deferred callback runs.
            App.DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
            {
                if (_isPageVisible)
                    Microphone.RestartLevelMeter();
            });

            await LoadNetworkSectionsAsync(settings);
        }
        finally
        {
            if (!localPhaseDone)
            {
                IsLoading = false;
                Microphone.EndLoad();
            }

            // Never leave the page stuck behind the ring (e.g. when settings.json could not be read).
            IsInitialLoading = false;
        }
    }

    /// <summary>Sections that need the network (xAI token refresh + model list, calendar list).
    /// Runs after the page is revealed; each part is exception-safe on its own.</summary>
    private async Task LoadNetworkSectionsAsync(AppSettings settings)
    {
        if (_isNetworkLoadRunning)
            return;

        _isNetworkLoadRunning = true;
        try
        {
            await Task.WhenAll(SummaryProvider.LoadXaiAccountAsync(), Calendar.LoadAsync(settings));
        }
        catch (Exception)
        {
            // The xAI and calendar sections surface their own failures; nothing may fault the page.
        }
        finally
        {
            _isNetworkLoadRunning = false;
        }
    }

    partial void OnIsLoadingChanged(bool value)
    {
        SummaryProvider.SetLoading(value);
        Microphone.SetLoading(value);
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
            AppServices.NemotronModels.IsDiarizationModelDownloaded(),
            TranscriptionEngineInstaller.ExpectedBackend(hardware, AppServices.NemoSpeechRuntime),
            AppServices.Microphones.GetAvailableMicrophones());
    }

    /// <summary>Called when navigating away so the preview microphone isn't held open
    /// on another page, and so this view model doesn't leak a subscription on the
    /// app-lifetime level-meter singleton.</summary>
    public void StopLevelMeter()
    {
        _isPageVisible = false;
        TranscriptionEngine.StopObservingBackend();
        Microphone.StopLevelMeter();
    }

    private sealed record SettingsLoadSnapshot(
        IReadOnlyList<(SummaryModelInfo Info, FitRating Rating, bool Downloaded)> Models,
        bool TranscriptionInstalled,
        bool SpeakerDiarizationInstalled,
        NemoSpeechBackend ExpectedBackend,
        IReadOnlyList<MicrophoneDeviceOption> Microphones);
}
