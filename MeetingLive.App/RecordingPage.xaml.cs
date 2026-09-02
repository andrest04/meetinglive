using System.ComponentModel;
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
    private bool _stickToTranscriptEnd = true;

    public RecordingPageViewModel ViewModel { get; } = new();

    public RecordingPage()
    {
        InitializeComponent();
        ViewModel.PropertyChanged += OnViewModelPropertyChanged;
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

    private async void DiscardRecording_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
            Title = AppStrings.Get("RecordDiscard_Title"),
            Content = AppStrings.Get("RecordDiscard_Content"),
            PrimaryButtonText = AppStrings.Get("RecordDiscard_Primary"),
            CloseButtonText = AppStrings.Get("RecordDiscard_Cancel"),
            DefaultButton = ContentDialogButton.Close,
        };

        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return;

        if (ViewModel.DiscardRecordingCommand.CanExecute(null))
            await ViewModel.DiscardRecordingCommand.ExecuteAsync(null);
    }

    private void DestinationComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: FolderDestination destination })
            ViewModel.SelectedDestination = destination;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(ViewModel.IsRecording) or nameof(ViewModel.IsPaused))
            UpdateRecordingPulse();
        else if (e.PropertyName is nameof(ViewModel.LiveTranscriptText)
                 or nameof(ViewModel.CanvasTranscriptText))
        {
            SyncTranscriptCanvasHeight();
            FollowLiveTranscriptIfNeeded();
        }
    }

    private void UpdateRecordingPulse()
    {
        if (ViewModel.IsRecording && !ViewModel.IsPaused)
        {
            RecordingPulseStoryboard.Begin();
        }
        else
        {
            RecordingPulseStoryboard.Stop();
            RecordingPulse.Opacity = 0;
        }
    }

    private void LiveTranscriptScroll_SizeChanged(object sender, SizeChangedEventArgs e) =>
        SyncTranscriptCanvasHeight();

    private void LiveTranscriptScroll_ViewChanged(object sender, ScrollViewerViewChangedEventArgs e)
    {
        var scroll = LiveTranscriptScroll;
        _stickToTranscriptEnd = scroll.ScrollableHeight <= 0 ||
            scroll.VerticalOffset >= scroll.ScrollableHeight - 32;
    }

    private void SyncTranscriptCanvasHeight()
    {
        var viewport = LiveTranscriptScroll.ViewportHeight;
        if (viewport > 0)
            LiveTranscriptHost.MinHeight = viewport;
    }

    private void FollowLiveTranscriptIfNeeded()
    {
        if (!_stickToTranscriptEnd)
            return;

        LiveTranscriptScroll.DispatcherQueue.TryEnqueue(() =>
        {
            if (!_stickToTranscriptEnd)
                return;

            SyncTranscriptCanvasHeight();
            LiveTranscriptScroll.UpdateLayout();
            LiveTranscriptScroll.ChangeView(null, LiveTranscriptScroll.ExtentHeight, null, disableAnimation: true);
        });
    }

    public static bool Not(bool value) => !value;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InvertBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static string RecordGlyph(bool isRecording) => isRecording ? "" : "";

    public static string RecordLabel(bool isRecording) =>
        isRecording ? AppStrings.Get("Record_Stop") : AppStrings.Get("Record_Record");

    public static string PauseGlyph(bool isPaused) => isPaused ? "\uE768" : "\uE769";

    public static string PauseLabel(bool isPaused) =>
        isPaused ? AppStrings.Get("Record_Resume") : AppStrings.Get("Record_Pause");

    public static string DiscardLabel() => AppStrings.Get("Record_Discard");

    public static InfoBarSeverity StatusSeverity(string statusText) =>
        statusText.StartsWith(AppStrings.Get("ErrorPrefix"), StringComparison.OrdinalIgnoreCase)
            ? InfoBarSeverity.Error
            : InfoBarSeverity.Informational;
}
