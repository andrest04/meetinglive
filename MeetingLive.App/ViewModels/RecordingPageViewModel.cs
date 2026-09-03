using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the record/stop flow: gates on Nemotron and a chosen summary engine BEFORE
/// capture starts. Then captures mic + system audio, streams live ASR as a preview when
/// enabled, and after Stop transcribes the WAV with Nemotron and summarizes in the background.
/// </summary>
public partial class RecordingPageViewModel : ObservableObject
{
    private readonly IAudioCaptureService _audioCapture = AppServices.AudioCapture;
    private readonly ITranscriptionService _transcription = AppServices.Transcription;
    private readonly ILiveTranscriptionService _liveTranscription = AppServices.LiveTranscription;
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private readonly IFolderRepository _folders = AppServices.Folders;
    private readonly IMicrophoneLevelMeterService _levelMeter = AppServices.MicrophoneLevelMeter;
    private readonly Stopwatch _elapsed = new();

    private Guid _currentMeetingId;
    private DateTimeOffset _recordedAt;
    private string? _currentAudioPath;
    private bool _liveSessionActive;
    private bool _isPageVisible;
    private int _previewGeneration;
    private DispatcherQueueTimer? _elapsedTimer;
    private CancellationTokenSource? _processingCts;
    private TimeSpan _pausedDuration;
    private readonly Stopwatch _pauseClock = new();
    private string? _liveDraft;

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

    public bool HasLastMeeting => LastMeeting is not null;

    public bool HasSummary => LastMeeting?.Summary is not null;

    public bool HasLiveTranscript => !string.IsNullOrEmpty(LiveTranscriptText);

    public bool IsStatusError =>
        StatusText.StartsWith(AppStrings.Get("ErrorPrefix"), StringComparison.OrdinalIgnoreCase);

    /// <summary>Live preview while recording/processing; the saved transcript after Done.</summary>
    public bool IsSessionActive => IsRecording || IsProcessing;

    public string CanvasTranscriptText =>
        IsSessionActive ? LiveTranscriptText : LastMeeting?.Transcript ?? string.Empty;

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

    public RecordingPageViewModel()
    {
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

    private void OnLiveTranscriptUpdated(object? sender, string transcript)
    {
        App.DispatcherQueue.TryEnqueue(() => LiveTranscriptText = transcript);
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

        _currentMeetingId = Guid.NewGuid();
        _recordedAt = DateTimeOffset.Now;
        AppPaths.EnsureDirectoriesExist();
        _currentAudioPath = Path.Combine(AppPaths.RecordingsDirectory, $"{_currentMeetingId}.wav");

        LiveTranscriptText = string.Empty;
        _liveDraft = null;
        _liveSessionActive = false;
        _pausedDuration = TimeSpan.Zero;
        _pauseClock.Reset();
        IsPaused = false;

        try
        {
            var language = settings.ResolveTranscriptionLanguage();

            if (settings.LiveTranscriptionEnabled)
            {
                StatusText = AppStrings.Get("Status_LoadingModel");
                await Task.Run(() => _liveTranscription.Start(language, _recordedAt));
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

    [RelayCommand(CanExecute = nameof(CanDiscardRecording))]
    private async Task DiscardRecordingAsync()
    {
        if (!IsRecording)
            return;

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
        StopElapsedTimer();
        StatusText = AppStrings.Get("Status_RecordingDiscarded");
        TryStartMicPreview();
    }

    private bool CanDiscardRecording() => IsRecording;

    [RelayCommand(CanExecute = nameof(CanCancelProcessing))]
    private void CancelProcessing() => _processingCts?.Cancel();

    private bool CanCancelProcessing() => IsProcessing;

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
        var title = MeetingTitle;
        var liveDraft = _liveDraft;
        var pausedDuration = _pausedDuration;
        var folderId = await ResolveSelectedFolderIdAsync();

        string? transcript = null;
        try
        {
            var transcriptionSettings = await AppServices.Settings.LoadAsync();
            var language = transcriptionSettings.ResolveTranscriptionLanguage();

            if (!TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime))
            {
                App.DispatcherQueue.TryEnqueue(() =>
                    FinishProcessing(AppStrings.Get("Error_EngineNotReady")));
                return;
            }

            App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_Transcribing"));
            var progress = new Progress<int>(percent =>
            {
                App.DispatcherQueue.TryEnqueue(() =>
                    StatusText = AppStrings.Format("Status_TranscribingPercent", percent));
            });

            try
            {
                transcript = await _transcription.TranscribeAsync(
                    audioPath, language, progress, cancellationToken, recordedAt, pausedDuration);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                transcript = null;
            }

            if (string.IsNullOrWhiteSpace(transcript))
                transcript = liveDraft;

            if (string.IsNullOrWhiteSpace(transcript))
            {
                App.DispatcherQueue.TryEnqueue(() =>
                    FinishProcessing(AppStrings.Get("Error_NoTranscript")));
                return;
            }

            cancellationToken.ThrowIfCancellationRequested();
            await SaveProcessedMeetingAsync(
                meetingId, title, recordedAt, audioPath, folderId, transcript,
                summary: null, actionItems: [], summaryProviderId: null);

            var pipeline = await ResolveSummaryProviderAsync();
            if (pipeline is null)
            {
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                    FinishProcessing(AppStrings.Get("Status_DoneNoSummary"));
                });
                return;
            }

            App.DispatcherQueue.TryEnqueue(() =>
            {
                MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                FinishProcessing(AppStrings.Get("Status_GeneratingSummary"));
            });

            var summaryLanguage = transcriptionSettings.ResolveSummaryLanguage();
            var result = await pipeline.Provider.SummarizeAsync(
                transcript, title, recordedAt, cancellationToken, summaryLanguage);

            await SaveProcessedMeetingAsync(
                meetingId, title, recordedAt, audioPath, folderId, transcript,
                result.SummaryMarkdown, result.ActionItems, result.ProviderId);

            App.DispatcherQueue.TryEnqueue(() =>
            {
                if (LastMeeting?.Id == meetingId)
                    StatusText = AppStrings.Get("Status_DoneWithSummary");
            });
        }
        catch (OperationCanceledException)
        {
            transcript = string.IsNullOrWhiteSpace(transcript) ? liveDraft : transcript;
            if (transcript is not null)
            {
                await SaveProcessedMeetingAsync(
                    meetingId, title, recordedAt, audioPath, folderId, transcript,
                    summary: null, actionItems: [], summaryProviderId: null);
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                    FinishProcessing(AppStrings.Get("Status_CancelledTranscriptSaved"));
                });
            }
            else
            {
                App.DispatcherQueue.TryEnqueue(() =>
                    FinishProcessing(AppStrings.Get("Status_ProcessingCancelled")));
            }
        }
        catch (Exception ex)
        {
            var friendly = CliFailureUserMessage.Format(ex);
            if (transcript is not null)
            {
                await SaveProcessedMeetingAsync(
                    meetingId, title, recordedAt, audioPath, folderId, transcript,
                    summary: null, actionItems: [], summaryProviderId: null);
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                    var message = AppStrings.Format("Status_TranscriptSavedSummaryFailed", friendly);
                    if (IsProcessing)
                        FinishProcessing(message);
                    else if (LastMeeting?.Id == meetingId)
                        StatusText = message;
                });
            }
            else
            {
                App.DispatcherQueue.TryEnqueue(() =>
                    FinishProcessing(AppStrings.Format("Error_ProcessRecording", friendly)));
            }
        }
    }

    private async Task SaveProcessedMeetingAsync(
        Guid meetingId,
        string title,
        DateTimeOffset recordedAt,
        string audioPath,
        Guid? folderId,
        string transcript,
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? summaryProviderId)
    {
        var record = new MeetingRecord
        {
            Id = meetingId,
            Title = title,
            RecordedAt = recordedAt,
            AudioFilePath = audioPath,
            Transcript = transcript,
            Summary = summary,
            ActionItems = actionItems,
            SummaryProvider = summaryProviderId,
            FolderId = folderId,
        };

        await _meetings.SaveAsync(record);
        App.DispatcherQueue.TryEnqueue(() =>
        {
            if (LastMeeting is not null && LastMeeting.Id != meetingId)
                return;

            AppServices.Workspace.SetLastProcessed(record);
            LastMeeting = record;
        });
    }

    /// <summary>Resolves an already-chosen engine (and, for a CLI provider, gates on PATH as a
    /// safety net). The first-time engine chooser lives in pre-record setup — this must not
    /// prompt after the WAV exists. Returns null when no engine was chosen or a gate failed;
    /// the caller then skips polish and summarization.</summary>
    private async Task<ResolvedSummaryPipeline?> ResolveSummaryProviderAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();

        if (string.IsNullOrWhiteSpace(settings.SelectedSummaryProvider))
            return null;

        var providerKind = settings.ResolveSummaryProviderKind();
        if (providerKind == SummaryProviderKind.Local)
        {
            var modelPath = EnsureSummaryModelAsync is null ? null : await EnsureSummaryModelAsync();
            return modelPath is null
                ? null
                : new ResolvedSummaryPipeline(
                    AppServices.CreateSummaryProvider(SummaryProviderKind.Local, modelPath),
                    SummaryProviderKind.Local,
                    modelPath);
        }

        var available = EnsureCliProviderAsync is not null && await EnsureCliProviderAsync(providerKind);
        return available
            ? new ResolvedSummaryPipeline(
                AppServices.CreateSummaryProvider(providerKind, localModelPath: null),
                providerKind,
                LocalModelPath: null)
            : null;
    }

    private sealed record ResolvedSummaryPipeline(
        ISummaryProvider Provider,
        SummaryProviderKind Kind,
        string? LocalModelPath);

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
    }

    partial void OnIsPausedChanged(bool value) => NotifyCanvasState();

    partial void OnStatusTextChanged(string value) => OnPropertyChanged(nameof(IsStatusError));

    partial void OnLiveTranscriptTextChanged(string value)
    {
        OnPropertyChanged(nameof(HasLiveTranscript));
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
    }

    partial void OnIsProcessingChanged(bool value)
    {
        AppServices.Workspace.IsCaptureActive = value || IsRecording;
        NotifyCanvasState();
        CancelProcessingCommand.NotifyCanExecuteChanged();
    }

    private void NotifyCanvasState()
    {
        OnPropertyChanged(nameof(IsSessionActive));
        OnPropertyChanged(nameof(ShowMicPreview));
        OnPropertyChanged(nameof(ShowSetupPanel));
        OnPropertyChanged(nameof(ShowRecordHero));
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
        OnPropertyChanged(nameof(CanvasHeading));
        OnPropertyChanged(nameof(LastMeetingTitle));
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
