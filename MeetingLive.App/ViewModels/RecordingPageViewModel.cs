using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the record/stop flow: gates on the Nemotron engine, captures mic + system audio,
/// streams live ASR when enabled, then (if needed) offline-recognizes the WAV and summarizes.
/// </summary>
public partial class RecordingPageViewModel : ObservableObject
{
    private readonly IAudioCaptureService _audioCapture = AppServices.AudioCapture;
    private readonly ITranscriptionService _transcription = AppServices.Transcription;
    private readonly ILiveTranscriptionService _liveTranscription = AppServices.LiveTranscription;
    private readonly IMeetingRepository _meetings = AppServices.Meetings;

    private Guid _currentMeetingId;
    private DateTimeOffset _recordedAt;
    private string? _currentAudioPath;
    private string? _streamingTranscript;
    private bool _liveSessionActive;

    [ObservableProperty]
    private bool _isRecording;

    [ObservableProperty]
    private bool _isProcessing;

    [ObservableProperty]
    private string _statusText = AppStrings.Get("Status_ReadyToRecord");

    [ObservableProperty]
    private string _meetingTitle = AppStrings.MeetingTitle(DateTime.Now);

    [ObservableProperty]
    private MeetingRecord? _lastMeeting;

    /// <summary>Live streaming transcript shown on the Record page. This is the real transcript,
    /// not a preview — Stop finishes the stream and that text is saved unless it is empty.</summary>
    [ObservableProperty]
    private string _liveTranscriptText = string.Empty;

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

    public RecordingPageViewModel()
    {
        _liveTranscription.TranscriptUpdated += OnLiveTranscriptUpdated;
    }

    private void OnLiveTranscriptUpdated(object? sender, string transcript)
    {
        App.DispatcherQueue.TryEnqueue(() => LiveTranscriptText = transcript);
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
        _streamingTranscript = null;
        _liveSessionActive = false;

        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            var language = settings.ResolveTranscriptionLanguage();

            if (settings.LiveTranscriptionEnabled)
            {
                StatusText = AppStrings.Get("Status_LoadingModel");
                await Task.Run(() => _liveTranscription.Start(language));
                _liveSessionActive = true;
            }

            _audioCapture.Start(_currentAudioPath, settings.SelectedMicrophoneDeviceId);
            IsRecording = true;
            StatusText = AppStrings.Get("Status_Recording");
        }
        catch (Exception ex)
        {
            if (_liveSessionActive)
            {
                _liveTranscription.Stop();
                _liveSessionActive = false;
            }

            StatusText = AppStrings.Format("Error_StartRecording", ex.Message);
        }
    }

    private async Task StopRecordingAsync()
    {
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
            _streamingTranscript = _liveTranscription.Stop();
            _liveSessionActive = false;
        }

        IsRecording = false;
        _ = ProcessRecordingAsync();
    }

    private async Task ProcessRecordingAsync()
    {
        if (_currentAudioPath is null)
            return;

        IsProcessing = true;
        ToggleRecordingCommand.NotifyCanExecuteChanged();

        try
        {
            var transcriptionSettings = await AppServices.Settings.LoadAsync();
            var language = transcriptionSettings.ResolveTranscriptionLanguage();

            string transcript;
            if (!string.IsNullOrWhiteSpace(_streamingTranscript))
            {
                transcript = _streamingTranscript;
                App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_TranscriptReady"));
            }
            else
            {
                App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_Transcribing"));
                transcript = await Task.Run(() => _transcription.TranscribeAsync(_currentAudioPath, language));
                App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_TranscriptReady"));
            }

            string? summary = null;
            IReadOnlyList<ActionItem> actionItems = [];
            string? summaryProviderId = null;

            var summaryProvider = await ResolveSummaryProviderAsync();
            if (summaryProvider is not null)
            {
                App.DispatcherQueue.TryEnqueue(() => StatusText = AppStrings.Get("Status_GeneratingSummary"));
                var result = await Task.Run(() => summaryProvider.SummarizeAsync(transcript, MeetingTitle, _recordedAt));
                summary = result.SummaryMarkdown;
                actionItems = result.ActionItems;
                summaryProviderId = result.ProviderId;
            }

            var record = new MeetingRecord
            {
                Id = _currentMeetingId,
                Title = MeetingTitle,
                RecordedAt = _recordedAt,
                AudioFilePath = _currentAudioPath,
                Transcript = transcript,
                Summary = summary,
                ActionItems = actionItems,
                SummaryProvider = summaryProviderId,
            };

            await _meetings.SaveAsync(record);

            App.DispatcherQueue.TryEnqueue(() =>
            {
                LastMeeting = record;
                StatusText = summary is not null
                    ? AppStrings.Get("Status_DoneWithSummary")
                    : AppStrings.Get("Status_DoneNoSummary");
                MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                IsProcessing = false;
                ToggleRecordingCommand.NotifyCanExecuteChanged();
            });
        }
        catch (Exception ex)
        {
            App.DispatcherQueue.TryEnqueue(() =>
            {
                StatusText = AppStrings.Format("Error_ProcessRecording", ex.Message);
                IsProcessing = false;
                ToggleRecordingCommand.NotifyCanExecuteChanged();
            });
        }
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
    }
}
