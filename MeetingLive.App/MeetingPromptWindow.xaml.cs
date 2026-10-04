using System.Runtime.InteropServices;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace MeetingLive_App;

/// <summary>
/// Floating, always-on-top "meeting detected" popup with a Start recording split button. It is shown
/// without activation so it never steals focus from the call the user is in, and hides itself after
/// <see cref="AutoHideSeconds"/> seconds, when dismissed, or when recording starts.
/// </summary>
public sealed partial class MeetingPromptWindow : Window
{
    private const int AutoHideSeconds = 30;
    private const int WidthDip = 420;
    private const int HeightDip = 80;
    private const int EdgeMarginDip = 24;

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hWnd);

    private const int DwmWindowCornerPreference = 33;
    private const int DwmCornerRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint hWnd, int attribute, ref int value, int size);

    private readonly DispatcherQueueTimer _autoHideTimer;

    public MeetingPromptWindow()
    {
        InitializeComponent();

        Title = AppStrings.Get("MeetingPrompt_Title.Text");

        // Borderless, always on top, fixed size: the window is a card, not a document.
        if (AppWindow.Presenter is not OverlappedPresenter presenter)
        {
            AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
            presenter = (OverlappedPresenter)AppWindow.Presenter;
        }

        presenter.IsAlwaysOnTop = true;
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.SetBorderAndTitleBar(hasBorder: false, hasTitleBar: false);

        // Keep it out of the taskbar and Alt+Tab so it never competes with the real meeting window.
        AppWindow.IsShownInSwitchers = false;

        // A borderless window is square by default; ask DWM for the Windows 11 rounded corners.
        // Best effort: older Windows ignores the attribute and keeps square corners.
        var round = DwmCornerRound;
        _ = DwmSetWindowAttribute(
            WinRT.Interop.WindowNative.GetWindowHandle(this), DwmWindowCornerPreference, ref round, sizeof(int));

        _autoHideTimer = DispatcherQueue.CreateTimer();
        _autoHideTimer.Interval = TimeSpan.FromSeconds(AutoHideSeconds);
        _autoHideTimer.IsRepeating = false;
        _autoHideTimer.Tick += (_, _) => Dismiss();

        Closed += OnClosed;
    }

    /// <summary>Shows the popup at the top-right of the work area without activating it.</summary>
    public void Present()
    {
        var scale = GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(this)) / 96.0;
        var width = (int)Math.Ceiling(WidthDip * scale);
        var height = (int)Math.Ceiling(HeightDip * scale);

        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var target = MeetingPromptPlacement.TopRight(
            width, height, area.X, area.Y, area.Width, area.Height, (int)(EdgeMarginDip * scale));
        AppWindow.MoveAndResize(new RectInt32(target.X, target.Y, width, height));

        AppWindow.Show(activateWindow: false);
        _autoHideTimer.Stop();
        _autoHideTimer.Start();
    }

    /// <summary>Hides the popup. It stays alive so the next meeting can reuse it.</summary>
    public void Dismiss()
    {
        _autoHideTimer.Stop();
        if (AppWindow.IsVisible)
            AppWindow.Hide();
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _autoHideTimer.Stop();
        Closed -= OnClosed;
    }

    private void Start_Click(object sender, RoutedEventArgs e)
    {
        Dismiss();

        if (App.Window.AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } main)
            main.Restore();

        App.Window.Activate();
        AppServices.Workspace.RequestTakeNotes();
    }

    private void Dismiss_Click(object sender, RoutedEventArgs e) => Dismiss();

    private async void NeverAgain_Click(object sender, RoutedEventArgs e)
    {
        Dismiss();
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            if (!settings.MeetingPopupEnabled)
                return;

            settings.MeetingPopupEnabled = false;
            await AppServices.Settings.SaveAsync(settings);
        }
        catch (Exception)
        {
            // Opting out is a convenience: a settings failure must never surface from the popup.
        }
    }
}
