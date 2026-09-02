using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
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

    private void ViewTranscript_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: Guid meetingId })
            Frame.Navigate(typeof(TranscriptPage), meetingId);
    }

    private void ViewSummary_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: Guid meetingId })
            Frame.Navigate(typeof(SummaryPage), meetingId);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static string FormattedDate(DateTimeOffset recordedAt) =>
        recordedAt.LocalDateTime.ToString("g", System.Globalization.CultureInfo.CurrentCulture);

    public static string Snippet(string? summary, string? transcript)
    {
        var text = !string.IsNullOrWhiteSpace(summary) ? summary : transcript;
        if (string.IsNullOrWhiteSpace(text))
            return AppStrings.Get("History_NoContent");

        var singleLine = text.ReplaceLineEndings(" ").Trim();
        return singleLine.Length > 140 ? singleLine[..140] + "…" : singleLine;
    }
}
