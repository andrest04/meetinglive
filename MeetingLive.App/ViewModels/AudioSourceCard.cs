using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Services;
using Microsoft.UI.Xaml.Media;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// One card in the meeting-audio picker: the fixed "All system audio" card (<see cref="App"/> is null)
/// or one app that is playing audio. The same instance is reused across refreshes so the selection never resets.
/// </summary>
public sealed partial class AudioSourceCard : ObservableObject
{
    private const string SystemGlyph = "";
    private const string AppGlyph = "";

    public AudioSourceCard(string name, string tooltip)
    {
        Name = name;
        Tooltip = tooltip;
    }

    public AudioSourceCard(ActiveAudioApp app, string tooltip)
    {
        App = app;
        Name = app.FriendlyName;
        Tooltip = tooltip;
    }

    /// <summary>Null for the "All system audio" card.</summary>
    public ActiveAudioApp? App { get; private set; }

    public string Name { get; }

    public string Tooltip { get; }

    public bool IsSystem => App is null;

    public uint ProcessId => App?.ProcessId ?? 0;

    public string? ExePath => App?.ExePath;

    public bool IsBrowser => App is { IsBrowser: true };

    public bool IsKnownMeetingApp => App is { IsKnownMeetingApp: true };

    /// <summary>The system card has no meter: a system-wide peak is not read, and a made-up one would mislead.</summary>
    public bool HasMeter => App is not null;

    public string FallbackGlyph => IsSystem ? SystemGlyph : AppGlyph;

    [ObservableProperty]
    private double _level;

    /// <summary>False once the app stopped playing. A selected app stays in the list, dimmed.</summary>
    [ObservableProperty]
    private bool _isAvailable = true;

    [ObservableProperty]
    private ImageSource? _icon;

    public bool HasIcon => Icon is not null;

    public bool ShowFallbackGlyph => Icon is null;

    public double CardOpacity => IsAvailable ? 1.0 : 0.55;

    public bool ShowNotPlaying => !IsSystem && !IsAvailable;

    public bool ShowBrowserHint => IsBrowser && IsAvailable;

    public bool ShowDetectedTag => IsKnownMeetingApp && IsAvailable;

    partial void OnIconChanged(ImageSource? value)
    {
        OnPropertyChanged(nameof(HasIcon));
        OnPropertyChanged(nameof(ShowFallbackGlyph));
    }

    partial void OnIsAvailableChanged(bool value)
    {
        OnPropertyChanged(nameof(CardOpacity));
        OnPropertyChanged(nameof(ShowNotPlaying));
        OnPropertyChanged(nameof(ShowBrowserHint));
        OnPropertyChanged(nameof(ShowDetectedTag));
    }

    /// <summary>Latest enumeration of the same app (same process id). Keeps the previous app data when it stopped playing.</summary>
    public void Update(ActiveAppEntry entry)
    {
        IsAvailable = entry.IsAvailable;
        if (entry.IsAvailable)
        {
            App = entry.App;
            Level = AudioLevelMeter.ToMeterValue(entry.App.Peak) * 100.0;
        }
        else
        {
            Level = 0;
        }
    }

    /// <summary>Announced by screen readers and used for the item's automation name.</summary>
    public override string ToString() => Name;
}
