using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// The meeting-audio half of the Record page's Sources card: "All system audio" plus one card per app that is
/// currently playing, with live meters. One background loop owns the (not thread-safe) WASAPI session source:
/// it re-enumerates about every 1.5 s and reads peaks about every 150 ms, and hands results to the UI thread.
/// Polling runs only while the page is visible and idle.
/// </summary>
public sealed partial class RecordingAudioSourcesViewModel : ObservableObject
{
    private static readonly TimeSpan PeakInterval = TimeSpan.FromMilliseconds(150);
    private const int PeaksPerRefresh = 10;

    private readonly IProcessInfoProvider _processes = new WindowsProcessInfoProvider();
    private readonly HashSet<uint> _dismissedSuggestions = [];
    private IReadOnlyList<ActiveAudioApp> _lastApps = [];
    private CancellationTokenSource? _pollCts;
    private int _pollGeneration;
    private uint _suggestedProcessId;
    private bool _updatingSuggestion;
    private bool _userTouched;
    private bool _restorePending;
    private bool _restoring;

    public RecordingAudioSourcesViewModel()
    {
        SystemCard = new AudioSourceCard(
            AppStrings.Get("RecordPage_AllSystemAudio.Text"),
            AppStrings.Get("RecordPage_SystemCardTooltip"));
        Cards.Add(SystemCard);
        _selectedCard = SystemCard;
    }

    public AudioSourceCard SystemCard { get; }

    public ObservableCollection<AudioSourceCard> Cards { get; } = [];

    [ObservableProperty]
    private AudioSourceCard? _selectedCard;

    public bool IsAppSelected => SelectedCard is { IsSystem: false };

    /// <summary>Nothing is playing right now (a dimmed selected app does not count).</summary>
    public bool ShowEmptyHint => !Cards.Any(card => !card.IsSystem && card.IsAvailable);

    /// <summary>"All system audio" or the selected app's name, for the recording summary line.</summary>
    public string SelectedName => (SelectedCard ?? SystemCard).Name;

    /// <summary>Shown when the selected app was gone at Record time and the recording used system audio instead.</summary>
    [ObservableProperty]
    private string _fallbackMessage = string.Empty;

    [ObservableProperty]
    private bool _isFallbackOpen;

    /// <summary>"Zoom is in a call" prompt shown while all system audio is selected. Never switches by itself.</summary>
    [ObservableProperty]
    private bool _isSuggestionOpen;

    [ObservableProperty]
    private string _suggestionTitle = string.Empty;

    [ObservableProperty]
    private string _suggestionActionLabel = string.Empty;

    partial void OnSelectedCardChanged(AudioSourceCard? value)
    {
        OnPropertyChanged(nameof(IsAppSelected));
        OnPropertyChanged(nameof(SelectedName));
        EvaluateSuggestion();
    }

    /// <summary>Closing the InfoBar (the user's X) dismisses that process for the rest of the session.</summary>
    partial void OnIsSuggestionOpenChanged(bool value)
    {
        if (value || _updatingSuggestion || _suggestedProcessId == 0)
            return;

        _dismissedSuggestions.Add(_suggestedProcessId);
        _suggestedProcessId = 0;
    }

    /// <summary>User picked a card. Programmatic changes go through <see cref="SelectedCard"/> directly.</summary>
    public void SelectCard(AudioSourceCard card)
    {
        if (ReferenceEquals(SelectedCard, card))
            return;

        _userTouched = true;
        IsFallbackOpen = false;
        SelectedCard = card;
        _ = RememberChoiceAsync(card);
    }

    [RelayCommand]
    private void UseSuggestedApp()
    {
        var card = Cards.FirstOrDefault(item => !item.IsSystem && item.ProcessId == _suggestedProcessId);
        if (card is not null)
            SelectCard(card);
    }

    /// <summary>Load, mutate, save: the settings file is rewritten wholesale, so never start from a fresh AppSettings.</summary>
    private static async Task RememberChoiceAsync(AudioSourceCard card)
    {
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            if (card.IsSystem)
                RecordAudioSourceMemory.RememberSystemAudio(settings);
            else
                RecordAudioSourceMemory.RememberApp(settings, card.ExePath, card.Name);

            await AppServices.Settings.SaveAsync(settings);
        }
        catch (Exception)
        {
            // Remembering is a convenience; a locked settings file must not break picking a card.
        }
    }

    private void EvaluateSuggestion()
    {
        // Wait for the remembered app to be restored first, so a suggestion does not flash up and vanish.
        if (_restoring)
            return;

        var pick = MeetingAppSuggestion.Pick(_lastApps, SelectedCard is null or { IsSystem: true }, _dismissedSuggestions);
        _updatingSuggestion = true;
        try
        {
            if (pick is null)
            {
                _suggestedProcessId = 0;
                IsSuggestionOpen = false;
                return;
            }

            if (_suggestedProcessId != pick.ProcessId)
            {
                _suggestedProcessId = pick.ProcessId;
                SuggestionTitle = AppStrings.Format("RecordPage_SuggestionTitle", pick.FriendlyName);
                SuggestionActionLabel = AppStrings.Format("RecordPage_SuggestionAction", pick.FriendlyName);
            }

            IsSuggestionOpen = true;
        }
        finally
        {
            _updatingSuggestion = false;
        }
    }

    /// <summary>
    /// Reselects the remembered app, but only when an app with that executable is playing right now.
    /// Anything else stays on all system audio without a message. Programmatic: it is not written back.
    /// </summary>
    private async Task RestoreRememberedAppAsync()
    {
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            if (_userTouched || SelectedCard is { IsSystem: false })
                return;

            if (RecordAudioSourceMemory.RestoreApp(settings, _lastApps) is { } app
                && Cards.FirstOrDefault(card => !card.IsSystem && card.ProcessId == app.ProcessId) is { } restored)
            {
                SelectedCard = restored;
            }
        }
        catch (Exception)
        {
            // Unreadable settings: stay on all system audio.
        }
        finally
        {
            _restoring = false;
            EvaluateSuggestion();
        }
    }

    /// <summary>
    /// Called when Record is pressed. Null means all system audio; otherwise the root process id of the chosen app.
    /// An app that no longer exists falls back to system audio and raises <see cref="IsFallbackOpen"/>.
    /// </summary>
    public uint? ResolveRecordingTarget()
    {
        if (SelectedCard is not { IsSystem: false, App: { } app } card)
            return null;

        if (ActiveAppEntries.IsStillRunning(app, _processes))
        {
            IsFallbackOpen = false;
            return app.ProcessId;
        }

        FallbackMessage = AppStrings.Format("RecordPage_SourceFallbackMessage", card.Name);
        IsFallbackOpen = true;
        SelectedCard = SystemCard;
        return null;
    }

    public void Start()
    {
        if (_pollCts is not null)
            return;

        _restorePending = !_userTouched;
        var cts = new CancellationTokenSource();
        _pollCts = cts;
        var generation = ++_pollGeneration;
        _ = Task.Run(() => PollAsync(generation, cts.Token));
    }

    public void Stop()
    {
        var cts = _pollCts;
        _pollCts = null;
        _pollGeneration++;
        cts?.Cancel();
        cts?.Dispose();

        foreach (var card in Cards)
            card.Level = 0;
    }

    private async Task PollAsync(int generation, CancellationToken cancellationToken)
    {
        try
        {
            // Created on this thread and used only here: the session source is not thread-safe.
            using var source = new NAudioAudioSessionSource();
            var service = new ActiveAudioAppService(source, _processes, (uint)Environment.ProcessId);

            Publish(generation, service.Refresh());

            using var timer = new PeriodicTimer(PeakInterval);
            var ticks = 0;
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (++ticks % PeaksPerRefresh == 0)
                    Publish(generation, service.Refresh());
                else
                    PublishPeaks(generation, service.ReadPeaks());
            }
        }
        catch (OperationCanceledException)
        {
            // Page hidden or recording started.
        }
        catch (Exception)
        {
            // The meters are best effort. A broken audio service must not take the page down.
        }
    }

    private void Publish(int generation, IReadOnlyList<ActiveAudioApp> apps) =>
        App.DispatcherQueue.TryEnqueue(() =>
        {
            if (generation == _pollGeneration)
                ApplyApps(apps);
        });

    private void PublishPeaks(int generation, IReadOnlyDictionary<uint, float> peaks) =>
        App.DispatcherQueue.TryEnqueue(() =>
        {
            if (generation == _pollGeneration)
                ApplyPeaks(peaks);
        });

    private void ApplyPeaks(IReadOnlyDictionary<uint, float> peaks)
    {
        foreach (var card in Cards)
        {
            if (card.IsSystem || !card.IsAvailable)
                continue;

            card.Level = AudioLevelMeter.ToMeterValue(peaks.GetValueOrDefault(card.ProcessId)) * 100.0;
        }
    }

    private void ApplyApps(IReadOnlyList<ActiveAudioApp> apps)
    {
        var selectedApp = SelectedCard is { IsSystem: false } selected ? selected.App : null;
        var entries = ActiveAppEntries.Merge(apps, selectedApp);

        var existing = Cards.Where(card => !card.IsSystem).ToDictionary(card => card.ProcessId);
        var desired = new List<AudioSourceCard>(entries.Count + 1) { SystemCard };
        foreach (var entry in entries)
        {
            if (!existing.TryGetValue(entry.App.ProcessId, out var card))
            {
                card = new AudioSourceCard(entry.App, AppStrings.Get("RecordPage_AppCardTooltip"));
                _ = LoadIconAsync(card);
            }

            card.Update(entry);
            desired.Add(card);
        }

        SyncCards(desired);
        OnPropertyChanged(nameof(ShowEmptyHint));

        _lastApps = apps;
        if (_restorePending)
        {
            _restorePending = false;
            _restoring = true;
            _ = RestoreRememberedAppAsync();
        }

        EvaluateSuggestion();
    }

    /// <summary>Minimal removes, inserts and moves, so cards that stay are never recreated and the selection holds.</summary>
    private void SyncCards(IReadOnlyList<AudioSourceCard> desired)
    {
        for (var i = Cards.Count - 1; i >= 0; i--)
        {
            if (!desired.Contains(Cards[i]))
                Cards.RemoveAt(i);
        }

        for (var i = 0; i < desired.Count; i++)
        {
            if (i < Cards.Count && ReferenceEquals(Cards[i], desired[i]))
                continue;

            var current = Cards.IndexOf(desired[i]);
            if (current >= 0)
                Cards.Move(current, i);
            else
                Cards.Insert(i, desired[i]);
        }
    }

    private static async Task LoadIconAsync(AudioSourceCard card)
    {
        var icon = await AppIconCache.GetAsync(card.ExePath);
        if (icon is not null)
            card.Icon = icon;
    }
}
