using Microsoft.UI.Xaml;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using MeetingLive_App;

namespace MeetingLive_App.Services;

/// <summary>
/// While MeetingLive is running, poll for Zoom/Teams/Meet windows and offer a toast
/// to start notes. Armed again only after those windows disappear.
/// </summary>
internal sealed class MeetingCallWatcher : IDisposable
{
    public const string TakeNotesAction = "take-notes";

    private readonly DispatcherTimer _timer;
    private bool _armed = true;
    private bool _notificationsReady;

    public MeetingCallWatcher()
    {
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _timer.Tick += (_, _) => Tick();
    }

    public void Start()
    {
        try
        {
            AppNotificationManager.Default.NotificationInvoked += OnNotificationInvoked;
            AppNotificationManager.Default.Register();
            _notificationsReady = true;
        }
        catch (Exception)
        {
            _notificationsReady = false;
        }

        _timer.Start();
    }

    public void Dispose()
    {
        _timer.Stop();
        if (_notificationsReady)
        {
            try
            {
                AppNotificationManager.Default.NotificationInvoked -= OnNotificationInvoked;
            }
            catch (Exception)
            {
            }
        }
    }

    private void Tick()
    {
        var inCall = MeetingWindowScanner.AnyMeetingWindow();
        if (!inCall)
        {
            _armed = true;
            return;
        }

        if (!_armed || AppServices.Workspace.IsCaptureActive)
            return;

        _armed = false;
        AppServices.Workspace.OfferCallPrompt();
        ShowToast();
    }

    private void ShowToast()
    {
        if (!_notificationsReady)
            return;

        try
        {
            var notification = new AppNotificationBuilder()
                .AddArgument("action", TakeNotesAction)
                .AddText(AppStrings.Get("CallPrompt_Title"))
                .AddText(AppStrings.Get("CallPrompt_Body"))
                .AddButton(new AppNotificationButton(AppStrings.Get("CallPrompt_TakeNotes"))
                    .AddArgument("action", TakeNotesAction))
                .BuildNotification();

            AppNotificationManager.Default.Show(notification);
        }
        catch (Exception)
        {
            // Toast is best-effort; detection must never crash the app.
        }
    }

    private static void OnNotificationInvoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args)
    {
        if (!args.Arguments.TryGetValue("action", out var action) || action != TakeNotesAction)
            return;

        App.DispatcherQueue.TryEnqueue(() =>
        {
            App.Window.Activate();
            AppServices.Workspace.RequestTakeNotes();
        });
    }
}
