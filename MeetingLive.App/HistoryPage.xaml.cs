using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Library browser: nested folders, Inbox, and meetings filed in the selected folder.</summary>
public sealed partial class HistoryPage : Page
{
    public HistoryPageViewModel ViewModel { get; } = new();

    public HistoryPage()
    {
        InitializeComponent();
        Unloaded += (_, _) => _ = ViewModel.PersistSelectedFolderNoteAsync();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _ = ViewModel.LoadAsync();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        _ = ViewModel.PersistSelectedFolderNoteAsync();
    }

    private async void FolderTree_ItemInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is FolderNode node)
            await ViewModel.SelectFolderAsync(node);
    }

    private async void BreadcrumbBar_ItemClicked(BreadcrumbBar sender, BreadcrumbBarItemClickedEventArgs args)
    {
        if (args.Item is LibraryBreadcrumbItem item)
        {
            await ViewModel.SelectFolderByIdAsync(item.FolderId);
            return;
        }

        if (args.Index >= 0 && args.Index < ViewModel.Breadcrumbs.Count)
            await ViewModel.SelectFolderByIdAsync(ViewModel.Breadcrumbs[args.Index].FolderId);
    }

    private void Meetings_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not MeetingRecord record)
            return;

        AppServices.Workspace.SelectMeeting(record.Id);
        AppServices.Workspace.OpenSession(WorkspaceService.TabTranscript);
    }

    private void ViewSummary_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid meetingId })
            return;

        AppServices.Workspace.SelectMeeting(meetingId);
        AppServices.Workspace.OpenSession(WorkspaceService.TabSummary);
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid meetingId })
            return;

        var title = ViewModel.Meetings.FirstOrDefault(m => m.Id == meetingId)?.Title ?? string.Empty;
        var dialog = CreateDialog(
            AppStrings.Get("HistoryDelete_Title"),
            AppStrings.Format("HistoryDelete_Content", title),
            AppStrings.Get("HistoryDelete_Primary"),
            AppStrings.Get("HistoryDelete_Cancel"),
            ContentDialogButton.Close);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        await ViewModel.DeleteAsync(meetingId);
    }

    private async void NewFolder_Click(object sender, RoutedEventArgs e)
    {
        var nameBox = CreateNameBox(string.Empty);
        var dialog = CreateDialog(
            AppStrings.Get("LibraryNewFolder_Title"),
            nameBox,
            AppStrings.Get("LibraryNewFolder_Primary"),
            AppStrings.Get("LibraryNewFolder_Cancel"),
            ContentDialogButton.Primary);
        RejectEmptyName(dialog, nameBox);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        await ViewModel.CreateFolderAsync(nameBox.Text);
    }

    private async void RenameFolder_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.IsRealFolderSelected)
            return;

        var nameBox = CreateNameBox(ViewModel.SelectedFolderName);
        var dialog = CreateDialog(
            AppStrings.Get("LibraryRenameFolder_Title"),
            nameBox,
            AppStrings.Get("LibraryRenameFolder_Primary"),
            AppStrings.Get("LibraryRenameFolder_Cancel"),
            ContentDialogButton.Primary);
        RejectEmptyName(dialog, nameBox);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        await ViewModel.RenameSelectedFolderAsync(nameBox.Text);
    }

    private async void DeleteFolder_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.IsRealFolderSelected)
            return;

        if (!ViewModel.CanDeleteSelectedFolder(out var reason))
        {
            ViewModel.ShowStatus(reason);
            return;
        }

        var dialog = CreateDialog(
            AppStrings.Get("LibraryDeleteFolder_Title"),
            AppStrings.Format("LibraryDeleteFolder_Content", ViewModel.SelectedFolderName),
            AppStrings.Get("LibraryDeleteFolder_Primary"),
            AppStrings.Get("LibraryDeleteFolder_Cancel"),
            ContentDialogButton.Close);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        await ViewModel.DeleteSelectedFolderAsync();
    }

    private async void Move_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid meetingId })
            return;

        var destinations = ViewModel.GetMoveDestinations();
        var currentFolderId = ViewModel.Meetings.FirstOrDefault(m => m.Id == meetingId)?.FolderId;
        var selectedIndex = 0;
        for (var i = 0; i < destinations.Count; i++)
        {
            if (destinations[i].FolderId == currentFolderId)
            {
                selectedIndex = i;
                break;
            }
        }

        var list = new ListView
        {
            ItemsSource = destinations,
            SelectionMode = ListViewSelectionMode.Single,
            MaxHeight = 320,
            SelectedIndex = selectedIndex,
        };

        var dialog = CreateDialog(
            AppStrings.Get("LibraryMove_Title"),
            list,
            AppStrings.Get("LibraryMove_Primary"),
            AppStrings.Get("LibraryMove_Cancel"),
            ContentDialogButton.Primary);

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        var folderId = list.SelectedItem is FolderDestination destination
            ? destination.FolderId
            : null;
        await ViewModel.MoveMeetingAsync(meetingId, folderId);
    }

    private void EmptyCta_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.Recording);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InvertBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static Visibility FolderAccentVisibility(Guid? folderId) =>
        folderId is null ? Visibility.Collapsed : Visibility.Visible;

    public static string FolderGlyph(Guid? folderId) => folderId is null ? "\uE716" : "\uE8B7";

    public static Brush FolderAccentBrush(string? colorKey, Guid? folderId)
    {
        var resource = folderId is null
            ? FolderAccent.BrushResourceName("neutral")
            : FolderAccent.BrushResourceName(FolderAccent.ResolveKey(colorKey, folderId.Value));

        if (Application.Current.Resources.TryGetValue(resource, out var value) && value is Brush brush)
            return brush;

        return (Brush)Application.Current.Resources["FolderAccentNeutralBrush"];
    }

    public static string FormattedDate(DateTimeOffset recordedAt) =>
        recordedAt.LocalDateTime.ToString("g", System.Globalization.CultureInfo.CurrentCulture);

    public static string Snippet(string? summary, string? transcript)
    {
        var snippet = MeetingSnippet.From(summary, transcript);
        return string.IsNullOrEmpty(snippet) ? AppStrings.Get("History_NoContent") : snippet;
    }

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
        Header = AppStrings.Get("LibraryFolderName.Header"),
        PlaceholderText = AppStrings.Get("LibraryFolderName.PlaceholderText"),
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
