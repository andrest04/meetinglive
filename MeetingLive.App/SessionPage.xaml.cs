using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>
/// Opened meeting: SelectorBar tabs (Transcript / Summary / Notes) hosted in an inner
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
        var dialog = CreateDialog(
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
            WorkspaceService.TabNotes => typeof(NotesPage),
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
        WorkspaceService.TabNotes => TabNotesItem,
        _ => TabTranscriptItem,
    };

    private static string TabFromItem(SelectorBarItem? item) => (item?.Tag as string) switch
    {
        WorkspaceService.TabSummary => WorkspaceService.TabSummary,
        WorkspaceService.TabNotes => WorkspaceService.TabNotes,
        _ => WorkspaceService.TabTranscript,
    };

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    private ContentDialog CreateDialog(
        string title,
        object content,
        string primary,
        string close,
        ContentDialogButton defaultButton) => new()
    {
        XamlRoot = XamlRoot,
        Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
        Title = title,
        Content = content,
        PrimaryButtonText = primary,
        CloseButtonText = close,
        DefaultButton = defaultButton,
    };

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
