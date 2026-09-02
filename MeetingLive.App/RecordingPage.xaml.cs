using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
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
            ViewModel.EnsureTranscriptionEngineAsync = () => TranscriptionEngineResolver.EnsureReadyAsync(XamlRoot);
        };
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        ViewModel.OnNavigatedTo();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        ViewModel.OnNavigatedFrom();
    }

    private void ViewTranscript_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.LastMeeting is not { } meeting)
            return;

        AppServices.Workspace.SelectMeeting(meeting.Id);
        AppServices.Workspace.OpenSession(WorkspaceService.TabTranscript);
    }

    private void ViewSummary_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.LastMeeting is not { } meeting)
            return;

        AppServices.Workspace.SelectMeeting(meeting.Id);
        AppServices.Workspace.OpenSession(WorkspaceService.TabSummary);
    }

    public static bool Not(bool value) => !value;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static string RecordGlyph(bool isRecording) => isRecording ? "" : "";

    public static string RecordLabel(bool isRecording) =>
        isRecording ? AppStrings.Get("Record_Stop") : AppStrings.Get("Record_Record");

    public static InfoBarSeverity StatusSeverity(string statusText) =>
        statusText.StartsWith(AppStrings.Get("ErrorPrefix"), StringComparison.OrdinalIgnoreCase)
            ? InfoBarSeverity.Error
            : InfoBarSeverity.Informational;
}
