using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the record/stop flow: captures mic + system audio, then runs
/// transcription and (optionally) summarization in the background, marshaling
/// UI updates back through <see cref="App.DispatcherQueue"/>.
/// </summary>
public partial class RecordingPageViewModel : ObservableObject
{
    private readonly IAudioCaptureService _audioCapture = AppServices.AudioCapture;
    private readonly ITranscriptionService _transcription = AppServices.Transcription;
    private readonly IMeetingRepository _meetings = AppServices.Meetings;

    private Guid _currentMeetingId;
    private DateTimeOffset _recordedAt;
    private string? _currentAudioPath;

    [ObservableProperty]
    private bool _isRecording;

    [ObservableProperty]
    private bool _isProcessing;

    [ObservableProperty]
    private string _statusText = "Ready to record.";

    [ObservableProperty]
    private string _meetingTitle = $"Meeting {DateTime.Now:d MMM, HH:mm}";

    [ObservableProperty]
    private MeetingRecord? _lastMeeting;

    /// <summary>
    /// Supplied by the page (needs a XamlRoot for the setup dialog): resolves,
    /// and if needed walks the user through downloading, which local GGUF model
    /// to summarize with. Returns the model's file path, or null to skip
    /// summarization for this recording.
    /// </summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    public bool HasLastMeeting => LastMeeting is not null;

    public bool HasSummary => LastMeeting?.Summary is not null;

    [RelayCommand(CanExecute = nameof(CanToggleRecording))]
    private void ToggleRecording()
    {
        if (IsRecording)
            StopRecording();
        else
            StartRecording();
    }

    private bool CanToggleRecording() => !IsProcessing;

    private void StartRecording()
    {
        _currentMeetingId = Guid.NewGuid();
        _recordedAt = DateTimeOffset.Now;
        AppPaths.EnsureDirectoriesExist();
        _currentAudioPath = Path.Combine(AppPaths.RecordingsDirectory, $"{_currentMeetingId}.wav");

        try
        {
            _audioCapture.Start(_currentAudioPath);
            IsRecording = true;
            StatusText = "Recording... mic + system audio.";
        }
        catch (Exception ex)
        {
            StatusText = $"Error: could not start recording ({ex.Message}).";
        }
    }

    private void StopRecording()
    {
        try
        {
            _audioCapture.Stop();
        }
        catch (Exception ex)
        {
            StatusText = $"Error stopping the recording: {ex.Message}";
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
        StatusText = "Transcribing audio...";

        try
        {
            var transcript = await Task.Run(() => _transcription.TranscribeAsync(_currentAudioPath));

            App.DispatcherQueue.TryEnqueue(() => StatusText = "Transcript ready. Preparing summary...");

            string? summary = null;
            var modelPath = EnsureSummaryModelAsync is null ? null : await EnsureSummaryModelAsync();
            if (modelPath is not null)
            {
                App.DispatcherQueue.TryEnqueue(() => StatusText = "Generating summary...");
                var summaryProvider = AppServices.CreateSummaryProvider(modelPath);
                summary = await Task.Run(() => summaryProvider.SummarizeAsync(transcript));
            }

            var record = new MeetingRecord
            {
                Id = _currentMeetingId,
                Title = MeetingTitle,
                RecordedAt = _recordedAt,
                AudioFilePath = _currentAudioPath,
                Transcript = transcript,
                Summary = summary,
            };

            await _meetings.SaveAsync(record);

            App.DispatcherQueue.TryEnqueue(() =>
            {
                LastMeeting = record;
                StatusText = summary is not null
                    ? "Done. Transcript and summary available."
                    : "Done. Transcript available (no summary).";
                MeetingTitle = $"Meeting {DateTime.Now:d MMM, HH:mm}";
                IsProcessing = false;
                ToggleRecordingCommand.NotifyCanExecuteChanged();
            });
        }
        catch (Exception ex)
        {
            App.DispatcherQueue.TryEnqueue(() =>
            {
                StatusText = $"Error processing the recording: {ex.Message}";
                IsProcessing = false;
                ToggleRecordingCommand.NotifyCanExecuteChanged();
            });
        }
    }

    partial void OnLastMeetingChanged(MeetingRecord? value)
    {
        OnPropertyChanged(nameof(HasLastMeeting));
        OnPropertyChanged(nameof(HasSummary));
    }
}
