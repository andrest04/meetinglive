using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

public enum RetranscriptionOutcome
{
    /// <summary>New transcript and summary saved.</summary>
    Completed,

    /// <summary>New transcript saved; no summary was produced (no engine chosen or its setup was declined).</summary>
    TranscriptOnly,

    /// <summary>New transcript saved; the summary provider failed. <see cref="RetranscriptionResult.Message"/> explains.</summary>
    SummaryFailed,

    /// <summary>The user cancelled. The previous transcript is untouched unless the new one was already saved.</summary>
    Cancelled,

    /// <summary>The offline pass produced nothing. The previous transcript is untouched.</summary>
    Failed,
}

public sealed record RetranscriptionResult(Guid MeetingId, RetranscriptionOutcome Outcome, string? Message);

/// <summary>
/// App-lifetime host for re-running the post-Stop pipeline over a saved meeting. It does not
/// reimplement transcribe → save → summarize: it builds a <see cref="RecordingPipelineRequest"/>
/// with no live draft and hands it to the same <see cref="RecordingPipelineOrchestrator"/> that
/// runs after Stop/import. Lives for the whole app (not a page) so navigating away neither loses
/// the run nor lets a second one start on the shared ASR engine.
/// </summary>
public sealed class MeetingRetranscriptionRunner : IRecordingPipelineCallbacks
{
    private readonly RecordingPipelineOrchestrator _pipeline;
    private CancellationTokenSource? _cts;
    private string? _notes;
    private bool _completed;
    private string? _failure;
    private string? _summaryFailure;

    public MeetingRetranscriptionRunner(ITranscriptionService transcription, IMeetingRepository meetings)
    {
        _pipeline = new RecordingPipelineOrchestrator(transcription, meetings);
    }

    public bool IsRunning { get; private set; }

    public Guid? MeetingId { get; private set; }

    public string Status { get; private set; } = string.Empty;

    /// <summary>Progress or running-state changed. Raised on the UI thread.</summary>
    public event EventHandler? StateChanged;

    /// <summary>The run reached a terminal state. Raised on the UI thread after state is reset.</summary>
    public event EventHandler<RetranscriptionResult>? Finished;

    /// <summary>Starts the run; returns false when another run is already active. Must be called on the UI thread.</summary>
    public async Task<bool> StartAsync(
        MeetingRecord record,
        Func<Task<string?>>? ensureSummaryModelAsync,
        Func<SummaryProviderKind, Task<bool>>? ensureCliProviderAsync,
        Func<Task<bool>>? ensureXaiProviderAsync)
    {
        ArgumentNullException.ThrowIfNull(record);
        if (IsRunning)
            return false;

        IsRunning = true;
        MeetingId = record.Id;
        Status = AppStrings.Get("Status_Transcribing");
        _notes = record.Notes;
        _completed = false;
        _failure = null;
        _summaryFailure = null;
        _cts?.Dispose();
        _cts = new CancellationTokenSource();
        StateChanged?.Invoke(this, EventArgs.Empty);

        var token = _cts.Token;
        try
        {
            var templateInstructions = await NoteTemplateInstructions.ResolveAsync(
                record.NoteTemplateId, AppServices.NoteTemplates, token);
            await _pipeline.RunAsync(
                MeetingRetranscription.CreateRequest(record, templateInstructions),
                ensureSummaryModelAsync,
                ensureCliProviderAsync,
                ensureXaiProviderAsync,
                this,
                token);
        }
        catch (OperationCanceledException)
        {
            // Cancelled before the pipeline took over; nothing was written.
        }
        catch (Exception ex)
        {
            _failure = CliFailureUserMessage.Format(ex);
        }

        // Callbacks are queued on the dispatcher; queue the terminal step behind them.
        App.DispatcherQueue.TryEnqueue(Complete);
        return true;
    }

    public void Cancel() => _cts?.Cancel();

    private void Complete()
    {
        var id = MeetingId ?? Guid.Empty;
        var outcome = _summaryFailure is not null ? RetranscriptionOutcome.SummaryFailed
            : _failure is not null ? RetranscriptionOutcome.Failed
            : _completed ? RetranscriptionOutcome.Completed
            : _cts?.IsCancellationRequested == true ? RetranscriptionOutcome.Cancelled
            : RetranscriptionOutcome.TranscriptOnly;
        var message = outcome switch
        {
            RetranscriptionOutcome.SummaryFailed => _summaryFailure,
            RetranscriptionOutcome.Failed => _failure,
            _ => null,
        };

        IsRunning = false;
        MeetingId = null;
        Status = string.Empty;
        StateChanged?.Invoke(this, EventArgs.Empty);
        Finished?.Invoke(this, new RetranscriptionResult(id, outcome, message));
    }

    string? IRecordingPipelineCallbacks.CurrentSessionNotes => _notes;

    void IRecordingPipelineCallbacks.OnStatusChanged(string status) => SetStatus(status);

    void IRecordingPipelineCallbacks.OnTranscriptRefreshed(string transcript)
    {
    }

    void IRecordingPipelineCallbacks.OnMeetingSaved(MeetingRecord record) =>
        AppServices.Workspace.NotifyMeetingChanged(record.Id);

    void IRecordingPipelineCallbacks.OnFinished(string status)
    {
        // Terminal without a saved result: cancelled, engine not ready, or no transcript produced.
        if (_cts?.IsCancellationRequested != true)
            _failure = status;
    }

    void IRecordingPipelineCallbacks.OnTitleResetAndFinished(string status) => SetStatus(status);

    void IRecordingPipelineCallbacks.OnMeetingCompleted(Guid meetingId, string status) => _completed = true;

    void IRecordingPipelineCallbacks.OnSummaryFailedAfterTranscriptSaved(Guid meetingId, string message) =>
        _summaryFailure = message;

    private void SetStatus(string status)
    {
        Status = status;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }
}
