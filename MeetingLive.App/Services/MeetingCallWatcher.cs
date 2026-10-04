using Microsoft.UI.Xaml;
using MeetingLive.Core.Services;
using MeetingLive_App;

namespace MeetingLive_App.Services;

/// <summary>
/// While MeetingLive is running, poll for Zoom/Teams/Meet windows and raise <see cref="MeetingDetected"/>
/// once per call so the floating popup can offer to start recording. Armed again only after those
/// windows disappear, which also raises <see cref="MeetingEnded"/>.
/// </summary>
internal sealed class MeetingCallWatcher : IDisposable
{
    private readonly DispatcherTimer _timer;
    private bool _armed = true;
    private int _ticking;

    /// <summary>A call window appeared while idle and the popup is allowed. Raised on the UI thread.</summary>
    public event EventHandler? MeetingDetected;

    /// <summary>The call windows are gone, so a popup left on screen should hide. Raised on the UI thread.</summary>
    public event EventHandler? MeetingEnded;

    public MeetingCallWatcher()
    {
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _timer.Tick += (_, _) => _ = TickAsync();
    }

    public void Start() => _timer.Start();

    public void Dispose() => _timer.Stop();

    private async Task TickAsync()
    {
        if (Interlocked.Exchange(ref _ticking, 1) == 1)
            return;

        try
        {
            var inCall = MeetingWindowScanner.AnyMeetingWindow();
            if (!inCall)
            {
                if (!_armed)
                {
                    _armed = true;
                    MeetingEnded?.Invoke(this, EventArgs.Empty);
                }

                return;
            }

            if (!_armed || AppServices.Workspace.IsCaptureActive)
                return;

            _armed = false;
            AppServices.Workspace.OfferCallPrompt();

            var popupEnabled = await LoadPopupEnabledAsync();
            if (MeetingPopupPolicy.ShouldShow(popupEnabled, AppServices.Workspace.IsCaptureActive, alreadyPrompted: false))
                MeetingDetected?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception)
        {
            // Detection must never crash the app.
        }
        finally
        {
            Interlocked.Exchange(ref _ticking, 0);
        }
    }

    private static async Task<bool> LoadPopupEnabledAsync()
    {
        try
        {
            return (await AppServices.Settings.LoadAsync()).MeetingPopupEnabled;
        }
        catch (Exception)
        {
            // An unreadable settings file keeps the default: the popup is on.
            return true;
        }
    }
}
