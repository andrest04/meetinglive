using System.Diagnostics;
using System.Runtime.InteropServices;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Graphics;
using Windows.UI.ViewManagement;

namespace MeetingLive_App;

/// <summary>
/// Floating, always-on-top live copilot: a rounded capsule (app icon, audio bars, elapsed time, pause, stop
/// and chat) docked to a screen edge. It is vertical on the left/right edges and horizontal on top/bottom,
/// can only be dragged along the edges (a drop snaps to the nearest one), and its chat button opens a mini
/// panel that grows from the capsule toward the screen center. It is shown without activation so it never
/// steals focus from the app the user is in.
/// </summary>
public sealed partial class LiveCopilotWindow : Window
{
    private const int CapsuleShortDip = 64;
    private const int CapsuleVerticalLongDip = 240;
    private const int CapsuleHorizontalLongDip = 272;
    private const int EdgeMarginDip = 16;
    private const int PanelWidthDip = 380;
    private const int PanelHeightDip = 500;
    private const int PanelGapDip = 8;
    private const int ExpandedCornerDip = 28;
    private const double DragThresholdDip = 4;
    private const double PanelSlideDip = 16;
    private const double PulseScale = 1.08;

    private static readonly TimeSpan SnapDuration = TimeSpan.FromMilliseconds(240);
    private static readonly TimeSpan EntranceDuration = TimeSpan.FromMilliseconds(300);
    private static readonly TimeSpan ExitDuration = TimeSpan.FromMilliseconds(160);
    private static readonly Duration PanelInDuration = new(TimeSpan.FromMilliseconds(220));
    private static readonly Duration PulseDuration = new(TimeSpan.FromMilliseconds(180));

    private const int DwmWindowCornerPreference = 33;
    private const int DwmCornerDoNotRound = 1;
    private const int DwmCornerRound = 2;

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll")]
    private static extern int SetWindowRgn(nint hWnd, nint hRgn, [MarshalAs(UnmanagedType.Bool)] bool redraw);

    [DllImport("gdi32.dll")]
    private static extern nint CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(nint handle);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint hWnd, int attribute, ref int value, int size);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    /// <summary>One running window-rectangle animation, ticked by <see cref="_tweenTimer"/>.</summary>
    private sealed class Tween(
        RectInt32 from, RectInt32 to, TimeSpan duration, Func<double, double> ease,
        Action<double>? onProgress, Action? onDone)
    {
        public RectInt32 From { get; } = from;
        public RectInt32 To { get; } = to;
        public TimeSpan Duration { get; } = duration;
        public Func<double, double> Ease { get; } = ease;
        public Action<double>? OnProgress { get; } = onProgress;
        public Action? OnDone { get; } = onDone;
    }

    private readonly nint _hwnd;
    private readonly UISettings _uiSettings = new();
    private readonly DispatcherQueueTimer _savePositionTimer;
    private readonly DispatcherQueueTimer _startedHintTimer;
    private readonly DispatcherQueueTimer _tweenTimer;
    private readonly Stopwatch _tweenClock = new();

    private Tween? _tween;
    private Task? _restoreTask;
    private DockEdge _edge = LiveCopilotPillDock.DefaultEdge;
    private double _along = LiveCopilotPillDock.DefaultAlong;
    private bool _isExpanded;
    private bool _placed;
    private bool _wantVisible;
    private bool _verticalLayout = true;
    private bool _entering;
    private bool _exiting;
    private bool _redockQueued;
    private bool _startedHintPending;
    private ToolTip? _startedTip;
    private RectInt32 _expectedRect;
    private (int Width, int Height, int Radius) _region;

    // Drag state: a press starts a drag only after the pointer moves past DragThresholdDip.
    private bool _pressed;
    private bool _dragging;
    private NativePoint _pressCursor;
    private PointInt32 _dragOrigin;

    public RecordingPageViewModel ViewModel { get; } = AppServices.Recording;

    public LiveCopilotWindow()
    {
        InitializeComponent();

        Title = AppStrings.Get("LiveCopilot_Title");
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);

        // Borderless, always on top, fixed size: the window is a capsule, not a document. The visible
        // shape is cut with a window region (see ApplyShape), so DWM must not round the frame as well.
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
        SetDwmCorners(DwmCornerDoNotRound);

        // Keep it out of the taskbar and Alt+Tab so it never competes with the real meeting window.
        AppWindow.IsShownInSwitchers = false;

        // Ctrl+Enter must stay on these controls: a null owner would make the accelerator global.
        RootGrid.Loaded += (_, _) =>
        {
            LiveAskAccelerator.ScopeOwner = TxtLiveAsk;
            LiveAnswerAccelerator.ScopeOwner = BtnLiveAnswer;
        };

        _savePositionTimer = DispatcherQueue.CreateTimer();
        _savePositionTimer.Interval = TimeSpan.FromMilliseconds(500);
        _savePositionTimer.IsRepeating = false;
        _savePositionTimer.Tick += (_, _) => _ = SavePositionAsync();

        _startedHintTimer = DispatcherQueue.CreateTimer();
        _startedHintTimer.Interval = LiveCopilotRecordingHandoff.StartedHintDuration;
        _startedHintTimer.IsRepeating = false;
        _startedHintTimer.Tick += (_, _) => EndStartedHint();

        _tweenTimer = DispatcherQueue.CreateTimer();
        _tweenTimer.Interval = TimeSpan.FromMilliseconds(16);
        _tweenTimer.IsRepeating = true;
        _tweenTimer.Tick += (_, _) => TweenTick();

        AppWindow.Changed += OnAppWindowChanged;
        Closed += OnClosed;

        ApplyOrientation(vertical: true);
        SetChatName();
    }

    /// <summary>True while the mini panel is open.</summary>
    public bool IsExpanded => _isExpanded;

    private bool Animated => _uiSettings.AnimationsEnabled;

    private double Scale
    {
        get
        {
            var dpi = GetDpiForWindow(_hwnd);
            return dpi == 0 ? 1.0 : dpi / 96.0;
        }
    }

    /// <summary>
    /// Announces that recording started: the capsule content pulses once and a short tooltip with the
    /// localized started caption opens beside it for <see cref="LiveCopilotRecordingHandoff.StartedHintDuration"/>.
    /// Does not open the chat panel and does not activate the window. While the capsule is still sliding
    /// in, the hint waits for it to land so the tooltip anchors to its final position.
    /// </summary>
    public void ShowStartedHint()
    {
        _startedHintPending = true;
        if (AppWindow.IsVisible && !_entering && !_exiting)
            RunStartedHint();
    }

    /// <summary>
    /// Shows or hides the capsule. Showing never activates it, so keyboard focus stays in the app the
    /// user is working in. <paramref name="collapse"/> also folds the chat panel back into the capsule.
    /// Hiding cancels a started hint so it cannot appear after the capsule is gone.
    /// </summary>
    public async Task SetVisibleAsync(bool visible, bool collapse = false)
    {
        _wantVisible = visible;
        if (!visible)
            CancelStartedHint();

        if (visible)
        {
            _restoreTask ??= RestoreDockAsync();
            await _restoreTask;

            // The state may have flipped while the saved dock was loading.
            if (!_wantVisible)
                return;

            if (AppWindow.IsVisible && !_exiting)
                return;

            // Cancels a fade-out in flight and starts again from the docked rectangle.
            StopTween();
            _exiting = false;
            _entering = false;
            RootGrid.Opacity = 1;
            CapsuleHost.Opacity = 1;
            Dock();
            AudioBars.IsRunning = true;
            PlayEntrance();
            return;
        }

        if (collapse && _isExpanded)
            SetExpanded(false, animate: false);

        if (!AppWindow.IsVisible || _exiting)
        {
            AudioBars.IsRunning = false;
            return;
        }

        _savePositionTimer.Stop();
        await SavePositionAsync();

        // A show request may have arrived while the dock was saved.
        if (_wantVisible)
            return;

        PlayExit();
    }

    private async Task RestoreDockAsync()
    {
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            _edge = settings.ResolveLiveCopilotPillEdge();
            _along = settings.ResolveLiveCopilotPillAlong();
        }
        catch (Exception)
        {
            // Best effort: the default dock (middle of the right edge) is already in place.
        }
    }

    private async Task SavePositionAsync()
    {
        try
        {
            var edge = _edge.ToString();
            var settings = await AppServices.Settings.LoadAsync();
            if (settings.LiveCopilotPillEdge == edge
                && settings.LiveCopilotPillAlong is { } saved
                && Math.Abs(saved - _along) < 0.0005)
            {
                return;
            }

            settings.LiveCopilotPillEdge = edge;
            settings.LiveCopilotPillAlong = _along;
            await AppServices.Settings.SaveAsync(settings);
        }
        catch (Exception)
        {
            // The dock is a convenience: never surface a settings failure from the capsule.
        }
    }

    private void ScheduleSave()
    {
        _savePositionTimer.Stop();
        _savePositionTimer.Start();
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _savePositionTimer.Stop();
        _startedHintTimer.Stop();
        _tweenTimer.Stop();
        _tween = null;
        CloseStartedTip();
        AudioBars.IsRunning = false;
        AppWindow.Changed -= OnAppWindowChanged;
        Closed -= OnClosed;
    }

    // ---- Docking ------------------------------------------------------------------------------

    private static (int Width, int Height) CapsuleSizePx(bool vertical, double scale)
    {
        var shortSide = (int)Math.Round(CapsuleShortDip * scale);
        var longSide = (int)Math.Round((vertical ? CapsuleVerticalLongDip : CapsuleHorizontalLongDip) * scale);
        return vertical ? (shortSide, longSide) : (longSide, shortSide);
    }

    /// <summary>Work area to dock on: the primary display the first time, afterwards the one the capsule is on.</summary>
    private RectInt32 CurrentWorkArea()
    {
        if (!_placed)
            return DisplayArea.Primary.WorkArea;

        var position = AppWindow.Position;
        var size = AppWindow.Size;
        return DisplayArea.GetFromRect(
            new RectInt32(position.X, position.Y, size.Width, size.Height), DisplayAreaFallback.Nearest).WorkArea;
    }

    private (RectInt32 Capsule, RectInt32 Window) ComputeDock(
        DockEdge edge, double along, bool expanded, RectInt32 area, double scale)
    {
        var (width, height) = CapsuleSizePx(LiveCopilotPillDock.IsVertical(edge), scale);
        var margin = (int)Math.Round(EdgeMarginDip * scale);
        var position = LiveCopilotPillDock.PositionFor(
            edge, along, width, height, area.X, area.Y, area.Width, area.Height, margin);
        var capsule = new RectInt32(position.X, position.Y, width, height);
        if (!expanded)
            return (capsule, capsule);

        var bounds = LiveCopilotPillDock.ExpandedBounds(
            edge, capsule.X, capsule.Y, capsule.Width, capsule.Height,
            (int)Math.Round(PanelWidthDip * scale), (int)Math.Round(PanelHeightDip * scale),
            (int)Math.Round(PanelGapDip * scale),
            area.X, area.Y, area.Width, area.Height);
        return (capsule, new RectInt32(bounds.X, bounds.Y, bounds.Width, bounds.Height));
    }

    /// <summary>
    /// Snaps the window to the saved dock on the current monitor right now (no animation). DPI and work
    /// area are read fresh, so this is also the recovery path after a monitor or DPI change.
    /// </summary>
    private void Dock()
    {
        var area = CurrentWorkArea();
        if (!_placed)
        {
            // Move first so GetDpiForWindow reports the DPI of the monitor we are about to dock on.
            AppWindow.Move(new PointInt32(area.X, area.Y));
            _placed = true;
        }

        var scale = Scale;
        ApplyOrientation(LiveCopilotPillDock.IsVertical(_edge));
        var (capsule, window) = ComputeDock(_edge, _along, _isExpanded, area, scale);
        SetBounds(window, capsule, _isExpanded, scale);
    }

    /// <summary>Applies a window rectangle plus the inner layout (capsule and panel offsets) and shape.</summary>
    private void SetBounds(RectInt32 window, RectInt32 capsule, bool expanded, double scale)
    {
        AppWindow.MoveAndResize(window);

        CapsuleHost.Margin = new Thickness((capsule.X - window.X) / scale, (capsule.Y - window.Y) / scale, 0, 0);

        if (expanded)
        {
            var gap = PanelGapDip * scale;
            double x = 0, y = 0, width, height;
            if (LiveCopilotPillDock.IsVertical(_edge))
            {
                x = _edge == DockEdge.Left ? capsule.Width + gap : 0;
                width = window.Width - capsule.Width - gap;
                height = window.Height;
            }
            else
            {
                y = _edge == DockEdge.Top ? capsule.Height + gap : 0;
                width = window.Width;
                height = window.Height - capsule.Height - gap;
            }

            PanelGrid.Margin = new Thickness(x / scale, y / scale, 0, 0);
            PanelGrid.Width = Math.Max(0, width / scale);
            PanelGrid.Height = Math.Max(0, height / scale);
        }

        // The system may not honor the requested size (minimum window size); trust what we got.
        var actualPosition = AppWindow.Position;
        var actualSize = AppWindow.Size;
        _expectedRect = new RectInt32(actualPosition.X, actualPosition.Y, actualSize.Width, actualSize.Height);
        ApplyShape(actualSize.Width, actualSize.Height, expanded, scale);
    }

    private void ApplyOrientation(bool vertical)
    {
        _verticalLayout = vertical;
        CapsuleStack.Orientation = vertical ? Orientation.Vertical : Orientation.Horizontal;
        CapsuleHost.Width = vertical ? CapsuleShortDip : CapsuleHorizontalLongDip;
        CapsuleHost.Height = vertical ? CapsuleVerticalLongDip : CapsuleShortDip;
    }

    /// <summary>
    /// Cuts the window to its silhouette with a rounded-rectangle window region (a full capsule while
    /// collapsed, a rounded card while the panel is open) and matches the XAML outline to it. Window
    /// regions are not anti-aliased, so the outline border draws the soft edge inside the cut.
    /// </summary>
    private void ApplyShape(int widthPx, int heightPx, bool expanded, double scale)
    {
        var radiusDip = expanded ? ExpandedCornerDip : Math.Min(widthPx, heightPx) / scale / 2;
        WindowOutline.CornerRadius = new CornerRadius(radiusDip);

        var radiusPx = (int)Math.Round(radiusDip * scale);
        if (_region == (widthPx, heightPx, radiusPx))
            return;

        // The right/bottom edges of a region are exclusive, hence the +1.
        var region = CreateRoundRectRgn(0, 0, widthPx + 1, heightPx + 1, radiusPx * 2, radiusPx * 2);
        if (region == 0)
        {
            SetDwmCorners(DwmCornerRound);
            return;
        }

        // On success the system owns the region; on failure it is ours to free.
        if (SetWindowRgn(_hwnd, region, true) == 0)
        {
            DeleteObject(region);
            SetDwmCorners(DwmCornerRound);
            return;
        }

        _region = (widthPx, heightPx, radiusPx);
    }

    private void SetDwmCorners(int preference)
    {
        // Best effort: older Windows ignores the attribute. Round corners are only the fallback when
        // the window region cannot be applied.
        var value = preference;
        _ = DwmSetWindowAttribute(_hwnd, DwmWindowCornerPreference, ref value, sizeof(int));
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if ((!args.DidPositionChange && !args.DidSizeChange)
            || !sender.IsVisible || _dragging || _pressed || _tween is not null || _redockQueued)
        {
            return;
        }

        if (IsAtExpectedRect(sender))
            return;

        // Moved or resized by the system (monitor removed, DPI change): dock again, never stay free-floating.
        _redockQueued = true;
        DispatcherQueue.TryEnqueue(() =>
        {
            _redockQueued = false;
            if (!_dragging && !_pressed && _tween is null && AppWindow.IsVisible && !IsAtExpectedRect(AppWindow))
                Dock();
        });
    }

    private bool IsAtExpectedRect(AppWindow window)
    {
        var position = window.Position;
        var size = window.Size;
        return Math.Abs(position.X - _expectedRect.X) <= 2
            && Math.Abs(position.Y - _expectedRect.Y) <= 2
            && Math.Abs(size.Width - _expectedRect.Width) <= 2
            && Math.Abs(size.Height - _expectedRect.Height) <= 2;
    }

    // ---- Window tween -------------------------------------------------------------------------

    private static double EaseOutCubic(double t) => 1 - Math.Pow(1 - t, 3);

    private static double EaseOutQuint(double t) => 1 - Math.Pow(1 - t, 5);

    private static double EaseInCubic(double t) => t * t * t;

    private static double EaseInOutCubic(double t) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2;

    private static int Lerp(int from, int to, double t) => (int)Math.Round(from + (to - from) * t);

    /// <summary>
    /// Animates the window rectangle (position and size) from <paramref name="from"/> to <paramref name="to"/>.
    /// <paramref name="onProgress"/> receives the eased progress. With animations turned off in Windows the
    /// end state is applied immediately. The caller finishes the layout in <paramref name="onDone"/>.
    /// </summary>
    private void StartTween(
        RectInt32 from, RectInt32 to, TimeSpan duration, Func<double, double> ease,
        Action<double>? onProgress, Action? onDone)
    {
        StopTween();

        if (!Animated)
        {
            AppWindow.MoveAndResize(to);
            onProgress?.Invoke(1);
            onDone?.Invoke();
            return;
        }

        _tween = new Tween(from, to, duration, ease, onProgress, onDone);
        _tweenClock.Restart();
        _tweenTimer.Start();
    }

    private void StopTween()
    {
        _tweenTimer.Stop();
        _tween = null;
    }

    private void TweenTick()
    {
        if (_tween is not { } tween)
        {
            _tweenTimer.Stop();
            return;
        }

        var t = Math.Clamp(_tweenClock.Elapsed / tween.Duration, 0, 1);
        var eased = tween.Ease(t);
        var rect = new RectInt32(
            Lerp(tween.From.X, tween.To.X, eased), Lerp(tween.From.Y, tween.To.Y, eased),
            Lerp(tween.From.Width, tween.To.Width, eased), Lerp(tween.From.Height, tween.To.Height, eased));

        var size = AppWindow.Size;
        if (size.Width != rect.Width || size.Height != rect.Height)
        {
            AppWindow.MoveAndResize(rect);
            ApplyShape(rect.Width, rect.Height, expanded: false, Scale);
        }
        else
        {
            AppWindow.Move(new PointInt32(rect.X, rect.Y));
        }

        tween.OnProgress?.Invoke(eased);

        if (t < 1)
            return;

        _tweenTimer.Stop();
        _tween = null;
        tween.OnDone?.Invoke();
    }

    // ---- Entrance, exit, pulse ----------------------------------------------------------------

    /// <summary>The docked rectangle pushed past its edge by its own thickness plus the margin.</summary>
    private RectInt32 OffscreenRect(RectInt32 docked)
    {
        var scale = Scale;
        var margin = (int)Math.Round(EdgeMarginDip * scale);
        return _edge switch
        {
            DockEdge.Right => new RectInt32(docked.X + docked.Width + margin, docked.Y, docked.Width, docked.Height),
            DockEdge.Left => new RectInt32(docked.X - docked.Width - margin, docked.Y, docked.Width, docked.Height),
            DockEdge.Top => new RectInt32(docked.X, docked.Y - docked.Height - margin, docked.Width, docked.Height),
            _ => new RectInt32(docked.X, docked.Y + docked.Height + margin, docked.Width, docked.Height)
        };
    }

    private RectInt32 DockedRect()
    {
        var position = AppWindow.Position;
        var size = AppWindow.Size;
        return new RectInt32(position.X, position.Y, size.Width, size.Height);
    }

    /// <summary>Slides in from the docked edge while fading in. Without animations it just appears.</summary>
    private void PlayEntrance()
    {
        var docked = DockedRect();
        if (!Animated)
        {
            AppWindow.Show(activateWindow: false);
            FinishEntrance();
            return;
        }

        _entering = true;
        RootGrid.Opacity = 0;
        AppWindow.MoveAndResize(OffscreenRect(docked));
        AppWindow.Show(activateWindow: false);
        StartTween(
            OffscreenRect(docked), docked, EntranceDuration, EaseOutQuint,
            eased => RootGrid.Opacity = eased,
            () =>
            {
                RootGrid.Opacity = 1;
                _expectedRect = docked;
                FinishEntrance();
            });
    }

    private void FinishEntrance()
    {
        _entering = false;
        if (_startedHintPending)
            RunStartedHint();
    }

    /// <summary>Reverse of the entrance. The capsule stays alive and is re-docked on the next show.</summary>
    private void PlayExit()
    {
        var docked = DockedRect();

        void Finish()
        {
            _exiting = false;
            if (_wantVisible)
                return;

            AppWindow.Hide();
            AudioBars.IsRunning = false;
            RootGrid.Opacity = 1;
            CapsuleHost.Opacity = 1;

            // Back to the docked rectangle while hidden, so the next show finds the right monitor
            // instead of the off-screen slide target.
            AppWindow.Move(new PointInt32(docked.X, docked.Y));
        }

        _entering = false;
        if (!Animated)
        {
            Finish();
            return;
        }

        _exiting = true;
        StartTween(
            docked, OffscreenRect(docked), ExitDuration, EaseInCubic,
            eased => RootGrid.Opacity = 1 - eased,
            Finish);
    }

    private void RunStartedHint()
    {
        _startedHintPending = false;
        PlayPulse();
        OpenStartedTip();
        _startedHintTimer.Stop();
        _startedHintTimer.Start();
    }

    /// <summary>A single breath of the capsule content so the user notices recording began.</summary>
    private void PlayPulse()
    {
        if (!Animated)
            return;

        try
        {
            var sine = new SineEase { EasingMode = EasingMode.EaseInOut };
            var storyboard = new Storyboard();
            foreach (var property in new[] { "ScaleX", "ScaleY" })
            {
                var animation = new DoubleAnimation
                {
                    From = 1, To = PulseScale, Duration = PulseDuration, AutoReverse = true, EasingFunction = sine
                };
                Storyboard.SetTarget(animation, CapsuleScale);
                Storyboard.SetTargetProperty(animation, property);
                storyboard.Children.Add(animation);
            }

            storyboard.Begin();
        }
        catch (Exception)
        {
            CapsuleScale.ScaleX = 1;
            CapsuleScale.ScaleY = 1;
        }
    }

    private void OpenStartedTip()
    {
        try
        {
            CloseStartedTip();
            var tip = new ToolTip
            {
                Content = AppStrings.Get("LiveCopilot_StartedMessage"),
                Placement = _edge switch
                {
                    DockEdge.Right => PlacementMode.Left,
                    DockEdge.Left => PlacementMode.Right,
                    DockEdge.Top => PlacementMode.Bottom,
                    _ => PlacementMode.Top
                }
            };
            ToolTipService.SetToolTip(IconTile, tip);
            tip.IsOpen = true;
            _startedTip = tip;
        }
        catch (Exception)
        {
            // The hint is decorative: a tooltip that cannot open must not affect recording.
        }
    }

    private void CloseStartedTip()
    {
        if (_startedTip is null)
            return;

        _startedTip.IsOpen = false;
        ToolTipService.SetToolTip(IconTile, null);
        _startedTip = null;
    }

    private void EndStartedHint() => CloseStartedTip();

    private void CancelStartedHint()
    {
        _startedHintTimer.Stop();
        _startedHintPending = false;
        CloseStartedTip();
    }

    // ---- Chat panel ---------------------------------------------------------------------------

    /// <summary>
    /// Opens or closes the chat panel. The capsule keeps its screen position; the window grows from it
    /// toward the screen center (see <see cref="LiveCopilotPillDock.ExpandedBounds"/>).
    /// </summary>
    private void SetExpanded(bool expanded, bool animate = true)
    {
        _isExpanded = expanded;
        PanelGrid.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        SetChatName();
        if (!AppWindow.IsVisible && !_placed)
            return;

        Dock();
        if (expanded && animate && Animated)
            PlayPanelIn();
    }

    /// <summary>The panel fades in while sliding a few DIPs in from the docked edge.</summary>
    private void PlayPanelIn()
    {
        var (fromX, fromY) = _edge switch
        {
            DockEdge.Right => (PanelSlideDip, 0.0),
            DockEdge.Left => (-PanelSlideDip, 0.0),
            DockEdge.Top => (0.0, -PanelSlideDip),
            _ => (0.0, PanelSlideDip)
        };

        try
        {
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            var storyboard = new Storyboard();
            void Add(DependencyObject target, string property, double from, double to)
            {
                var animation = new DoubleAnimation { From = from, To = to, Duration = PanelInDuration, EasingFunction = ease };
                Storyboard.SetTarget(animation, target);
                Storyboard.SetTargetProperty(animation, property);
                storyboard.Children.Add(animation);
            }

            Add(PanelGrid, "Opacity", 0, 1);
            Add(PanelTranslate, "X", fromX, 0);
            Add(PanelTranslate, "Y", fromY, 0);
            storyboard.Begin();
        }
        catch (Exception)
        {
            PanelGrid.Opacity = 1;
            PanelTranslate.X = 0;
            PanelTranslate.Y = 0;
        }
    }

    private void SetChatName()
    {
        var name = AppStrings.Get(_isExpanded
            ? "LiveCopilot_Collapse.AutomationProperties.Name"
            : "LiveCopilot_Expand.AutomationProperties.Name");
        AutomationProperties.SetName(BtnChat, name);
        ToolTipService.SetToolTip(BtnChat, name);
    }

    private void Chat_Click(object sender, RoutedEventArgs e) => SetExpanded(!_isExpanded);

    // ---- Drag along the edges -----------------------------------------------------------------

    private void Capsule_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (_tween is not null || !e.GetCurrentPoint(CapsuleHost).Properties.IsLeftButtonPressed)
            return;

        if (!GetCursorPos(out _pressCursor))
            return;

        _pressed = true;
        _dragging = false;
        CapsuleHost.CapturePointer(e.Pointer);
    }

    private void Capsule_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_pressed || !GetCursorPos(out var cursor))
            return;

        var dx = cursor.X - _pressCursor.X;
        var dy = cursor.Y - _pressCursor.Y;
        if (!_dragging)
        {
            if (Math.Sqrt((double)dx * dx + (double)dy * dy) < DragThresholdDip * Scale)
                return;

            BeginDrag();
        }

        AppWindow.Move(new PointInt32(_dragOrigin.X + dx, _dragOrigin.Y + dy));
    }

    private void Capsule_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_pressed)
            return;

        _pressed = false;
        CapsuleHost.ReleasePointerCapture(e.Pointer);
        EndDrag();
    }

    private void Capsule_PointerCaptureLost(object sender, PointerRoutedEventArgs e)
    {
        if (!_pressed)
            return;

        _pressed = false;
        EndDrag();
    }

    private void BeginDrag()
    {
        _dragging = true;
        CloseStartedTip();

        // Grabbing the capsule folds the chat panel into it; the capsule itself does not move, so the
        // window rectangle becomes the capsule rectangle under the cursor.
        if (_isExpanded)
            SetExpanded(false, animate: false);

        _dragOrigin = AppWindow.Position;
    }

    private void EndDrag()
    {
        if (!_dragging)
            return;

        _dragging = false;
        SnapToNearestEdge();
    }

    /// <summary>
    /// Docks the capsule to the edge nearest to where it was dropped, then tweens the window there. When the
    /// edge change flips the orientation (left/right to top/bottom) the capsule content crossfades through
    /// the flip while the window morphs to the new shape.
    /// </summary>
    private void SnapToNearestEdge()
    {
        // Work area and DPI are read after the drag: the drop may have crossed to another monitor.
        var scale = Scale;
        var current = DockedRect();
        var centerX = current.X + current.Width / 2;
        var centerY = current.Y + current.Height / 2;
        var area = DisplayArea.GetFromRect(current, DisplayAreaFallback.Nearest).WorkArea;

        var edge = LiveCopilotPillDock.NearestEdge(centerX, centerY, area.X, area.Y, area.Width, area.Height);
        var vertical = LiveCopilotPillDock.IsVertical(edge);
        var (width, height) = CapsuleSizePx(vertical, scale);
        var margin = (int)Math.Round(EdgeMarginDip * scale);
        var along = LiveCopilotPillDock.AlongFor(
            edge, centerX - width / 2, centerY - height / 2, width, height,
            area.X, area.Y, area.Width, area.Height, margin);

        _edge = edge;
        _along = along;
        var (target, _) = ComputeDock(edge, along, expanded: false, area, scale);

        var flips = vertical != _verticalLayout;
        var swapped = false;
        StartTween(
            current, target, SnapDuration, flips ? EaseInOutCubic : EaseOutCubic,
            eased =>
            {
                if (!flips)
                    return;

                if (!swapped && eased >= 0.5)
                {
                    swapped = true;
                    ApplyOrientation(vertical);
                }

                CapsuleHost.Opacity = Math.Abs(2 * eased - 1);
            },
            () =>
            {
                CapsuleHost.Opacity = 1;
                Dock();
                ScheduleSave();
            });
    }

    // ---- Existing panel behavior --------------------------------------------------------------

    private void OpenApp_Click(object sender, RoutedEventArgs e)
    {
        if (App.Window.AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } main)
            main.Restore();

        App.Window.Activate();
    }

    private void LiveAsk_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.SubmitTypedAskCommand.CanExecute(null))
            _ = ViewModel.SubmitTypedAskCommand.ExecuteAsync(null);
    }

    private void LiveAnswer_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.ConfirmLiveAnswerCommand.CanExecute(null))
            _ = ViewModel.ConfirmLiveAnswerCommand.ExecuteAsync(null);
    }

    private async void Markdown_LinkClicked(object? sender, CommunityToolkit.WinUI.UI.Controls.LinkClickedEventArgs e)
    {
        try
        {
            // Web answers can contain links: only plain http(s) is ever launched.
            if (Uri.TryCreate(e.Link, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
            {
                await Windows.System.Launcher.LaunchUriAsync(uri);
            }
        }
        catch (Exception)
        {
            // A link that fails to open is not worth interrupting the meeting.
        }
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility EmptyHintVisibility(bool hasAnswer, bool isAnswering, bool hasError) =>
        hasAnswer || isAnswering || hasError ? Visibility.Collapsed : Visibility.Visible;

    public static string StatusLabel(bool isPaused) =>
        AppStrings.Get(isPaused ? "LiveCopilot_StatusPaused" : "LiveCopilot_StatusRecording");

    public static string PauseName(bool isPaused) =>
        AppStrings.Get(isPaused
            ? "LiveCopilot_Resume.AutomationProperties.Name"
            : "LiveCopilot_Pause.AutomationProperties.Name");

    /// <summary>Resume (play) glyph while paused, pause glyph otherwise.</summary>
    public static string PauseGlyph(bool isPaused) => isPaused ? "" : "";

    public static string PanelTitle() => AppStrings.Get("LiveCopilot_Title");

    public static string AnswerTooltip() => AppStrings.Get("RecordPage_LiveAnswerTooltip");

    public static string WebTooltip(bool canUseWebSearch) =>
        AppStrings.Get(canUseWebSearch ? "LiveCopilot_WebTooltipOn" : "LiveCopilot_WebTooltipOff");

    public static string AskPlaceholder() => AppStrings.Get("RecordPage_LiveAsk.PlaceholderText");

    public static string AskName() => AppStrings.Get("RecordPage_LiveAsk.AutomationProperties.Name");

    public static string PromptMissed() => AppStrings.Get("LiveCopilot_PromptMissed");

    public static string PromptExplain() => AppStrings.Get("LiveCopilot_PromptExplain");
}
