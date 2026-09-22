using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>One calendar the user can hide. Off means the id is in <see cref="AppSettings.DisabledCalendarIds"/>.</summary>
public sealed partial class CalendarVisibilityOption : ObservableObject
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public string ToggleAutomationId => "ToggleCalendar_" + Id;

    [ObservableProperty]
    private bool _isEnabled = true;
}

/// <summary>
/// Settings for the one-minute reminder and which calendars Coming up and the reminder read.
/// A calendar-store failure is the same empty text Coming up uses. It is not a crash.
/// </summary>
public sealed partial class CalendarSectionViewModel : SettingsSectionViewModelBase
{
    private bool _applying;

    [ObservableProperty]
    private bool _notificationsEnabled = true;

    [ObservableProperty]
    private string _calendarMessage = string.Empty;

    [ObservableProperty]
    private bool _hasCalendars;

    public bool HasCalendarMessage => CalendarMessage.Length > 0;

    public ObservableCollection<CalendarVisibilityOption> Calendars { get; } = [];

    partial void OnCalendarMessageChanged(string value) => OnPropertyChanged(nameof(HasCalendarMessage));

    public async Task LoadAsync(AppSettings settings)
    {
        _applying = true;
        try
        {
            NotificationsEnabled = settings.CalendarNotificationsEnabled;
            var result = await AppServices.Calendar.GetCalendarsAsync();
            ApplyList(result, settings);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            ShowFailure(CalendarStoreFailure.AccessDenied);
        }
        finally
        {
            _applying = false;
        }
    }

    [RelayCommand]
    private async Task SetNotificationsEnabledAsync(bool isEnabled)
    {
        if (_applying || isEnabled == NotificationsEnabled)
            return;

        NotificationsEnabled = isEnabled;
        await SaveSettingsAsync(settings => settings.CalendarNotificationsEnabled = isEnabled);
    }

    public async Task SetCalendarEnabledAsync(CalendarVisibilityOption option, bool isEnabled)
    {
        ArgumentNullException.ThrowIfNull(option);
        if (_applying || option.IsEnabled == isEnabled)
            return;

        option.IsEnabled = isEnabled;
        await SaveSettingsAsync(settings =>
        {
            settings.DisabledCalendarIds ??= [];
            settings.DisabledCalendarIds.RemoveAll(id => string.Equals(id, option.Id, StringComparison.Ordinal));
            if (!isEnabled)
                settings.DisabledCalendarIds.Add(option.Id);
        });
    }

    private void ApplyList(CalendarListResult result, AppSettings settings)
    {
        if (result.Failure is CalendarStoreFailure.AccessDenied or CalendarStoreFailure.NoPackageIdentity or CalendarStoreFailure.Empty)
        {
            ShowFailure(result.Failure.Value);
            return;
        }

        var disabled = settings.DisabledCalendarIdsAsSet();
        Calendars.Clear();
        foreach (var calendar in result.Calendars)
        {
            Calendars.Add(new CalendarVisibilityOption
            {
                Id = calendar.Id,
                Name = calendar.Name,
                IsEnabled = !disabled.Contains(calendar.Id),
            });
        }

        HasCalendars = Calendars.Count > 0;
        CalendarMessage = string.Empty;
    }

    private void ShowFailure(CalendarStoreFailure failure)
    {
        Calendars.Clear();
        HasCalendars = false;
        CalendarMessage = failure switch
        {
            CalendarStoreFailure.NoPackageIdentity => AppStrings.Get("ComingUp_NoPackageIdentity"),
            CalendarStoreFailure.Empty => AppStrings.Get("ComingUp_Empty"),
            _ => AppStrings.Get("ComingUp_AccessDenied"),
        };
    }
}
