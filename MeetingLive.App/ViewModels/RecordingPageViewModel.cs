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
/// Drives the record/stop flow: gates on the Nemotron engine, captures mic + system audio,
/// streams live ASR as a preview when enabled, then streams the WAV offline and summarizes.
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
    /// meeting text comes from offline recognition of the WAV.</summary>
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
    /// Supplied by the page (needs a XamlRoot for the setup dialog): the first-time "which engine
    /// should generate summaries" chooser (Claude Code / Codex / a local model), shown only when
    /// the user has never picked one in Settings yet. Returns the chosen engine and, for Local,
    /// the resolved model path — or null if the user cancelled.
    /// </summary>
    public Func<Task<(SummaryProviderKind Kind, string? LocalModelPath)?>>? EnsureSummaryEngineAsync { get; set; }

    /// <summary>
    /// Supplied by the page (needs a XamlRoot): downloads the Nemotron runtime + GGUF when
    /// missing. Returns false if the user cancelled — Record must not start.
    /// </summary>
    public Func<Task<bool>>? EnsureTranscriptionEngineAsync { get; set; }

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
        TryStartFromTakeNotes();
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
        if (EnsureTranscriptionEngineAsync is not null)
        {
            StatusText = AppStrings.Get("Status_PreparingEngine");
            var ready = await EnsureTranscriptionEngineAsync();
            if (!ready)
            {
                StatusText = AppStrings.Get("Status_ReadyToRecord");
                return;
            }
        }

        _currentMeetingId = Guid.NewGuid();
        _recordedAt = DateTimeOffset.Now;
        AppPaths.EnsureDirectoriesExist();
        _currentAudioPath = Path.Combine(AppPaths.RecordingsDirectory, $"{_currentMeetingId}.wav");

        LiveTranscriptText = string.Empty;
        _liveSessionActive = false;
        _pausedDuration = TimeSpan.Zero;
        _pauseClock.Reset();
        IsPaused = false;

        try
        {
            var settings = await AppServices.Settings.LoadAsync();
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
            await Task.Run(() => _liveTranscription.Stop());
            _liveSessionActive = false;
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

        string? transcript = null;
        try
        {
            var transcriptionSettings = await AppServices.Settings.LoadAsync();
            var language = transcriptionSettings.ResolveTranscriptionLanguage();

            App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_Transcribing"));
            transcript = await Task.Run(
                () => _transcription.TranscribeAsync(
                    _currentAudioPath, language, progress: null, cancellationToken, _recordedAt, _pausedDuration),
                cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_TranscriptReady"));

            string? summary = null;
            IReadOnlyList<ActionItem> actionItems = [];
            string? summaryProviderId = null;

            var summaryProvider = await ResolveSummaryProviderAsync();
            cancellationToken.ThrowIfCancellationRequested();
            if (summaryProvider is not null)
            {
                var summaryLanguage = transcriptionSettings.ResolveSummaryLanguage();
                App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_GeneratingSummary"));
                var result = await summaryProvider.SummarizeAsync(
                    transcript, MeetingTitle, _recordedAt, cancellationToken, summaryLanguage);
                summary = result.SummaryMarkdown;
                actionItems = result.ActionItems;
                summaryProviderId = result.ProviderId;
            }

            await SaveProcessedMeetingAsync(transcript, summary, actionItems, summaryProviderId);
            App.DispatcherQueue.TryEnqueue(() =>
            {
                StatusText = summary is not null
                    ? AppStrings.Get("Status_DoneWithSummary")
                    : AppStrings.Get("Status_DoneNoSummary");
                MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                FinishProcessing(StatusText);
            });
        }
        catch (OperationCanceledException)
        {
            if (transcript is not null)
            {
                await SaveProcessedMeetingAsync(transcript, summary: null, actionItems: [], summaryProviderId: null);
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
            App.DispatcherQueue.TryEnqueue(() =>
                FinishProcessing(AppStrings.Format("Error_ProcessRecording", ex.Message)));
        }
    }

    private async Task SaveProcessedMeetingAsync(
        string transcript,
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? summaryProviderId)
    {
        var record = new MeetingRecord
        {
            Id = _currentMeetingId,
            Title = MeetingTitle,
            RecordedAt = _recordedAt,
            AudioFilePath = _currentAudioPath ?? string.Empty,
            Transcript = transcript,
            Summary = summary,
            ActionItems = actionItems,
            SummaryProvider = summaryProviderId,
            FolderId = await ResolveSelectedFolderIdAsync(),
        };

        await _meetings.SaveAsync(record);
        AppServices.Workspace.SetLastProcessed(record);
        LastMeeting = record;
    }

    /// <summary>Resolves (and, for a CLI provider, gates on availability) the provider to
    /// summarize with, or null if the required gate wasn't satisfied (engine chooser or setup
    /// dialog cancelled) — the caller then skips summarization. The first time a recording is
    /// processed with no engine picked in Settings yet, shows the engine chooser; afterwards it
    /// just gates on the already-chosen engine (model download / CLI-on-PATH).</summary>
    private async Task<ISummaryProvider?> ResolveSummaryProviderAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();

        if (settings.SelectedSummaryProvider is null)
        {
            var chosen = EnsureSummaryEngineAsync is null ? null : await EnsureSummaryEngineAsync();
            if (chosen is null)
                return null;

            var (kind, localModelPath) = chosen.Value;
            return kind == SummaryProviderKind.Local
                ? AppServices.CreateSummaryProvider(SummaryProviderKind.Local, localModelPath)
                : AppServices.CreateSummaryProvider(kind, localModelPath: null);
        }

        var providerKind = settings.ResolveSummaryProviderKind();
        if (providerKind == SummaryProviderKind.Local)
        {
            var modelPath = EnsureSummaryModelAsync is null ? null : await EnsureSummaryModelAsync();
            return modelPath is null ? null : AppServices.CreateSummaryProvider(SummaryProviderKind.Local, modelPath);
        }

        var available = EnsureCliProviderAsync is not null && await EnsureCliProviderAsync(providerKind);
        return available ? AppServices.CreateSummaryProvider(providerKind, localModelPath: null) : null;
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
        OnPropertyChanged(nameof(CanvasTranscriptText));
        OnPropertyChanged(nameof(HasCanvasTranscript));
        OnPropertyChanged(nameof(CanvasHeading));
        OnPropertyChanged(nameof(LastMeetingTitle));
    }

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
