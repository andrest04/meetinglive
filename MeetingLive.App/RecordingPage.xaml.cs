using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Navigation;
using Windows.UI.ViewManagement;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Primary screen: record/stop, then background transcription + summary.</summary>
public sealed partial class RecordingPage : Page
{
    private bool _stickToTranscriptEnd = true;

    public RecordingPageViewModel ViewModel { get; } = AppServices.Recording;

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
            ApplyLiveTranscript(follow: false);
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

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.LastMeeting is not { } meeting)
            return;

        AppServices.Workspace.SelectMeeting(meeting.Id);
        AppServices.Workspace.OpenSession(ViewModel.HasSummary
            ? WorkspaceService.TabSummary
            : WorkspaceService.TabTranscript);
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

    private void RecordMicrophoneComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: RecordingMicrophoneChoice choice })
            ViewModel.SelectRecordingMicrophone(choice);
    }

    private void RecordMicrophoneComboBox_DropDownOpened(object sender, object e) =>
        ViewModel.RefreshRecordingMicrophones();

    // A null SelectedItem is a collection rebuild or a binding reset, not the user clearing the choice.
    private void AudioSourceList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is GridView { SelectedItem: AudioSourceCard card })
            ViewModel.AudioSources.SelectCard(card);
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

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(ViewModel.IsRecording) or nameof(ViewModel.IsPaused))
            UpdateRecordingPulse();
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
            // Respect the Windows "Animation effects" setting: keep the pulse static at a mid opacity instead of animating.
            if (new UISettings().AnimationsEnabled)
            {
                RecordingPulseStoryboard.Begin();
            }
            else
            {
                RecordingPulseStoryboard.Stop();
                RecordingPulse.Opacity = 0.3;
            }
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
        BtnJumpToLatest.Visibility = _stickToTranscriptEnd ? Visibility.Collapsed : Visibility.Visible;
    }

    private void JumpToLatest_Click(object sender, RoutedEventArgs e)
    {
        _stickToTranscriptEnd = true;
        BtnJumpToLatest.Visibility = Visibility.Collapsed;
        LiveTranscriptScroll.ChangeView(null, LiveTranscriptScroll.ScrollableHeight, null, disableAnimation: true);
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

    public static Visibility AnyVisible(bool first, bool second, bool third) =>
        first || second || third ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InvertBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    // Disabled (not Hidden) during a session: only Disabled constrains the content to the viewport height.
    public static ScrollBarVisibility IdleScrollBarVisibility(bool isSessionActive) =>
        isSessionActive ? ScrollBarVisibility.Disabled : ScrollBarVisibility.Auto;

    public static string RecordGlyph(bool isRecording) => isRecording ? "" : "";

    public static string RecordLabel(bool isRecording) =>
        isRecording ? AppStrings.Get("Record_Stop") : AppStrings.Get("Record_Record");

    public static string PauseGlyph(bool isPaused) => isPaused ? "\uE768" : "\uE769";

    public static string PauseLabel(bool isPaused) =>
        isPaused ? AppStrings.Get("Record_Resume") : AppStrings.Get("Record_Pause");

    public static string DiscardLabel() => AppStrings.Get("Record_Discard");

    // The recording bar's Copy is icon-only, so its name and tooltip reuse the x:Uid text resource without applying its Content.
    public static string CopyLabel() => AppStrings.Get("RecordPage_Copy.Content");

    public static string JumpToLatestLabel() => AppStrings.Get("RecordPage_JumpToLatest");

    /// <summary>LIVE badge: audio is being captured, so it hides while paused.</summary>
    public static Visibility LiveVisibility(bool isRecording, bool isPaused) =>
        isRecording && !isPaused ? Visibility.Visible : Visibility.Collapsed;

    public static string HighlightLabel() => AppStrings.Get("Record_Highlight");

    public static string HighlightTooltip() => AppStrings.Get("RecordPage_HighlightTooltip");

    public static string ImportLabel() => AppStrings.Get("Record_Import");

    public static string LiveAskTooltip() => AppStrings.Get("RecordPage_LiveAskTooltip");

    // The live-ask row shows no visible headers, so these reuse the x:Uid resources (name, hint) without applying their Header.
    public static string LiveAskName() => AppStrings.Get("RecordPage_LiveAsk.AutomationProperties.Name");

    public static string LiveAskPlaceholder() => AppStrings.Get("RecordPage_LiveAsk.PlaceholderText");

    public static string WebToggleTooltip(bool canUseWebSearch) =>
        AppStrings.Get(canUseWebSearch ? "LiveCopilot_WebTooltipOn" : "LiveCopilot_WebTooltipOff");

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

    /// <summary>RESULT state only: the promoted last-meeting card hides while a session is recording or processing.</summary>
    public static Visibility LastMeetingVisibility(bool hasLastMeeting, bool isSessionActive) =>
        hasLastMeeting && !isSessionActive ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>The idle column has its own error bar; this one covers recording and processing.</summary>
    public static Visibility SessionErrorVisibility(bool isStatusError, bool isSessionActive) =>
        isStatusError && isSessionActive ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility NonEmptyVisibility(string? text) =>
        string.IsNullOrWhiteSpace(text) ? Visibility.Collapsed : Visibility.Visible;

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
