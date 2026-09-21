using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.Storage.Pickers;
using Windows.ApplicationModel.DataTransfer;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the record/stop flow: gates on Nemotron and a chosen summary engine BEFORE
/// capture starts. Then captures mic + system audio and streams live ASR when enabled.
/// After Stop, the live draft is saved immediately; Nemotron re-reads the WAV in the
/// background and replaces that transcript. Summary waits for the WAV pass.
/// </summary>
public partial class RecordingPageViewModel : ObservableObject, IRecordingPipelineCallbacks
{
    private readonly IAudioCaptureService _audioCapture = AppServices.AudioCapture;
    private readonly IAudioImportService _audioImport = AppServices.AudioImport;
    private readonly ITranscriptionService _transcription = AppServices.Transcription;
    private static readonly string[] ImportFileExtensions =
        [".wav", ".mp3", ".m4a", ".aac", ".flac", ".wma", ".3gp", ".mp4"];
    private readonly ILiveTranscriptionService _liveTranscription = AppServices.LiveTranscription;
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private readonly IFolderRepository _folders = AppServices.Folders;
    private readonly IMicrophoneLevelMeterService _levelMeter = AppServices.MicrophoneLevelMeter;
    private readonly RecordingPipelineOrchestrator _pipeline;
    private readonly Stopwatch _elapsed = new();

    private Guid _currentMeetingId;
    private DateTimeOffset _recordedAt;
    private DateTimeOffset _endedAt;
    private string? _currentAudioPath;
    private bool _liveSessionActive;
    private bool _isPageVisible;
    private int _previewGeneration;
    private DispatcherQueueTimer? _elapsedTimer;
    private DispatcherQueueTimer? _copyConfirmationTimer;
    private DispatcherQueueTimer? _highlightFeedbackTimer;
    private CancellationTokenSource? _processingCts;
    private TimeSpan _pausedDuration;
    private readonly Stopwatch _pauseClock = new();
    private string? _liveDraft;
    private readonly List<TimeSpan> _highlights = [];
    private string _previousCommittedTranscript = string.Empty;
    private string _committedTranscript = string.Empty;
    private readonly HashSet<string> _dismissedQuestionBodies = new(StringComparer.Ordinal);
    private CancellationTokenSource? _liveAnswerCts;
    private int _liveAnswerGeneration;

    [ObservableProperty]
    private bool _isRecording;

    [ObservableProperty]
    private bool _isPaused;

    [ObservableProperty]
    private bool _isProcessing;

    [ObservableProperty]
    private string _statusText = AppStrings.Get("Status_ReadyToRecord");

    [ObservableProperty]
    private string _meetingTitle = AppStrings.MeetingTitle(DateTime.Now);

    [ObservableProperty]
    private MeetingRecord? _lastMeeting;

    /// <summary>Live streaming transcript shown on the Record page. Preview only — the saved
    /// meeting text comes from Nemotron over the WAV.</summary>
    [ObservableProperty]
    private string _liveTranscriptText = string.Empty;

    [ObservableProperty]
    private bool _isCopyConfirmationOpen;

    [ObservableProperty]
    private string _sessionNotes = string.Empty;

    [ObservableProperty]
    private string _highlightFeedback = string.Empty;

    [ObservableProperty]
    private string _elapsedText = "00:00";

    [ObservableProperty]
    private double _micLevel;

    [ObservableProperty]
    private FolderDestination? _selectedDestination;

    public ObservableCollection<FolderDestination> Destinations { get; } = [];

    /// <summary>
    /// Supplied by the page (needs a XamlRoot for the setup dialog): resolves,
    /// and if needed walks the user through downloading, which local GGUF model
    /// to summarize with. Returns the model's file path, or null to skip
    /// summarization for this recording. Used only when the selected provider is Local.
    /// </summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    /// <summary>
    /// Supplied by the page (needs a XamlRoot for the setup dialog): confirms the Claude Code /
    /// Codex CLI is on PATH, walking the user through <c>CliToolSetupDialog</c> if not. Used only
    /// when the selected provider is <see cref="SummaryProviderKind.ClaudeCode"/> or
    /// <see cref="SummaryProviderKind.Codex"/>.
    /// </summary>
    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    /// <summary>
    /// Supplied by the page (needs a XamlRoot): confirms SuperGrok OAuth or an API key,
    /// walking the user through <c>XaiAuthDialog</c> if not. Used only when the selected
    /// provider is <see cref="SummaryProviderKind.Xai"/>.
    /// </summary>
    public Func<Task<bool>>? EnsureXaiProviderAsync { get; set; }

    /// <summary>
    /// Supplied by the page (needs a XamlRoot): the pre-record checklist. Returns true only
    /// when Nemotron and a summary engine are ready. Cancel means
    /// Record must not start. No-ops (true) when everything is already installed.
    /// </summary>
    public Func<Task<bool>>? EnsureRecordingReadyAsync { get; set; }

    [ObservableProperty]
    private bool _isReadyToRecord = true;

    [ObservableProperty]
    private string _liveSetupStatusText = string.Empty;

    [ObservableProperty]
    private string _liveSetupDetailText = string.Empty;

    [ObservableProperty]
    private string _engineSetupStatusText = string.Empty;

    [ObservableProperty]
    private string _engineSetupDetailText = string.Empty;

    [ObservableProperty]
    private string _summarySetupStatusText = string.Empty;

    [ObservableProperty]
    private string _summarySetupDetailText = string.Empty;

    [ObservableProperty]
    private string _armedQuestion = string.Empty;

    [ObservableProperty]
    private string _liveAskText = string.Empty;

    [ObservableProperty]
    private string _liveAnswerText = string.Empty;

    [ObservableProperty]
    private string _liveAnswerError = string.Empty;

    [ObservableProperty]
    private bool _isAnswering;

    [ObservableProperty]
    private LiveAnswerProviderOption? _selectedLiveAnswerProvider;

    public IReadOnlyList<LiveAnswerProviderOption> LiveAnswerProviders { get; } =
    [
        new() { Kind = SummaryProviderKind.Local, DisplayName = AppStrings.Get("RecordingSetup_SummaryLocal") },
        new() { Kind = SummaryProviderKind.ClaudeCode, DisplayName = AppStrings.Get("Cli_ClaudeName") },
        new() { Kind = SummaryProviderKind.Codex, DisplayName = AppStrings.Get("Cli_CodexName") },
        new() { Kind = SummaryProviderKind.Xai, DisplayName = AppStrings.Get("Xai_ProviderName") },
    ];

    public bool HasArmedQuestion => !string.IsNullOrWhiteSpace(ArmedQuestion);

    public bool HasLiveAnswer => !string.IsNullOrEmpty(LiveAnswerText);

    public bool HasLiveAnswerError => !string.IsNullOrEmpty(LiveAnswerError);

    public bool HasLastMeeting => LastMeeting is not null;

    public bool HasSummary => LastMeeting?.Summary is not null;

    public bool HasLiveTranscript => !string.IsNullOrEmpty(LiveTranscriptText);

    public bool IsStatusError =>
        StatusText.StartsWith(AppStrings.Get("ErrorPrefix"), StringComparison.OrdinalIgnoreCase);

    /// <summary>Live preview while recording/processing; the saved transcript after Done.</summary>
    public bool IsSessionActive => IsRecording || IsProcessing;

    public string CanvasTranscriptText =>
        IsSessionActive
            ? TranscriptHighlightApplicator.Apply(LiveTranscriptText, _highlights)
            : LastMeeting?.Transcript ?? string.Empty;

    public bool ShowSessionNotes => IsRecording || IsProcessing;

    public bool HasHighlightFeedback => !string.IsNullOrEmpty(HighlightFeedback);

    public bool HasCanvasTranscript => !string.IsNullOrEmpty(CanvasTranscriptText);

    public string CanvasHeading =>
        IsSessionActive
            ? AppStrings.Get("RecordPage_LiveTranscript.Text")
            : AppStrings.Get("RecordPage_SavedTranscript");

    public string LastMeetingTitle => LastMeeting?.Title ?? string.Empty;

    public bool ShowMicPreview =>
        (IsRecording && !IsPaused) || (!IsProcessing && !HasLastMeeting);

    /// <summary>Idle and something required is missing — show the checklist instead of Record.</summary>
    public bool ShowSetupPanel => !IsRecording && !IsProcessing && !IsReadyToRecord;

    /// <summary>Normal Record hero: recording, processing, or already set up.</summary>
    public bool ShowRecordHero => !ShowSetupPanel;

    /// <summary>Secondary Import on the Record hero while idle (not recording or processing).</summary>
    public bool ShowImportAudio => ShowRecordHero && !IsRecording && !IsProcessing;

    public RecordingPageViewModel()
    {
        _pipeline = new RecordingPipelineOrchestrator(_transcription, _meetings);
        _liveTranscription.TranscriptUpdated += OnLiveTranscriptUpdated;
        _levelMeter.LevelChanged += OnMicLevelChanged;
        AppServices.Workspace.MeetingDeleted += OnMeetingDeleted;
        AppServices.Workspace.TakeNotesRequested += OnTakeNotesRequested;
    }

    /// <summary>Record is cached; start the idle mic preview only while this page is showing.</summary>
    public void OnNavigatedTo()
    {
        _isPageVisible = true;
        TryStartMicPreview();
        _ = LoadDestinationsAsync();
        _ = RefreshReadinessAsync();
        TryStartFromTakeNotes();
    }

    public async Task RefreshReadinessAsync()
    {
        var snapshot = await RecordingSetupResolver.EvaluateAsync();
        ApplyReadiness(snapshot);
    }

    [RelayCommand]
    private async Task SetUpToRecordAsync()
    {
        if (EnsureRecordingReadyAsync is not null)
            await EnsureRecordingReadyAsync();

        await RefreshReadinessAsync();
    }

    /// <summary>Release the preview capture when leaving Record, but never stop an in-flight
    /// recording, live ASR, processing, or the elapsed timer.</summary>
    public void OnNavigatedFrom()
    {
        _isPageVisible = false;
        if (!IsRecording)
            StopMicPreview();
    }

    private void OnLiveTranscriptUpdated(object? sender, LiveTranscriptUpdate update)
    {
        App.DispatcherQueue.TryEnqueue(() => ApplyLiveTranscriptUpdate(update));
    }

    private void ApplyLiveTranscriptUpdate(LiveTranscriptUpdate update)
    {
        LiveTranscriptText = update.DisplayText ?? string.Empty;
        if (!IsRecording)
            return;

        var current = update.CommittedText ?? string.Empty;
        if (string.Equals(_previousCommittedTranscript, current, StringComparison.Ordinal))
        {
            _committedTranscript = current;
            return;
        }

        var detected = LiveQuestionDetector.TryDetectNew(_previousCommittedTranscript, current);
        _previousCommittedTranscript = current;
        _committedTranscript = current;
        if (string.IsNullOrEmpty(detected) || _dismissedQuestionBodies.Contains(detected))
            return;

        ArmedQuestion = detected;
    }

    /// <summary>Confirms the armed question, or the typed question when the box is non-empty.</summary>
    [RelayCommand(CanExecute = nameof(CanConfirmLiveAnswer), AllowConcurrentExecutions = true)]
    private Task ConfirmLiveAnswerAsync() => AskLiveAsync(typedOnly: false);

    /// <summary>Submits the typed question. Does not confirm or dismiss the armed notice.</summary>
    [RelayCommand(CanExecute = nameof(CanSubmitTypedAsk), AllowConcurrentExecutions = true)]
    private Task SubmitTypedAskAsync() => AskLiveAsync(typedOnly: true);

    [RelayCommand(CanExecute = nameof(CanDismissArmedQuestion))]
    private void DismissArmedQuestion()
    {
        if (string.IsNullOrWhiteSpace(ArmedQuestion))
            return;

        _dismissedQuestionBodies.Add(ArmedQuestion);
        ArmedQuestion = string.Empty;
    }

    private bool CanConfirmLiveAnswer() =>
        IsRecording && (!string.IsNullOrWhiteSpace(LiveAskText) || HasArmedQuestion);

    private bool CanSubmitTypedAsk() => IsRecording && !string.IsNullOrWhiteSpace(LiveAskText);

    private bool CanDismissArmedQuestion() => HasArmedQuestion;

    public async Task SaveLiveAnswerProviderAsync(SummaryProviderKind kind)
    {
        ApplyLoadedLiveAnswerProvider(kind);
        var settings = await AppServices.Settings.LoadAsync();
        settings.SelectedLiveAnswerProvider = kind.ToString();
        await AppServices.Settings.SaveAsync(settings);
    }

    private async Task AskLiveAsync(bool typedOnly)
    {
        if (!IsRecording)
            return;

        var typed = LiveAskText.Trim();
        var armed = ArmedQuestion;
        var question = typed.Length > 0 ? typed : armed.Trim();
        if (typedOnly && typed.Length == 0)
            return;
        if (question.Length == 0)
            return;

        var confirmPath = !typedOnly;
        var clearedArmed = confirmPath && armed.Length > 0;
        if (confirmPath)
            ArmedQuestion = string.Empty;

        var generation = Interlocked.Increment(ref _liveAnswerGeneration);
        var cts = ReplaceLiveAnswerCancellation();
        var token = cts.Token;
        IsAnswering = true;
        LiveAnswerError = string.Empty;
        LiveAnswerText = string.Empty;

        var committed = _committedTranscript;
        var selectedKind = SelectedLiveAnswerProvider?.Kind;

        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            if (generation != _liveAnswerGeneration || token.IsCancellationRequested)
                return;

            var providerKind = selectedKind ?? settings.ResolveLiveAnswerProviderKind();
            var resolved = await SummaryProviderResolver.ResolveAsync(
                providerKind,
                EnsureSummaryModelAsync,
                EnsureCliProviderAsync,
                EnsureXaiProviderAsync);
            if (generation != _liveAnswerGeneration || token.IsCancellationRequested)
                return;

            if (resolved is null)
            {
                PublishLiveAnswer(
                    generation,
                    answer: null,
                    error: AppStrings.Get("Status_SetupCancelled"),
                    answering: false,
                    restoreArmed: clearedArmed ? armed : null);
                return;
            }

            var prompt = LiveAnswerPromptBuilder.Build(
                question,
                LiveAnswerWindow.TakeRecent(committed, LiveAnswerWindow.Default),
                settings.ResolveSummaryLanguage());
            var answer = await Task.Run(
                () => resolved.Provider.CompletePromptAsync(prompt, token),
                token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(answer))
            {
                PublishLiveAnswer(
                    generation,
                    answer: null,
                    error: AppStrings.Get("RecordPage_LiveAnswerEmpty"),
                    answering: false);
                return;
            }

            PublishLiveAnswer(generation, answer, error: string.Empty, answering: false);
        }
        catch (OperationCanceledException)
        {
            // A newer ask, or Stop, owns the UI state.
        }
        catch (Exception ex)
        {
            PublishLiveAnswer(
                generation,
                answer: null,
                error: CliFailureUserMessage.Format(ex),
                answering: false);
        }
    }

    private void PublishLiveAnswer(
        int generation,
        string? answer,
        string? error,
        bool answering,
        string? restoreArmed = null)
    {
        App.DispatcherQueue.TryEnqueue(() =>
        {
            if (generation != _liveAnswerGeneration)
                return;

            if (restoreArmed is not null)
                ArmedQuestion = restoreArmed;
            if (answer is not null)
                LiveAnswerText = answer;
            if (error is not null)
                LiveAnswerError = error;
            IsAnswering = answering;
        });
    }

    private CancellationTokenSource ReplaceLiveAnswerCancellation()
    {
        var previous = _liveAnswerCts;
        var next = new CancellationTokenSource();
        _liveAnswerCts = next;
        CancelTokenSource(previous);
        return next;
    }

    private void CancelLiveAnswer()
    {
        Interlocked.Increment(ref _liveAnswerGeneration);
        var cts = _liveAnswerCts;
        _liveAnswerCts = null;
        CancelTokenSource(cts);
        IsAnswering = false;
    }

    private static void CancelTokenSource(CancellationTokenSource? cts)
    {
        if (cts is null)
            return;

        try
        {
            cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        cts.Dispose();
    }

    private void ResetLiveAnswerSession()
    {
        CancelLiveAnswer();
        _previousCommittedTranscript = string.Empty;
        _committedTranscript = string.Empty;
        _dismissedQuestionBodies.Clear();
        ArmedQuestion = string.Empty;
        LiveAskText = string.Empty;
        LiveAnswerText = string.Empty;
        LiveAnswerError = string.Empty;
    }

    private void ApplyLoadedLiveAnswerProvider(SummaryProviderKind kind)
    {
        SelectedLiveAnswerProvider = LiveAnswerProviders.FirstOrDefault(item => item.Kind == kind)
            ?? LiveAnswerProviders[0];
    }

    private void OnMeetingDeleted(object? sender, Guid id)
    {
        if (LastMeeting?.Id == id)
            LastMeeting = null;
    }

    private void OnTakeNotesRequested(object? sender, EventArgs e)
    {
        if (!_isPageVisible)
            return;

        App.DispatcherQueue.TryEnqueue(TryStartFromTakeNotes);
    }

    private void TryStartFromTakeNotes()
    {
        if (!AppServices.Workspace.ConsumeTakeNotes())
            return;

        if (IsRecording || IsProcessing)
            return;

        if (ToggleRecordingCommand.CanExecute(null))
            _ = ToggleRecordingCommand.ExecuteAsync(null);
    }

    [RelayCommand(CanExecute = nameof(CanToggleRecording))]
    private async Task ToggleRecordingAsync()
    {
        if (IsRecording)
            await StopRecordingAsync();
        else
            await StartRecordingAsync();
    }

    private bool CanToggleRecording() => !IsProcessing;

    private async Task StartRecordingAsync()
    {
        if (EnsureRecordingReadyAsync is not null && !await EnsureRecordingReadyAsync())
        {
            await RefreshReadinessAsync();
            return;
        }

        await RefreshReadinessAsync();
        if (!IsReadyToRecord)
            return;

        var settings = await AppServices.Settings.LoadAsync();
        ResetLiveAnswerSession();
        ApplyLoadedLiveAnswerProvider(settings.ResolveLiveAnswerProviderKind());

        _currentMeetingId = Guid.NewGuid();
        _recordedAt = DateTimeOffset.Now;
        _endedAt = default;
        AppPaths.EnsureDirectoriesExist();
        _currentAudioPath = await CreateLibraryAudioPathAsync(_currentMeetingId, _recordedAt, MeetingTitle);

        LiveTranscriptText = string.Empty;
        _liveDraft = null;
        _liveSessionActive = false;
        SessionNotes = string.Empty;
        HighlightFeedback = string.Empty;
        _highlights.Clear();
        _pausedDuration = TimeSpan.Zero;
        _pauseClock.Reset();
        IsPaused = false;

        try
        {
            var language = settings.ResolveTranscriptionLanguage();

            if (settings.LiveTranscriptionEnabled)
            {
                StatusText = AppStrings.Get("Status_LoadingModel");
                await Task.Run(() => _liveTranscription.Start(
                    language, _recordedAt, settings.SpeakerDiarizationEnabled));
                _liveSessionActive = true;
            }

            StopMicPreview();
            _audioCapture.PcmFrameAvailable += OnRecordingPcmFrame;
            _audioCapture.Start(_currentAudioPath, settings.SelectedMicrophoneDeviceId);
            IsRecording = true;
            StatusText = AppStrings.Get("Status_Recording");
        }
        catch (Exception ex)
        {
            _audioCapture.PcmFrameAvailable -= OnRecordingPcmFrame;
            if (_liveSessionActive)
            {
                await Task.Run(() => _liveTranscription.Stop());
                _liveSessionActive = false;
            }

            StatusText = AppStrings.Format("Error_StartRecording", ex.Message);
            TryStartMicPreview();
        }
    }

    private async Task StopRecordingAsync()
    {
        CancelLiveAnswer();
        _audioCapture.PcmFrameAvailable -= OnRecordingPcmFrame;
        try
        {
            await _audioCapture.StopAsync();
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Format("Error_StopRecording", ex.Message);
        }

        _endedAt = DateTimeOffset.Now;

        if (_liveSessionActive)
        {
            _liveDraft = await Task.Run(() => _liveTranscription.Stop());
            _liveSessionActive = false;
        }
        else
        {
            _liveDraft = null;
        }

        _processingCts?.Dispose();
        _processingCts = new CancellationTokenSource();
        IsProcessing = true;
        ToggleRecordingCommand.NotifyCanExecuteChanged();
        IsPaused = false;
        IsRecording = false;
        _ = ProcessRecordingAsync(_processingCts.Token);
    }

    [RelayCommand(CanExecute = nameof(CanImportAudio))]
    private async Task ImportAudioAsync()
    {
        if (EnsureRecordingReadyAsync is not null && !await EnsureRecordingReadyAsync())
        {
            await RefreshReadinessAsync();
            return;
        }

        await RefreshReadinessAsync();
        if (!IsReadyToRecord)
            return;

        var picker = new FileOpenPicker(App.WindowId)
        {
            SuggestedStartLocation = ResolveImportStartLocation(),
        };
        foreach (var extension in ImportFileExtensions)
            picker.FileTypeFilter.Add(extension);

        var picked = await picker.PickSingleFileAsync();
        if (picked is null)
            return;

        var meetingId = Guid.NewGuid();
        var sourcePath = picked.Path;
        var recordedAt = ReadSourceTimestamp(sourcePath);
        AppPaths.EnsureDirectoriesExist();
        var destinationPath = await CreateLibraryAudioPathAsync(meetingId, recordedAt, MeetingTitle);

        StatusText = AppStrings.Get("Status_Importing");
        StopMicPreview();

        TimeSpan wavDuration;
        try
        {
            wavDuration = await Task.Run(() =>
            {
                _audioImport.ConvertToNemotronWav(sourcePath, destinationPath);
                return WavFileDuration.ReadTotalTime(destinationPath);
            });
        }
        catch (Exception ex)
        {
            TryDeleteImportedWav(destinationPath);
            StatusText = AppStrings.Format("Error_ImportAudio", ex.Message);
            TryStartMicPreview();
            return;
        }

        _currentMeetingId = meetingId;
        _currentAudioPath = destinationPath;
        _recordedAt = recordedAt;
        _endedAt = recordedAt + wavDuration;
        _liveDraft = null;
        _pausedDuration = TimeSpan.Zero;
        LiveTranscriptText = string.Empty;
        SessionNotes = string.Empty;
        HighlightFeedback = string.Empty;
        _highlights.Clear();
        IsPaused = false;

        _processingCts?.Dispose();
        _processingCts = new CancellationTokenSource();
        IsProcessing = true;
        ToggleRecordingCommand.NotifyCanExecuteChanged();
        _ = ProcessRecordingAsync(_processingCts.Token);
    }

    private bool CanImportAudio() => !IsRecording && !IsProcessing;

    private static PickerLocationId ResolveImportStartLocation()
    {
        if (Enum.TryParse("Downloads", ignoreCase: true, out PickerLocationId downloads)
            || Enum.TryParse("DownloadsLibrary", ignoreCase: true, out downloads))
        {
            return downloads;
        }

        return PickerLocationId.DocumentsLibrary;
    }

    private static DateTimeOffset ReadSourceTimestamp(string sourcePath)
    {
        try
        {
            var written = File.GetLastWriteTime(sourcePath);
            return written == DateTime.MinValue ? DateTimeOffset.Now : new DateTimeOffset(written);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return DateTimeOffset.Now;
        }
    }

    private static void TryDeleteImportedWav(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception)
        {
            // Best-effort delete of a partial import.
        }
    }

    [RelayCommand(CanExecute = nameof(CanTogglePause))]
    private void TogglePause()
    {
        if (!IsRecording)
            return;

        if (IsPaused)
        {
            _pauseClock.Stop();
            _pausedDuration += _pauseClock.Elapsed;
            _pauseClock.Reset();
            _audioCapture.Resume();
            if (_liveSessionActive)
                _liveTranscription.SetClockSkew(_pausedDuration);
            _elapsed.Start();
            _elapsedTimer?.Start();
            IsPaused = false;
            StatusText = AppStrings.Get("Status_Recording");
        }
        else
        {
            _audioCapture.Pause();
            _elapsed.Stop();
            _elapsedTimer?.Stop();
            _pauseClock.Restart();
            IsPaused = true;
            StatusText = AppStrings.Get("Status_Paused");
        }
    }

    private bool CanTogglePause() => IsRecording;

    [RelayCommand(CanExecute = nameof(CanHighlightMoment))]
    private void HighlightMoment()
    {
        if (!IsRecording)
            return;

        var elapsed = _elapsed.Elapsed;
        if (elapsed < TimeSpan.Zero)
            elapsed = TimeSpan.Zero;

        _highlights.Add(elapsed);
        HighlightFeedback = AppStrings.Format("RecordPage_Highlighted", TranscriptStampFormatter.FormatElapsed(elapsed));
        _highlightFeedbackTimer ??= CreateHighlightFeedbackTimer();
        _highlightFeedbackTimer.Stop();
        _highlightFeedbackTimer.Start();
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
        OnPropertyChanged(nameof(HasHighlightFeedback));
    }

    private bool CanHighlightMoment() => IsRecording;

    [RelayCommand(CanExecute = nameof(CanDiscardRecording))]
    private async Task DiscardRecordingAsync()
    {
        if (!IsRecording)
            return;

        CancelLiveAnswer();
        _audioCapture.PcmFrameAvailable -= OnRecordingPcmFrame;
        try
        {
            await _audioCapture.StopAsync();
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Format("Error_StopRecording", ex.Message);
        }

        if (_liveSessionActive)
        {
            await Task.Run(() => _liveTranscription.Stop());
            _liveSessionActive = false;
        }

        var path = _currentAudioPath;
        _currentAudioPath = null;
        if (path is not null)
        {
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch
            {
                // Best-effort delete of a discarded take.
            }
        }

        IsPaused = false;
        IsRecording = false;
        LiveTranscriptText = string.Empty;
        _liveDraft = null;
        SessionNotes = string.Empty;
        HighlightFeedback = string.Empty;
        _highlights.Clear();
        StopElapsedTimer();
        StatusText = AppStrings.Get("Status_RecordingDiscarded");
        TryStartMicPreview();
    }

    private bool CanDiscardRecording() => IsRecording;

    [RelayCommand(CanExecute = nameof(CanCancelProcessing))]
    private void CancelProcessing() => _processingCts?.Cancel();

    private bool CanCancelProcessing() => IsProcessing;

    /// <summary>Runs transcription, summary-provider resolution, summarization, and saving via
    /// <see cref="RecordingPipelineOrchestrator"/>. This ViewModel only supplies the take's data
    /// and the UI-owned readiness gates, then receives pipeline events back through
    /// <see cref="IRecordingPipelineCallbacks"/> (implemented explicitly below) and reflects them
    /// onto its own observable properties.</summary>
    private async Task ProcessRecordingAsync(CancellationToken cancellationToken)
    {
        if (_currentAudioPath is null)
        {
            FinishProcessing(StatusText);
            return;
        }

        var meetingId = _currentMeetingId;
        var audioPath = _currentAudioPath;
        var recordedAt = _recordedAt;
        var endedAt = _endedAt;
        var title = MeetingTitle;
        var liveDraft = _liveDraft;
        var pausedDuration = _pausedDuration;
        var highlights = _highlights.ToArray();
        var folderId = await ResolveSelectedFolderIdAsync();
        var request = new RecordingPipelineRequest(
            meetingId,
            audioPath,
            recordedAt,
            endedAt,
            title,
            liveDraft,
            pausedDuration,
            folderId,
            highlights);

        await _pipeline.RunAsync(
            request,
            EnsureSummaryModelAsync,
            EnsureCliProviderAsync,
            EnsureXaiProviderAsync,
            this,
            cancellationToken);
    }

    string? IRecordingPipelineCallbacks.CurrentSessionNotes => SessionNotes;

    void IRecordingPipelineCallbacks.OnStatusChanged(string status) => StatusText = status;

    void IRecordingPipelineCallbacks.OnTranscriptRefreshed(string transcript) => LiveTranscriptText = transcript;

    void IRecordingPipelineCallbacks.OnMeetingSaved(MeetingRecord record)
    {
        if (LastMeeting is not null && LastMeeting.Id != record.Id)
            return;

        AppServices.Workspace.SetLastProcessed(record);
        LastMeeting = record;
    }

    void IRecordingPipelineCallbacks.OnFinished(string status) => FinishProcessing(status);

    void IRecordingPipelineCallbacks.OnTitleResetAndFinished(string status)
    {
        MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
        FinishProcessing(status);
    }

    void IRecordingPipelineCallbacks.OnMeetingCompleted(Guid meetingId, string status)
    {
        if (LastMeeting?.Id == meetingId)
            StatusText = status;
    }

    void IRecordingPipelineCallbacks.OnSummaryFailedAfterTranscriptSaved(Guid meetingId, string message)
    {
        MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
        if (IsProcessing)
            FinishProcessing(message);
        else if (LastMeeting?.Id == meetingId)
            StatusText = message;
    }

    partial void OnLastMeetingChanged(MeetingRecord? value)
    {
        OnPropertyChanged(nameof(HasLastMeeting));
        OnPropertyChanged(nameof(HasSummary));
        NotifyCanvasState();
        if (value is null)
            TryStartMicPreview();
        else
            StopMicPreview();
    }

    partial void OnIsRecordingChanged(bool value)
    {
        if (value)
            StartElapsedTimer();
        else
            StopElapsedTimer();

        AppServices.Workspace.IsCaptureActive = value || IsProcessing;
        NotifyCanvasState();
        TogglePauseCommand.NotifyCanExecuteChanged();
        DiscardRecordingCommand.NotifyCanExecuteChanged();
        HighlightMomentCommand.NotifyCanExecuteChanged();
        ImportAudioCommand.NotifyCanExecuteChanged();
        ConfirmLiveAnswerCommand.NotifyCanExecuteChanged();
        SubmitTypedAskCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsPausedChanged(bool value) => NotifyCanvasState();

    partial void OnStatusTextChanged(string value) => OnPropertyChanged(nameof(IsStatusError));

    [RelayCommand(CanExecute = nameof(CanCopyToClipboard))]
    private void CopyToClipboard()
    {
        if (!CanCopyToClipboard())
            return;

        var package = new DataPackage();
        package.SetText(CanvasTranscriptText);
        Clipboard.SetContent(package);
        ShowCopyConfirmation();
    }

    private bool CanCopyToClipboard() => HasCanvasTranscript;

    private void ShowCopyConfirmation()
    {
        IsCopyConfirmationOpen = true;
        _copyConfirmationTimer ??= CreateCopyConfirmationTimer();
        _copyConfirmationTimer.Stop();
        _copyConfirmationTimer.Start();
    }

    private DispatcherQueueTimer CreateCopyConfirmationTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(2.5);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => IsCopyConfirmationOpen = false;
        return timer;
    }

    private DispatcherQueueTimer CreateHighlightFeedbackTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(2);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => HighlightFeedback = string.Empty;
        return timer;
    }

    partial void OnHighlightFeedbackChanged(string value) =>
        OnPropertyChanged(nameof(HasHighlightFeedback));

    partial void OnArmedQuestionChanged(string value)
    {
        OnPropertyChanged(nameof(HasArmedQuestion));
        ConfirmLiveAnswerCommand.NotifyCanExecuteChanged();
        DismissArmedQuestionCommand.NotifyCanExecuteChanged();
    }

    partial void OnLiveAskTextChanged(string value)
    {
        ConfirmLiveAnswerCommand.NotifyCanExecuteChanged();
        SubmitTypedAskCommand.NotifyCanExecuteChanged();
    }

    partial void OnLiveAnswerTextChanged(string value) => OnPropertyChanged(nameof(HasLiveAnswer));

    partial void OnLiveAnswerErrorChanged(string value) => OnPropertyChanged(nameof(HasLiveAnswerError));

    partial void OnLiveTranscriptTextChanged(string value)
    {
        OnPropertyChanged(nameof(HasLiveTranscript));
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
        CopyToClipboardCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsProcessingChanged(bool value)
    {
        AppServices.Workspace.IsCaptureActive = value || IsRecording;
        NotifyCanvasState();
        CancelProcessingCommand.NotifyCanExecuteChanged();
        ImportAudioCommand.NotifyCanExecuteChanged();
    }

    private void NotifyCanvasState()
    {
        OnPropertyChanged(nameof(IsSessionActive));
        OnPropertyChanged(nameof(ShowMicPreview));
        OnPropertyChanged(nameof(ShowSetupPanel));
        OnPropertyChanged(nameof(ShowRecordHero));
        OnPropertyChanged(nameof(ShowImportAudio));
        OnPropertyChanged(nameof(ShowSessionNotes));
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
        OnPropertyChanged(nameof(CanvasHeading));
        OnPropertyChanged(nameof(LastMeetingTitle));
        CopyToClipboardCommand.NotifyCanExecuteChanged();
    }

    private void ApplyReadiness(RecordingSetupSnapshot snapshot)
    {
        IsReadyToRecord = snapshot.Readiness.CanRecord;
        LiveSetupStatusText = snapshot.LiveStatusText;
        LiveSetupDetailText = snapshot.LiveDetailText;
        EngineSetupStatusText = snapshot.EngineStatusText;
        EngineSetupDetailText = snapshot.EngineDetailText;
        SummarySetupStatusText = snapshot.SummaryStatusText;
        SummarySetupDetailText = snapshot.SummaryDetailText;

        if (!IsRecording && !IsProcessing)
        {
            StatusText = IsReadyToRecord
                ? AppStrings.Get("Status_ReadyToRecord")
                : AppStrings.Get("Status_NeedsSetup");
        }
    }

    partial void OnIsReadyToRecordChanged(bool value) => NotifyCanvasState();

    private void FinishProcessing(string status)
    {
        StatusText = status;
        IsProcessing = false;
        ToggleRecordingCommand.NotifyCanExecuteChanged();
        ImportAudioCommand.NotifyCanExecuteChanged();
        if (HasLastMeeting)
            StopMicPreview();
        else
            TryStartMicPreview();
    }

    private void StartElapsedTimer()
    {
        ElapsedText = "00:00";
        _elapsed.Restart();
        _elapsedTimer ??= CreateElapsedTimer();
        _elapsedTimer.Start();
    }

    private void StopElapsedTimer()
    {
        _elapsedTimer?.Stop();
        _elapsed.Reset();
        ElapsedText = "00:00";
    }

    private DispatcherQueueTimer CreateElapsedTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(1);
        timer.IsRepeating = true;
        timer.Tick += (_, _) => ElapsedText = FormatElapsed(_elapsed.Elapsed);
        return timer;
    }

    private static string FormatElapsed(TimeSpan elapsed) =>
        $"{(int)elapsed.TotalMinutes:00}:{elapsed.Seconds:00}";

    private void OnMicLevelChanged(object? sender, float level)
    {
        App.DispatcherQueue.TryEnqueue(() => MicLevel = Math.Clamp(level * 100.0, 0, 100));
    }

    private void OnRecordingPcmFrame(object? sender, PcmFrameEventArgs e)
    {
        if (e.Samples.Length == 0)
            return;

        double sumSquares = 0;
        foreach (var sample in e.Samples)
            sumSquares += sample * (double)sample;

        var rms = Math.Sqrt(sumSquares / e.Samples.Length);
        var level = Math.Clamp(rms * 100.0, 0, 100);
        App.DispatcherQueue.TryEnqueue(() => MicLevel = level);
    }

    private async Task LoadDestinationsAsync()
    {
        var folders = await _folders.GetAllAsync();
        var previousId = SelectedDestination?.FolderId;
        var flattened = FolderPathList.Flatten(folders, AppStrings.Get("Library_Inbox"));

        Destinations.Clear();
        foreach (var item in flattened)
            Destinations.Add(new FolderDestination { FolderId = item.FolderId, Path = item.Path });

        SelectedDestination = Destinations.FirstOrDefault(item => item.FolderId == previousId)
            ?? Destinations[0];
    }

    private async Task<string> CreateLibraryAudioPathAsync(Guid meetingId, DateTimeOffset recordedAt, string title)
    {
        var folders = await _folders.GetAllAsync();
        var folderId = await ResolveSelectedFolderIdAsync();
        var directory = MeetingLibraryLayout.DirectoryFor(AppPaths.UserDataDirectory, folders, folderId);
        var stem = MeetingLibraryLayout.AllocateFileStem(
            directory,
            MeetingLibraryLayout.FileStem(recordedAt, title),
            meetingId,
            _ => null);
        return MeetingLibraryLayout.AudioPath(directory, stem);
    }

    private async Task<Guid?> ResolveSelectedFolderIdAsync()
    {
        var id = SelectedDestination?.FolderId;
        if (id is null)
            return null;

        var folder = await _folders.GetByIdAsync(id.Value);
        return folder is null ? null : id;
    }

    private void StopMicPreview()
    {
        _previewGeneration++;
        _levelMeter.Stop();
        MicLevel = 0;
    }

    private async void TryStartMicPreview()
    {
        if (!_isPageVisible || IsRecording || IsProcessing || HasLastMeeting)
            return;

        var generation = ++_previewGeneration;
        var settings = await AppServices.Settings.LoadAsync();
        if (generation != _previewGeneration || !_isPageVisible || IsRecording || IsProcessing || HasLastMeeting)
            return;

        var deviceId = settings.SelectedMicrophoneDeviceId;
        _levelMeter.Start(string.IsNullOrEmpty(deviceId) ? null : deviceId);
    }
}
