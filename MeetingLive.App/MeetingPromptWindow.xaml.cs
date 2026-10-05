using System.Runtime.InteropServices;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Input;
using Windows.Graphics;
using Windows.UI.ViewManagement;

namespace MeetingLive_App;

/// <summary>
/// Floating, always-on-top "meeting detected" popup with a Start recording split button. It is shown
/// without activation so it never steals focus from the call the user is in, and hides itself after
/// <see cref="AutoHideSeconds"/> seconds, when dismissed, or when recording starts.
/// </summary>
public sealed partial class MeetingPromptWindow : Window
{
    private const int AutoHideSeconds = 30;
    private const int WidthDip = 480;
    private const int HeightDip = 72;
    private const int EdgeMarginDip = 24;
    private const double EntranceOffsetDip = 24;
    private static readonly Duration EntranceDuration = new(TimeSpan.FromMilliseconds(280));
    private static readonly Duration ExitDuration = new(TimeSpan.FromMilliseconds(150));

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hWnd);

    private const int DwmWindowCornerPreference = 33;
    private const int DwmCornerRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint hWnd, int attribute, ref int value, int size);

    private readonly DispatcherQueueTimer _autoHideTimer;
    private readonly UISettings _uiSettings = new();
    private Storyboard? _entrance;
    private Storyboard? _exit;
    private bool _dismissing;

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

        // Cancel any storyboard still holding Card values from a previous show/dismissal, then reset
        // to the visible resting state so a stale hold value can never keep the card at Opacity 0.
        _exit?.Stop();
        _entrance?.Stop();
        _dismissing = false;
        HoverOverlay.Opacity = 0;
        Card.Opacity = 1;
        CardTranslate.X = 0;

        AppWindow.Show(activateWindow: false);
        _autoHideTimer.Stop();
        _autoHideTimer.Start();

        if (!AnimationsEnabled)
            return;

        try
        {
            // The entrance storyboard starts from Opacity 0 itself; if it never runs the card stays visible.
            PlayEntrance();
        }
        catch (Exception)
        {
            _entrance?.Stop();
            Card.Opacity = 1;
            CardTranslate.X = 0;
        }
    }

    /// <summary>
    /// Hides the popup, fading it out first unless <paramref name="animate"/> is false or the user
    /// disabled animations. It stays alive so the next meeting can reuse it.
    /// </summary>
    public void Dismiss(bool animate = true)
    {
        _autoHideTimer.Stop();
        if (!AppWindow.IsVisible)
            return;

        if (!animate || !AnimationsEnabled)
        {
            _exit?.Stop();
            _entrance?.Stop();
            _dismissing = false;
            AppWindow.Hide();
            return;
        }

        if (_dismissing)
            return;

        _dismissing = true;
        _entrance?.Stop();
        PlayExit();
    }

    private bool AnimationsEnabled => _uiSettings.AnimationsEnabled;

    private void PlayEntrance()
    {
        _entrance?.Stop();

        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var fade = new DoubleAnimation { From = 0, To = 1, Duration = EntranceDuration, EasingFunction = ease };
        var slide = new DoubleAnimation
        {
            From = EntranceOffsetDip, To = 0, Duration = EntranceDuration, EasingFunction = ease
        };
        Storyboard.SetTarget(fade, Card);
        Storyboard.SetTargetProperty(fade, "Opacity");
        Storyboard.SetTarget(slide, CardTranslate);
        Storyboard.SetTargetProperty(slide, "X");

        _entrance = new Storyboard();
        _entrance.Children.Add(fade);
        _entrance.Children.Add(slide);
        _entrance.Begin();
    }

    private void PlayExit()
    {
        var fade = new DoubleAnimation
        {
            To = 0, Duration = ExitDuration, EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
        };
        Storyboard.SetTarget(fade, Card);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var exit = new Storyboard();
        exit.Children.Add(fade);
        exit.Completed += (_, _) =>
        {
            // Present() may have cancelled this fade-out; only hide when it still applies.
            if (!_dismissing || !ReferenceEquals(_exit, exit))
                return;

            _dismissing = false;
            AppWindow.Hide();
        };
        _exit = exit;
        exit.Begin();
    }

    private void Card_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        HoverOverlay.Opacity = 1;
        _autoHideTimer.Stop();
    }

    private void Card_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        HoverOverlay.Opacity = 0;
        if (AppWindow.IsVisible && !_dismissing)
        {
            _autoHideTimer.Stop();
            _autoHideTimer.Start();
        }
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _autoHideTimer.Stop();
        _entrance?.Stop();
        _exit?.Stop();
        Closed -= OnClosed;
    }

    private void Start_Click(object sender, RoutedEventArgs e)
    {
        Dismiss(animate: false);

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
