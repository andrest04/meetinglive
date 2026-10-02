using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
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
    private CancellationTokenSource? _pollCts;
    private int _pollGeneration;

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

    partial void OnSelectedCardChanged(AudioSourceCard? value)
    {
        OnPropertyChanged(nameof(IsAppSelected));
        OnPropertyChanged(nameof(SelectedName));
    }

    /// <summary>User picked a card. Programmatic changes go through <see cref="SelectedCard"/> directly.</summary>
    public void SelectCard(AudioSourceCard card)
    {
        if (ReferenceEquals(SelectedCard, card))
            return;

        IsFallbackOpen = false;
        SelectedCard = card;
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
