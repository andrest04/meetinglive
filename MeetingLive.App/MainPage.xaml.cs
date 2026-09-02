using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
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

        Loaded += (_, _) =>
        {
            if (NavView.SelectedItem is null)
                NavView.SelectedItem = NavView.MenuItems[0];
        };
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
