using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Primary screen: record/stop, then background transcription + summary.</summary>
public sealed partial class RecordingPage : Page
{
    private bool _stickToTranscriptEnd = true;
    private bool _applyingLiveAnswerProvider;
    private bool _applyingNoteTemplate;

    public RecordingPageViewModel ViewModel { get; } = new();

    public RecordingPage()
    {
        InitializeComponent();
        ViewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.EnsureXaiProviderAsync = () => XaiProviderResolver.EnsureAvailableAsync(XamlRoot);
            ViewModel.EnsureRecordingReadyAsync = () => RecordingSetupResolver.EnsureReadyAsync(XamlRoot);
            // ScopeOwner keeps Ctrl+Enter on these controls. A null owner is global and would steal the shortcut from notes.
            LiveAskAccelerator.ScopeOwner = TxtLiveAsk;
            LiveAnswerAccelerator.ScopeOwner = BtnLiveAnswer;
            ApplyLiveAnswerProviderSelection();
            ApplyLiveTranscript(follow: false);
        };
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        ViewModel.OnNavigatedTo();
        await ViewModel.LoadNoteTemplatesAsync();
        ApplyNoteTemplateSelection();
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

    private async void DiscardRecording_Click(object sender, RoutedEventArgs e) =>
        await ConfirmAndDiscardRecordingAsync();

    private async Task ConfirmAndDiscardRecordingAsync()
    {
        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("RecordDiscard_Title"),
            AppStrings.Get("RecordDiscard_Content"),
            AppStrings.Get("RecordDiscard_Primary"),
            AppStrings.Get("RecordDiscard_Cancel"),
            ContentDialogButton.Close);

        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return;

        if (ViewModel.DiscardRecordingCommand.CanExecute(null))
            await ViewModel.DiscardRecordingCommand.ExecuteAsync(null);
    }

    private void ToggleRecording_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.ToggleRecordingCommand.CanExecute(null))
            _ = ViewModel.ToggleRecordingCommand.ExecuteAsync(null);
    }

    private void TogglePause_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.TogglePauseCommand.CanExecute(null))
            ViewModel.TogglePauseCommand.Execute(null);
    }

    private async void DiscardRecording_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        await ConfirmAndDiscardRecordingAsync();
    }

    private void DestinationComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: FolderDestination destination })
            ViewModel.SelectedDestination = destination;
    }

    private async void LiveAnswerProvider_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_applyingLiveAnswerProvider)
            return;
        if (sender is not ComboBox { SelectedItem: LiveAnswerProviderOption option })
            return;
        if (ViewModel.SelectedLiveAnswerProvider?.Kind == option.Kind)
            return;

        await ViewModel.SaveLiveAnswerProviderAsync(option.Kind);
    }

    private void LiveAsk_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.SubmitTypedAskCommand.CanExecute(null))
            _ = ViewModel.SubmitTypedAskCommand.ExecuteAsync(null);
    }

    private void LiveAnswer_AcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        if (ViewModel.ConfirmLiveAnswerCommand.CanExecute(null))
            _ = ViewModel.ConfirmLiveAnswerCommand.ExecuteAsync(null);
    }

    private void ApplyLiveAnswerProviderSelection()
    {
        _applyingLiveAnswerProvider = true;
        try
        {
            CmbLiveAnswerProvider.SelectedItem = ViewModel.SelectedLiveAnswerProvider;
        }
        finally
        {
            _applyingLiveAnswerProvider = false;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(ViewModel.IsRecording) or nameof(ViewModel.IsPaused))
            UpdateRecordingPulse();
        else if (e.PropertyName is nameof(ViewModel.SelectedLiveAnswerProvider))
            ApplyLiveAnswerProviderSelection();
        else if (e.PropertyName is nameof(ViewModel.LiveTranscriptText)
                 or nameof(ViewModel.CanvasTranscriptText))
        {
            ApplyLiveTranscript(follow: true);
        }
    }

    private void LiveTranscriptBlock_LostFocus(object sender, RoutedEventArgs e) =>
        ApplyLiveTranscript(follow: true);

    private void ApplyLiveTranscript(bool follow)
    {
        if (LiveTranscriptBlock.FocusState != FocusState.Unfocused)
            return;

        var next = ViewModel.CanvasTranscriptText;
        if (LiveTranscriptBlock.Text != next)
            LiveTranscriptBlock.Text = next;

        if (follow)
            FollowLiveTranscriptIfNeeded();
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

    private void LiveTranscriptScroll_ViewChanged(object sender, ScrollViewerViewChangedEventArgs e)
    {
        var scroll = LiveTranscriptScroll;
        _stickToTranscriptEnd = scroll.ScrollableHeight <= 0 ||
            scroll.VerticalOffset >= scroll.ScrollableHeight - 32;
    }

    private void FollowLiveTranscriptIfNeeded()
    {
        if (!_stickToTranscriptEnd)
            return;

        LiveTranscriptScroll.DispatcherQueue.TryEnqueue(() =>
        {
            if (!_stickToTranscriptEnd)
                return;

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

    public static string HighlightLabel() => AppStrings.Get("Record_Highlight");

    public static string HighlightTooltip() => AppStrings.Get("RecordPage_HighlightTooltip");

    public static string ImportLabel() => AppStrings.Get("Record_Import");

    public static string LiveAskTooltip() => AppStrings.Get("RecordPage_LiveAskTooltip");

    public static string LiveAnswerTooltip() => AppStrings.Get("RecordPage_LiveAnswerTooltip");

    public static InfoBarSeverity StatusSeverity(string statusText) =>
        statusText.StartsWith(AppStrings.Get("ErrorPrefix"), StringComparison.OrdinalIgnoreCase)
            ? InfoBarSeverity.Error
            : InfoBarSeverity.Informational;

    public static InfoBarSeverity ComingUpSeverity(bool isError) =>
        isError ? InfoBarSeverity.Error : InfoBarSeverity.Informational;

    public static string ComingUpWhen(DateTimeOffset start, TimeSpan duration)
    {
        var end = start + duration;
        var localStart = start.LocalDateTime;
        var localEnd = end.LocalDateTime;
        if (localStart.Date == DateTime.Now.Date)
            return AppStrings.Format("ComingUp_TimeRange", localStart, localEnd);

        return AppStrings.Format("ComingUp_TimeRangeOtherDay", localStart, localStart, localEnd);
    }

    public static string ComingUpEventAutomationId(string eventId) => "BtnComingUpEvent_" + eventId;

    public static Visibility NonEmptyVisibility(string? text) =>
        string.IsNullOrWhiteSpace(text) ? Visibility.Collapsed : Visibility.Visible;

    public static GridLength TranscriptRowHeight(bool showNotes) => new(1, GridUnitType.Star);

    public static GridLength NotesRowHeight(bool showNotes) =>
        showNotes ? new GridLength(2, GridUnitType.Star) : new GridLength(0);

    private void ApplyNoteTemplateSelection()
    {
        _applyingNoteTemplate = true;
        try
        {
            var id = string.IsNullOrWhiteSpace(ViewModel.SelectedNoteTemplateId)
                ? NoteTemplateCatalog.AutoId
                : ViewModel.SelectedNoteTemplateId;
            CmbNoteTemplate.SelectedItem = ViewModel.NoteTemplates.FirstOrDefault(item => item.Id == id)
                ?? ViewModel.NoteTemplates.FirstOrDefault();
        }
        finally
        {
            _applyingNoteTemplate = false;
        }
    }

    private void NoteTemplate_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_applyingNoteTemplate || sender is not ComboBox { SelectedItem: NoteTemplateOption option })
            return;

        ViewModel.SelectedNoteTemplateId = option.Id;
    }

    private async void SaveCustomTemplate_Click(object sender, RoutedEventArgs e)
    {
        var existing = await AppServices.NoteTemplates.LoadAsync();
        var edited = await CustomNoteTemplateDialog.ShowAsync(XamlRoot, existing);
        if (edited is null)
            return;

        await ViewModel.SaveCustomTemplateAsync(edited);
        ApplyNoteTemplateSelection();
    }

    private void Notes_LostFocus(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.SavePrepNotesAsync();
    }

    private async void ComingUpEvent_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { Tag: string eventId })
            return;

        var calendarEvent = ViewModel.FindComingUp(eventId);
        if (calendarEvent is null)
            return;

        if (ViewModel.OpenComingUpCommand.CanExecute(calendarEvent))
            await ViewModel.OpenComingUpCommand.ExecuteAsync(calendarEvent);
    }
}
