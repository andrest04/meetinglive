using System.Runtime.InteropServices;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Input;
using Windows.Foundation;
using Windows.Graphics;

namespace MeetingLive_App;

/// <summary>
/// Floating, always-on-top live copilot: a small pill (REC dot, timer, armed-question badge) that
/// expands into a mini panel, so the user can follow and ask while Zoom or a class is in front.
/// It is shown without activation so it never steals focus from the app the user is in.
/// </summary>
public sealed partial class LiveCopilotWindow : Window
{
    private const int CollapsedWidthDip = 240;
    private const int CollapsedHeightDip = 48;
    private const int ExpandedWidthDip = 380;
    private const int ExpandedHeightDip = 500;
    private const int EdgeMarginDip = 24;
    private const int StartedHintMaxWidthDip = 360;

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hWnd);

    private readonly DispatcherQueueTimer _savePositionTimer;
    private readonly DispatcherQueueTimer _startedHintTimer;
    private bool _isExpanded;
    private bool _positionRestored;
    private bool _wantVisible;
    private bool _showingStartedHint;
    private int _startedHintWidthDip = CollapsedWidthDip;

    public RecordingPageViewModel ViewModel { get; } = AppServices.Recording;

    public LiveCopilotWindow()
    {
        InitializeComponent();

        Title = AppStrings.Get("LiveCopilot_Title");

        // Border without a title bar, always on top, fixed size: the window is a pill, not a document.
        if (AppWindow.Presenter is not OverlappedPresenter presenter)
        {
            AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
            presenter = (OverlappedPresenter)AppWindow.Presenter;
        }

        presenter.IsAlwaysOnTop = true;
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.SetBorderAndTitleBar(hasBorder: true, hasTitleBar: false);

        // Keep it out of the taskbar and Alt+Tab so it never competes with the real meeting window.
        AppWindow.IsShownInSwitchers = false;

        // Only the grip is the drag region: clicks anywhere else in the header reach their controls.
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(DragGrip);

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

        AppWindow.Changed += OnAppWindowChanged;
        Closed += OnClosed;

        ApplyLayout(expanded: false);
        SetBodyName();
    }

    /// <summary>True while the mini panel is open.</summary>
    public bool IsExpanded => _isExpanded;

    /// <summary>
    /// Shows the localized started caption on the collapsed pill for
    /// <see cref="LiveCopilotRecordingHandoff.StartedHintDuration"/>. Widens only enough to avoid
    /// clipping, capped near 360 DIP. Does not open the mini panel and does not activate the window.
    /// </summary>
    public void ShowStartedHint()
    {
        var message = AppStrings.Get("LiveCopilot_StartedMessage");
        _showingStartedHint = true;
        TxtStartedHint.Text = message;
        TxtStartedHint.Visibility = Visibility.Visible;
        NormalStatus.Visibility = Visibility.Collapsed;
        SetBodyName();

        if (!_isExpanded)
        {
            _startedHintWidthDip = MeasureStartedHintWidthDip();
            ApplySize(expanded: false, _startedHintWidthDip, CollapsedHeightDip);
        }

        _startedHintTimer.Stop();
        _startedHintTimer.Start();
    }

    /// <summary>
    /// Shows or hides the pill. Showing never activates it, so keyboard focus stays in the app the
    /// user is working in. <paramref name="collapse"/> also folds the panel back into the pill.
    /// Hiding cancels a started hint so it cannot resize the pill after it is gone.
    /// </summary>
    public async Task SetVisibleAsync(bool visible, bool collapse = false)
    {
        _wantVisible = visible;
        if (!visible)
            CancelStartedHint();

        if (visible)
        {
            if (!_positionRestored)
                await RestorePositionAsync();

            // The state may have flipped while the saved position was loading.
            if (!_wantVisible)
                return;

            AppWindow.Show(activateWindow: false);
            return;
        }

        if (collapse && _isExpanded)
            ApplyLayout(expanded: false);

        if (AppWindow.IsVisible)
        {
            _savePositionTimer.Stop();
            await SavePositionAsync();
            AppWindow.Hide();
        }
    }

    private async Task RestorePositionAsync()
    {
        _positionRestored = true;
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            if (settings is { LiveCopilotPillX: { } x, LiveCopilotPillY: { } y })
                MoveClamped(x, y);
        }
        catch (Exception)
        {
            // Best effort: the default bottom-right placement is already applied.
        }
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (args.DidPositionChange && sender.IsVisible)
        {
            _savePositionTimer.Stop();
            _savePositionTimer.Start();
        }
    }

    private async Task SavePositionAsync()
    {
        try
        {
            var position = AppWindow.Position;
            var settings = await AppServices.Settings.LoadAsync();
            if (settings.LiveCopilotPillX == position.X && settings.LiveCopilotPillY == position.Y)
                return;

            settings.LiveCopilotPillX = position.X;
            settings.LiveCopilotPillY = position.Y;
            await AppServices.Settings.SaveAsync(settings);
        }
        catch (Exception)
        {
            // The position is a convenience: never surface a settings failure from the pill.
        }
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        _savePositionTimer.Stop();
        _startedHintTimer.Stop();
        AppWindow.Changed -= OnAppWindowChanged;
        Closed -= OnClosed;
    }

    /// <summary>
    /// Resizes to the collapsed or expanded size (DPI-scaled) and keeps the whole window inside the
    /// work area of the monitor it is on. With no saved position the pill sits at the bottom-right.
    /// A collapsed started hint keeps its measured width until the hint ends.
    /// </summary>
    private void ApplyLayout(bool expanded)
    {
        var widthDip = expanded
            ? ExpandedWidthDip
            : _showingStartedHint ? _startedHintWidthDip : CollapsedWidthDip;
        var heightDip = expanded ? ExpandedHeightDip : CollapsedHeightDip;
        ApplySize(expanded, widthDip, heightDip);
    }

    private void ApplySize(bool expanded, int widthDip, int heightDip)
    {
        _isExpanded = expanded;
        PanelGrid.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        BtnExpand.Visibility = expanded ? Visibility.Collapsed : Visibility.Visible;
        BtnCollapse.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        BtnOpenApp.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        SetBodyName();

        var scale = GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(this)) / 96.0;
        var width = (int)Math.Ceiling(widthDip * scale);
        var height = (int)Math.Ceiling(heightDip * scale);

        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Nearest).WorkArea;
        PillPosition target;
        if (_positionRestored || AppWindow.IsVisible)
        {
            var current = AppWindow.Position;
            target = LiveCopilotPillPlacement.Clamp(
                current.X, current.Y, width, height, area.X, area.Y, area.Width, area.Height);
        }
        else
        {
            target = LiveCopilotPillPlacement.DefaultBottomRight(
                width, height, area.X, area.Y, area.Width, area.Height, (int)(EdgeMarginDip * scale));
        }

        AppWindow.MoveAndResize(new RectInt32(target.X, target.Y, width, height));
    }

    private void MoveClamped(int x, int y)
    {
        var size = AppWindow.Size;
        var area = DisplayArea.GetFromRect(
            new RectInt32(x, y, size.Width, size.Height), DisplayAreaFallback.Nearest).WorkArea;
        var target = LiveCopilotPillPlacement.Clamp(
            x, y, size.Width, size.Height, area.X, area.Y, area.Width, area.Height);
        AppWindow.Move(new PointInt32(target.X, target.Y));
    }

    private void EndStartedHint()
    {
        if (!_showingStartedHint)
            return;

        var restoreCollapsedSize = !_isExpanded && _wantVisible;
        ClearStartedHint();
        if (restoreCollapsedSize)
            ApplySize(expanded: false, CollapsedWidthDip, CollapsedHeightDip);
    }

    private void CancelStartedHint()
    {
        _startedHintTimer.Stop();
        if (!_showingStartedHint)
            return;

        var restoreCollapsedSize = !_isExpanded;
        ClearStartedHint();
        if (restoreCollapsedSize)
            ApplySize(expanded: false, CollapsedWidthDip, CollapsedHeightDip);
    }

    private void ClearStartedHint()
    {
        _showingStartedHint = false;
        _startedHintTimer.Stop();
        TxtStartedHint.Visibility = Visibility.Collapsed;
        NormalStatus.Visibility = Visibility.Visible;
        SetBodyName();
    }

    /// <summary>
    /// Width of the collapsed pill while the started caption is visible. Measures the caption and
    /// keeps the result inside the work area via <see cref="LiveCopilotPillPlacement.Clamp"/> when applied.
    /// </summary>
    private int MeasureStartedHintWidthDip()
    {
        TxtStartedHint.Measure(new Size(double.PositiveInfinity, CollapsedHeightDip));
        var textWidth = TxtStartedHint.DesiredSize.Width;
        // Before the window is shown, measure can come back empty. Use the cap so the caption
        // cannot clip; a real measure still tightens the width below.
        if (!double.IsFinite(textWidth) || textWidth <= 0)
            return StartedHintMaxWidthDip;

        var bodyColumn = HeaderGrid.ColumnDefinitions[1];
        var previous = bodyColumn.Width;
        bodyColumn.Width = GridLength.Auto;
        double headerWidth;
        try
        {
            HeaderGrid.Measure(new Size(double.PositiveInfinity, CollapsedHeightDip));
            headerWidth = HeaderGrid.DesiredSize.Width;
        }
        finally
        {
            bodyColumn.Width = previous;
        }

        // Grip, spacing, body padding, expand button, and header padding. Used when the star column
        // measure does not grow with the caption.
        const double fallbackChromeDip = 32 + 4 + 24 + 4 + 48 + 8;
        var fallback = textWidth + fallbackChromeDip;
        var desired = double.IsFinite(headerWidth) && headerWidth > 0 ? Math.Max(headerWidth, fallback) : fallback;
        if (!double.IsFinite(desired) || desired <= 0)
            desired = StartedHintMaxWidthDip;

        var width = (int)Math.Ceiling(desired);
        if (width < CollapsedWidthDip)
            return CollapsedWidthDip;
        if (width > StartedHintMaxWidthDip)
            return StartedHintMaxWidthDip;
        return width;
    }

    private void SetBodyName() =>
        AutomationProperties.SetName(
            BtnBody,
            AppStrings.Get(_showingStartedHint
                ? "LiveCopilot_StartedMessage"
                : _isExpanded
                    ? "LiveCopilot_Collapse.AutomationProperties.Name"
                    : "LiveCopilot_Expand.AutomationProperties.Name"));

    private void Body_Click(object sender, RoutedEventArgs e) => ApplyLayout(!_isExpanded);

    private void Expand_Click(object sender, RoutedEventArgs e) => ApplyLayout(expanded: true);

    private void Collapse_Click(object sender, RoutedEventArgs e) => ApplyLayout(expanded: false);

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

    public static Visibility InvertBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static Visibility EmptyHintVisibility(bool hasAnswer, bool isAnswering, bool hasError) =>
        hasAnswer || isAnswering || hasError ? Visibility.Collapsed : Visibility.Visible;

    public static string StatusLabel(bool isPaused) =>
        AppStrings.Get(isPaused ? "LiveCopilot_StatusPaused" : "LiveCopilot_StatusRecording");

    public static string AnswerTooltip() => AppStrings.Get("RecordPage_LiveAnswerTooltip");

    public static string WebTooltip(bool canUseWebSearch) =>
        AppStrings.Get(canUseWebSearch ? "LiveCopilot_WebTooltipOn" : "LiveCopilot_WebTooltipOff");

    public static string AskPlaceholder() => AppStrings.Get("RecordPage_LiveAsk.PlaceholderText");

    public static string AskName() => AppStrings.Get("RecordPage_LiveAsk.AutomationProperties.Name");

    public static string PromptMissed() => AppStrings.Get("LiveCopilot_PromptMissed");

    public static string PromptExplain() => AppStrings.Get("LiveCopilot_PromptExplain");
}
