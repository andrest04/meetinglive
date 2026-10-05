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
    private bool _windowFound;
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

        var disarmedThisTick = false;
        try
        {
            var inCall = MeetingWindowScanner.AnyMeetingWindow();
            if (inCall != _windowFound)
            {
                _windowFound = inCall;
                Log(inCall ? "meeting window found" : "meeting window not found");
            }

            if (!inCall)
            {
                if (!_armed)
                {
                    _armed = true;
                    Log("armed (no meeting window left)");
                    MeetingEnded?.Invoke(this, EventArgs.Empty);
                }

                return;
            }

            if (!_armed)
                return;

            if (AppServices.Workspace.IsCaptureActive)
            {
                // Recording already runs for this call: stay quiet until it ends, even if capture stops mid-call.
                _armed = false;
                Log("disarmed, popup suppressed (capture active)");
                return;
            }

            _armed = false;
            disarmedThisTick = true;
            Log("disarmed (meeting started)");
            AppServices.Workspace.OfferCallPrompt();

            var popupEnabled = await LoadPopupEnabledAsync();
            if (MeetingPopupPolicy.ShouldShow(popupEnabled, AppServices.Workspace.IsCaptureActive, alreadyPrompted: false))
            {
                Log("MeetingDetected raised");
                MeetingDetected?.Invoke(this, EventArgs.Empty);
            }
            else
            {
                Log($"popup suppressed (enabled={popupEnabled}, captureActive={AppServices.Workspace.IsCaptureActive})");
            }

            disarmedThisTick = false;
        }
        catch (Exception ex)
        {
            // Detection must never crash the app. A failure before the popup was handled re-arms
            // so the next tick retries instead of silently losing this meeting.
            if (disarmedThisTick)
                _armed = true;

            Log($"tick failed: {ex.GetType().Name}");
        }
        finally
        {
            Interlocked.Exchange(ref _ticking, 0);
        }
    }

    private static void Log(string message) =>
        System.Diagnostics.Debug.WriteLine($"[MeetingCallWatcher] {message}");

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
