using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: microphone device selection and its live input-level meter.
/// </summary>
public sealed partial class MicrophoneSectionViewModel : SettingsSectionViewModelBase
{
    private readonly IMicrophoneLevelMeterService _levelMeter = AppServices.MicrophoneLevelMeter;

    [ObservableProperty]
    private MicrophoneDeviceOption _selectedMicrophone = DefaultMicrophoneOption;

    [ObservableProperty]
    private double _micLevel;

    private bool _isLoading;

    /// <summary>True while rebuilding the mic list. ComboBox SelectionChanged after
    /// <see cref="ObservableCollection{T}.Clear"/> would otherwise save System default
    /// and wipe the user's device.</summary>
    private bool _suppressMicrophoneCommit;

    /// <summary>Sentinel entry meaning "use the OS default input device" — its empty
    /// <see cref="MicrophoneDeviceOption.Id"/> is never a real WASAPI device id.</summary>
    private static MicrophoneDeviceOption DefaultMicrophoneOption =>
        new(string.Empty, AppStrings.Get("Microphone_SystemDefault"));

    public ObservableCollection<MicrophoneDeviceOption> Microphones { get; } = [];

    /// <summary>Mirrors the settings page's overall loading state so a ComboBox
    /// SelectionChanged fired while the page is still loading is ignored.</summary>
    public void SetLoading(bool value) => _isLoading = value;

    /// <summary>Called at the start of the settings page's load, before <see cref="Microphones"/>
    /// is rebuilt, so the ComboBox's own SelectionChanged doesn't commit a spurious selection.</summary>
    public void BeginLoad() => _suppressMicrophoneCommit = true;

    /// <summary>Called once the settings page's load has finished painting.</summary>
    public void EndLoad() => App.DispatcherQueue.TryEnqueue(() => _suppressMicrophoneCommit = false);

    public void ApplyLoadedDevices(IReadOnlyList<MicrophoneDeviceOption> microphones, string? savedMicrophoneId)
    {
        Microphones.Clear();
        var systemDefault = DefaultMicrophoneOption;
        Microphones.Add(systemDefault);
        foreach (var microphone in microphones)
            Microphones.Add(microphone);

        // ComboBox only displays SelectedItem when it is the same instance as an
        // ItemsSource row. Null saved id means system default (empty Id).
        var savedId = savedMicrophoneId ?? string.Empty;
        var chosen = Microphones.FirstOrDefault(m => m.Id == savedId) ?? systemDefault;
        // Record equality would skip the generated setter (field already looks like
        // System default), so the ComboBox never gets SelectedItem and stays blank.
        _selectedMicrophone = chosen;
        OnPropertyChanged(nameof(SelectedMicrophone));
    }

    public void RestartLevelMeter()
    {
        _levelMeter.LevelChanged -= OnMicLevelChanged;
        _levelMeter.LevelChanged += OnMicLevelChanged;
        var deviceId = string.IsNullOrEmpty(SelectedMicrophone.Id) ? null : SelectedMicrophone.Id;
        _levelMeter.Start(deviceId);
    }

    /// <summary>Called when navigating away so the preview microphone isn't held open
    /// on another page, and so this view model doesn't leak a subscription on the
    /// app-lifetime <see cref="_levelMeter"/> singleton.</summary>
    public void StopLevelMeter()
    {
        _levelMeter.Stop();
        _levelMeter.LevelChanged -= OnMicLevelChanged;
    }

    private void OnMicLevelChanged(object? sender, float level)
    {
        App.DispatcherQueue.TryEnqueue(() => MicLevel = Math.Clamp(level * 100.0, 0, 100));
    }

    [RelayCommand]
    private async Task SelectMicrophoneAsync(MicrophoneDeviceOption option)
    {
        if (_isLoading || _suppressMicrophoneCommit)
            return;

        if (option.Id == SelectedMicrophone.Id)
            return;

        SelectedMicrophone = option;
        RestartLevelMeter();
        var deviceId = string.IsNullOrEmpty(option.Id) ? null : option.Id;
        await SaveSettingsAsync(settings => settings.SelectedMicrophoneDeviceId = deviceId);
    }
}
