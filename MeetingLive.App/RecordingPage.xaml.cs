using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.Dialogs;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Primary screen: record/stop, then background transcription + summary.</summary>
public sealed partial class RecordingPage : Page
{
    public RecordingPageViewModel ViewModel { get; } = new();

    public RecordingPage()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.EnsureSummaryEngineAsync = () => SummaryModelSetupDialog.ShowAsync(XamlRoot);
        };
    }

    private void ViewTranscript_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.LastMeeting is { } meeting)
            Frame.Navigate(typeof(TranscriptPage), meeting.Id);
    }

    private void ViewSummary_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.LastMeeting is { } meeting)
            Frame.Navigate(typeof(SummaryPage), meeting.Id);
    }

    public static bool Not(bool value) => !value;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static string RecordGlyph(bool isRecording) => isRecording ? "" : "";

    public static string RecordLabel(bool isRecording) => isRecording ? "Stop" : "Record";

    public static InfoBarSeverity StatusSeverity(string statusText) =>
        statusText.StartsWith("Error", StringComparison.OrdinalIgnoreCase) ? InfoBarSeverity.Error : InfoBarSeverity.Informational;
}
