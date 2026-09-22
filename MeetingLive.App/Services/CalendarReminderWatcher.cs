using Microsoft.UI.Xaml;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App;

namespace MeetingLive_App.Services;

/// <summary>
/// While MeetingLive is running, poll the Windows calendar and toast one minute before a meeting.
/// Silent when capture is active, notifications are off, or the store fails. Never toasts an error.
/// </summary>
internal sealed class CalendarReminderWatcher : IDisposable
{
    public const string OpenEventAction = "open-calendar-event";
    public const string EventIdArgument = "eventId";

    private readonly DispatcherTimer _timer;
    private readonly Dictionary<string, DateTimeOffset> _notified = new(StringComparer.Ordinal);
    private bool _notificationsReady;
    private int _polling;

    public CalendarReminderWatcher()
    {
        _timer = new DispatcherTimer { Interval = CalendarReminder.PollInterval };
        _timer.Tick += (_, _) => _ = PollAsync();
    }

    public void Start()
    {
        try
        {
            AppNotificationManager.Default.NotificationInvoked += OnNotificationInvoked;
            try
            {
                AppNotificationManager.Default.Register();
            }
            catch (Exception)
            {
                // MeetingCallWatcher registers the manager first. A second Register throws.
            }

            _notificationsReady = true;
        }
        catch (Exception)
        {
            _notificationsReady = false;
        }

        _timer.Start();
        _ = PollAsync();
    }

    public void Dispose()
    {
        _timer.Stop();
        if (!_notificationsReady)
            return;

        try
        {
            AppNotificationManager.Default.NotificationInvoked -= OnNotificationInvoked;
        }
        catch (Exception)
        {
        }
    }

    private async Task PollAsync()
    {
        if (Interlocked.Exchange(ref _polling, 1) == 1)
            return;

        try
        {
            if (AppServices.Workspace.IsCaptureActive)
                return;

            var settings = await AppServices.Settings.LoadAsync();
            if (!settings.CalendarNotificationsEnabled)
                return;

            var result = await AppServices.Calendar.GetUpcomingAsync(DateTimeOffset.Now, settings.DisabledCalendarIdsAsSet());
            if (result.Failure is CalendarStoreFailure.AccessDenied or CalendarStoreFailure.NoPackageIdentity)
                return;

            if (AppServices.Workspace.IsCaptureActive || !settings.CalendarNotificationsEnabled)
                return;

            var now = DateTimeOffset.Now;
            CalendarReminder.ForgetStarted(_notified, now);

            var alreadyNotified = new HashSet<string>(_notified.Keys, StringComparer.Ordinal);
            foreach (var calendarEvent in result.Events)
            {
                if (!CalendarReminder.ShouldNotify(calendarEvent, now, alreadyNotified))
                    continue;

                if (!ShowToast(calendarEvent))
                    continue;

                _notified[calendarEvent.EventId] = calendarEvent.Start;
                alreadyNotified.Add(calendarEvent.EventId);
            }
        }
        catch (Exception)
        {
            // A calendar read or a toast must never crash the app, and must never surface as a toast.
        }
        finally
        {
            Interlocked.Exchange(ref _polling, 0);
        }
    }

    private bool ShowToast(CalendarEvent calendarEvent)
    {
        if (!_notificationsReady || string.IsNullOrWhiteSpace(calendarEvent.Subject))
            return false;

        try
        {
            var eventId = Uri.EscapeDataString(calendarEvent.EventId);
            var notification = new AppNotificationBuilder()
                .AddArgument("action", OpenEventAction)
                .AddArgument(EventIdArgument, eventId)
                .AddText(calendarEvent.Subject.Trim())
                .AddText(AppStrings.Get("CalendarReminder_Body"))
                .AddButton(new AppNotificationButton(AppStrings.Get("CallPrompt_TakeNotes"))
                    .AddArgument("action", OpenEventAction)
                    .AddArgument(EventIdArgument, eventId))
                .BuildNotification();

            AppNotificationManager.Default.Show(notification);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void OnNotificationInvoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args)
    {
        try
        {
            if (!args.Arguments.TryGetValue("action", out var action) || action != OpenEventAction)
                return;
            if (!args.Arguments.TryGetValue(EventIdArgument, out var encoded) || string.IsNullOrWhiteSpace(encoded))
                return;

            var eventId = Uri.UnescapeDataString(encoded);
            if (string.IsNullOrWhiteSpace(eventId))
                return;

            App.DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    App.Window.Activate();
                    AppServices.Workspace.RequestTakeNotes(eventId);
                }
                catch (Exception)
                {
                }
            });
        }
        catch (Exception)
        {
        }
    }
}
