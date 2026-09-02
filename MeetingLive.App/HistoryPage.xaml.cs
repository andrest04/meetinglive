using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Lists past meetings and navigates to their transcript/summary by id.</summary>
public sealed partial class HistoryPage : Page
{
    public HistoryPageViewModel ViewModel { get; } = new();

    public HistoryPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _ = ViewModel.LoadAsync();
    }

    private void Meetings_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not MeetingRecord record)
            return;

        AppServices.Workspace.SelectMeeting(record.Id);
        AppServices.Workspace.NavigateTo(WorkspaceService.Transcript);
    }

    private void ViewSummary_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid meetingId })
            return;

        AppServices.Workspace.SelectMeeting(meetingId);
        AppServices.Workspace.NavigateTo(WorkspaceService.Summary);
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid meetingId })
            return;

        var title = ViewModel.Meetings.FirstOrDefault(m => m.Id == meetingId)?.Title ?? string.Empty;
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
            Title = AppStrings.Get("HistoryDelete_Title"),
            Content = AppStrings.Format("HistoryDelete_Content", title),
            PrimaryButtonText = AppStrings.Get("HistoryDelete_Primary"),
            CloseButtonText = AppStrings.Get("HistoryDelete_Cancel"),
            DefaultButton = ContentDialogButton.Close,
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
            return;

        await ViewModel.DeleteAsync(meetingId);
    }

    private void EmptyCta_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.Recording);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static string FormattedDate(DateTimeOffset recordedAt) =>
        recordedAt.LocalDateTime.ToString("g", System.Globalization.CultureInfo.CurrentCulture);

    public static string Snippet(string? summary, string? transcript)
    {
        var snippet = MeetingSnippet.From(summary, transcript);
        return string.IsNullOrEmpty(snippet) ? AppStrings.Get("History_NoContent") : snippet;
    }
}
