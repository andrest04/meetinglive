using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using MeetingLive.Core.Models;
using MeetingLive_App.Services;

namespace MeetingLive_App;

/// <summary>
/// App shell: a NavigationView hosting Record / Library / Settings in
/// <c>ContentFrame</c>. This page is the only navigator of that frame — child
/// pages request moves through <see cref="WorkspaceService"/>. An opened meeting
/// is <see cref="SessionPage"/>; the pane stays on Library while it is showing.
/// </summary>
public sealed partial class MainPage : Page
{
    private bool _isNavigating;
    private bool _paneDragging;
    private double _paneDragStartX;
    private double _paneDragStartLength;

    public MainPage()
    {
        InitializeComponent();

        // The built-in Settings item's Content is localized from the OS language,
        // which can show up as e.g. "Configuración" on a Spanish-language system.
        // The app is English-only, so force the label explicitly.
        if (NavView.SettingsItem is NavigationViewItem settingsItem)
        {
            settingsItem.Content = AppStrings.Get("Nav_Settings");
            AutomationProperties.SetAutomationId(settingsItem, "NavItemSettings");
        }

        AppServices.Workspace.NavigationRequested += OnWorkspaceNavigationRequested;
        AppServices.Workspace.CallPromptOffered += (_, _) => CallPromptBar.IsOpen = true;

        ToolTipService.SetToolTip(PaneGrip, AppStrings.Get("Nav_ResizePane"));
        AutomationProperties.SetName(PaneGrip, AppStrings.Get("Nav_ResizePane"));

        Loaded += async (_, _) =>
        {
            if (NavView.SelectedItem is null)
                NavView.SelectedItem = NavView.MenuItems[0];

            var settings = await AppServices.Settings.LoadAsync();
            NavView.OpenPaneLength = settings.ResolveNavigationPaneLength();
            PositionPaneGrip();
            UpdatePaneGripVisibility();
        };
    }

    public static string CallPromptTitle() => AppStrings.Get("CallPrompt_Title");

    public static string CallPromptBody() => AppStrings.Get("CallPrompt_Body");

    public static string CallPromptTakeNotes() => AppStrings.Get("CallPrompt_TakeNotes");

    private void CallPromptTakeNotes_Click(object sender, RoutedEventArgs e)
    {
        CallPromptBar.IsOpen = false;
        AppServices.Workspace.RequestTakeNotes();
    }

    private void NavView_DisplayModeChanged(NavigationView sender, NavigationViewDisplayModeChangedEventArgs args) =>
        UpdatePaneGripVisibility();

    private void NavView_PaneOpened(NavigationView sender, object args) => UpdatePaneGripVisibility();

    private void NavView_PaneClosed(NavigationView sender, object args) => UpdatePaneGripVisibility();

    private void PaneGrip_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        _paneDragging = true;
        _paneDragStartX = e.GetCurrentPoint(this).Position.X;
        _paneDragStartLength = NavView.OpenPaneLength;
        PaneGrip.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void PaneGrip_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_paneDragging)
            return;

        var delta = e.GetCurrentPoint(this).Position.X - _paneDragStartX;
        NavView.OpenPaneLength = Math.Clamp(
            _paneDragStartLength + delta,
            AppSettings.MinNavigationPaneLength,
            AppSettings.MaxNavigationPaneLength);
        PositionPaneGrip();
        e.Handled = true;
    }

    private async void PaneGrip_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_paneDragging)
            return;

        _paneDragging = false;
        PaneGrip.ReleasePointerCapture(e.Pointer);
        PositionPaneGrip();
        e.Handled = true;

        var settings = await AppServices.Settings.LoadAsync();
        settings.NavigationPaneLength = NavView.OpenPaneLength;
        await AppServices.Settings.SaveAsync(settings);
    }

    private void PositionPaneGrip() =>
        PaneGrip.Margin = new Thickness(NavView.OpenPaneLength - 4, 0, 0, 0);

    private void UpdatePaneGripVisibility()
    {
        var show = NavView.DisplayMode == NavigationViewDisplayMode.Expanded && NavView.IsPaneOpen;
        PaneGrip.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (show)
            PositionPaneGrip();
    }

    private void OnWorkspaceNavigationRequested(object? sender, string tag)
    {
        if (_isNavigating)
            return;

        _isNavigating = true;
        try
        {
            SyncPane(tag);
            NavigateContent(tag);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void NavView_ItemInvoked(NavigationView sender, NavigationViewItemInvokedEventArgs args)
    {
        if (_isNavigating || args.IsSettingsInvoked)
            return;

        if (args.InvokedItemContainer is not NavigationViewItem { Tag: string tag })
            return;

        // Pane stays on Library while a session is open; re-clicking Library must
        // still show the folder list even though the item is already selected.
        if (tag != WorkspaceService.History || ContentFrame.CurrentSourcePageType != typeof(SessionPage))
            return;

        _isNavigating = true;
        try
        {
            NavigateContent(WorkspaceService.History);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (_isNavigating)
            return;

        string? tag;
        if (args.IsSettingsSelected)
        {
            tag = WorkspaceService.Settings;
        }
        else if (args.SelectedItem is NavigationViewItem { Tag: string selectedTag })
        {
            tag = selectedTag;
        }
        else
        {
            return;
        }

        _isNavigating = true;
        try
        {
            NavigateContent(tag);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void SyncPane(string tag)
    {
        if (tag == WorkspaceService.Settings)
        {
            NavView.SelectedItem = NavView.SettingsItem;
            return;
        }

        var paneTag = tag == WorkspaceService.Session ? WorkspaceService.History : tag;

        foreach (var item in NavView.MenuItems)
        {
            if (item is NavigationViewItem { Tag: string itemTag } navItem && itemTag == paneTag)
            {
                NavView.SelectedItem = navItem;
                return;
            }
        }
    }

    private void NavigateContent(string tag)
    {
        var pageType = tag switch
        {
            WorkspaceService.Recording => typeof(RecordingPage),
            WorkspaceService.History => typeof(HistoryPage),
            WorkspaceService.Settings => typeof(SettingsPage),
            WorkspaceService.Session => typeof(SessionPage),
            _ => null,
        };

        if (pageType is null)
            return;

        var openSession = pageType == typeof(SessionPage);
        if (!openSession && ContentFrame.CurrentSourcePageType == pageType)
            return;

        object? parameter = openSession ? AppServices.Workspace.SelectedMeetingId : null;
        ContentFrame.Navigate(pageType, parameter);
    }
}
