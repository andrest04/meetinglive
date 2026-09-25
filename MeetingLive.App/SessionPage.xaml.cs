using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>
/// Opened meeting: SelectorBar tabs (Transcript / Summary) hosted in an inner
/// <c>SessionFrame</c>. Shell navigation stays on Library while this page is showing.
/// </summary>
public sealed partial class SessionPage : Page
{
    private bool _isApplyingTab;
    private int _previousSelectedIndex;

    public SessionPageViewModel ViewModel { get; } = new();

    public SessionPage()
    {
        InitializeComponent();
        AppServices.Workspace.SessionTabRequested += OnSessionTabRequested;
        Unloaded += (_, _) => AppServices.Workspace.SessionTabRequested -= OnSessionTabRequested;
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.EnsureXaiProviderAsync = () => XaiProviderResolver.EnsureAvailableAsync(XamlRoot);
        };
    }

    private void OnSessionTabRequested(object? sender, string tab)
    {
        SelectTab(tab);
        NavigateInner(tab, AppServices.Workspace.SelectedMeetingId);
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid? ?? AppServices.Workspace.SelectedMeetingId;
        await ViewModel.LoadAsync(meetingId);

        if (!ViewModel.HasMeeting)
        {
            SessionFrame.Content = null;
            return;
        }

        SelectTab(AppServices.Workspace.SessionTab);
        NavigateInner(AppServices.Workspace.SessionTab, meetingId);
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.History);
    }

    private async void Rename_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.HasMeeting)
            return;

        var nameBox = CreateNameBox(ViewModel.Title);
        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("SessionRename_Title"),
            nameBox,
            AppStrings.Get("SessionRename_Primary"),
            AppStrings.Get("SessionRename_Cancel"),
            ContentDialogButton.Primary);
        RejectEmptyName(dialog, nameBox);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        if (await ViewModel.RenameAsync(nameBox.Text))
            NavigateInner(AppServices.Workspace.SessionTab, AppServices.Workspace.SelectedMeetingId);
    }

    private async void SuggestTitle_Click(object sender, RoutedEventArgs e)
    {
        var (applied, error) = await ViewModel.SuggestTitleAsync();
        if (error is not null)
        {
            var dialog = AppDialogFactory.CreateError(
                XamlRoot,
                AppStrings.Get("SessionSuggestTitle_ErrorTitle"),
                error,
                AppStrings.Get("Dialog_OK"));
            await dialog.ShowAsync();
            return;
        }

        if (applied)
            NavigateInner(AppServices.Workspace.SessionTab, AppServices.Workspace.SelectedMeetingId);
    }

    private void EmptyCta_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.Recording);
    }

    private void SessionTabs_SelectionChanged(SelectorBar sender, SelectorBarSelectionChangedEventArgs args)
    {
        if (_isApplyingTab)
            return;

        var tab = TabFromItem(sender.SelectedItem);
        AppServices.Workspace.SetSessionTab(tab);
        NavigateInner(tab, AppServices.Workspace.SelectedMeetingId);
    }

    private void SelectTab(string tab)
    {
        var item = ItemFromTab(tab);
        _isApplyingTab = true;
        try
        {
            SessionTabs.SelectedItem = item;
        }
        finally
        {
            _isApplyingTab = false;
        }
    }

    private void NavigateInner(string tab, Guid? meetingId)
    {
        if (meetingId is null)
            return;

        var pageType = tab switch
        {
            WorkspaceService.TabSummary => typeof(SummaryPage),
            _ => typeof(TranscriptPage),
        };

        var currentSelectedIndex = SessionTabs.SelectedItem is SelectorBarItem selected
            ? SessionTabs.Items.IndexOf(selected)
            : 0;
        var effect = currentSelectedIndex - _previousSelectedIndex > 0
            ? SlideNavigationTransitionEffect.FromRight
            : SlideNavigationTransitionEffect.FromLeft;

        SessionFrame.Navigate(pageType, meetingId, new SlideNavigationTransitionInfo { Effect = effect });
        _previousSelectedIndex = currentSelectedIndex;
    }

    private SelectorBarItem ItemFromTab(string tab) => tab switch
    {
        WorkspaceService.TabSummary => TabSummaryItem,
        _ => TabTranscriptItem,
    };

    private static string TabFromItem(SelectorBarItem? item) => (item?.Tag as string) switch
    {
        WorkspaceService.TabSummary => WorkspaceService.TabSummary,
        _ => WorkspaceService.TabTranscript,
    };

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    private static TextBox CreateNameBox(string text) => new()
    {
        Header = AppStrings.Get("SessionRename_Name.Header"),
        PlaceholderText = AppStrings.Get("SessionRename_Name.PlaceholderText"),
        Text = text,
    };

    private static void RejectEmptyName(ContentDialog dialog, TextBox nameBox)
    {
        dialog.Closing += (_, args) =>
        {
            if (args.Result == ContentDialogResult.Primary && string.IsNullOrWhiteSpace(nameBox.Text))
                args.Cancel = true;
        };
    }
}
