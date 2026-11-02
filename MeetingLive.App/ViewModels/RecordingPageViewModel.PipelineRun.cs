using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

public partial class RecordingPageViewModel
{
    /// <summary>How long closing waits for cancelled runs to wind down. Every take is already saved
    /// by then, so a native call that ignores cancellation cannot hold the app open forever.</summary>
    private static readonly TimeSpan CloseGracePeriod = TimeSpan.FromSeconds(30);

    private readonly List<PipelineRun> _runs = [];

    /// <summary>The run holding the foreground session (Processing). Null once it hands off to a
    /// background summary or ends.</summary>
    private PipelineRun? _activeRun;

    /// <summary>The most recent run: the one whose saved meeting this page shows.</summary>
    private PipelineRun? _latestRun;

    /// <summary>True when the meeting is being recorded or a pipeline run may still save it, so
    /// deleting it now would hit an open WAV or be undone by that run's next save.</summary>
    public bool IsMeetingInUse(Guid id)
    {
        if (_runs.Any(run => run.MeetingId == id))
            return true;

        return id == _currentMeetingId && _session.Phase != RecordingSessionPhase.Idle;
    }

    /// <summary>Closing now would abandon audio still being captured.</summary>
    public bool RequiresCloseConfirmation => _session.RequiresCloseConfirmation;

    /// <summary>A stop is underway or a run has not finished: closing has to wait for its save.</summary>
    public bool HasPendingSaves => _session.Phase == RecordingSessionPhase.Stopping || _runs.Count > 0;

    /// <summary>
    /// Stops any capture, waits until every take is saved as a meeting with its audio, then cancels
    /// what is left: unfinished transcription or summary can be re-run from the saved meeting, and
    /// should not keep a closing app alive for minutes. Returns false when a take could not be saved.
    /// </summary>
    public async Task<bool> SaveAndFinishForCloseAsync()
    {
        await StopRecordingAsync();

        var runs = _runs.ToArray();
        var saved = await Task.WhenAll(runs.Select(run => run.FirstSave));

        foreach (var run in _runs.ToArray())
            run.Cancel();

        await Task.WhenAny(Task.WhenAll(runs.Select(run => run.Completion)), Task.Delay(CloseGracePeriod));
        return saved.All(isSaved => isSaved);
    }

    private void StartPipelineRun()
    {
        if (_currentAudioPath is null)
        {
            FinishProcessing(StatusText);
            return;
        }

        // Read before the first await, so nothing the user does next can leak into this take.
        var request = new RecordingPipelineRequest(
            _currentMeetingId,
            _currentAudioPath,
            _recordedAt,
            _endedAt,
            MeetingTitle,
            _liveDraft,
            _pausedDuration,
            FolderId: null,
            _highlights.ToArray(),
            _linkedCalendarEventId,
            _linkedCalendarId,
            _linkedSeriesId,
            _linkedJoinUrl,
            _linkedAttendees,
            BlankToNull(MeetingBrief),
            _linkedAgenda);

        var run = new PipelineRun(this, request.MeetingId, SessionNotes);
        _runs.Add(run);
        _activeRun = run;
        _latestRun = run;
        _ = RunPipelineAsync(run, request);
    }

    /// <summary>Runs transcription, summary-provider resolution, summarization, and saving via
    /// <see cref="RecordingPipelineOrchestrator"/>, and guarantees the run ends: a store fault here
    /// must not leave the page stuck in Processing.</summary>
    private async Task RunPipelineAsync(PipelineRun run, RecordingPipelineRequest request)
    {
        try
        {
            Guid? folderId = null;
            try
            {
                folderId = await ResolveSelectedFolderIdAsync();
            }
            catch (Exception)
            {
                // An unreadable folder store must not cost the take; it lands in the Inbox.
            }

            await _pipeline.RunAsync(
                request with { FolderId = folderId },
                EnsureSummaryModelAsync,
                EnsureCliProviderAsync,
                EnsureXaiProviderAsync,
                run,
                run.CancellationToken);
        }
        catch (Exception ex)
        {
            var status = AppStrings.Format("Error_ProcessRecording", CliFailureUserMessage.Format(ex));
            App.DispatcherQueue.TryEnqueue(() => ((IRecordingPipelineCallbacks)run).OnFinished(status));
        }
        finally
        {
            // Callbacks are queued on the dispatcher; queue the terminal step behind them.
            App.DispatcherQueue.TryEnqueue(run.Complete);
        }
    }

    /// <summary>
    /// One take's view of the page. It captures its notes and meeting at stop, and acts on the page
    /// only while it owns the session, so a run that handed off to a background summary cannot touch
    /// the next recording's notes, title, calendar link, or Processing state.
    /// </summary>
    private sealed class PipelineRun(RecordingPageViewModel page, Guid meetingId, string? notes)
        : IRecordingPipelineCallbacks
    {
        private readonly CancellationTokenSource _cancellation = new();
        private readonly TaskCompletionSource<bool> _firstSave = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private string? _notes = notes;

        public Guid MeetingId { get; } = meetingId;

        public CancellationToken CancellationToken => _cancellation.Token;

        /// <summary>True once the take is on disk as a meeting; false if the run ended first.</summary>
        public Task<bool> FirstSave => _firstSave.Task;

        public Task Completion => _completion.Task;

        private bool OwnsSession => ReferenceEquals(page._activeRun, this);

        private bool PageIsIdleOnThisMeeting =>
            page._session.Phase == RecordingSessionPhase.Idle && page.LastMeeting?.Id == MeetingId;

        public void Cancel() => _cancellation.Cancel();

        public void Complete()
        {
            ReleaseSession(page.StatusText, resetForNextTake: false);
            page._runs.Remove(this);
            _firstSave.TrySetResult(false);
            _cancellation.Dispose();
            _completion.TrySetResult();
        }

        /// <summary>The notes box stays editable while this run owns the session, so a note typed
        /// during processing is kept. From hand-off on, that box belongs to the next take.</summary>
        string? IRecordingPipelineCallbacks.CurrentSessionNotes => OwnsSession ? page.SessionNotes : _notes;

        void IRecordingPipelineCallbacks.OnStatusChanged(string status)
        {
            if (OwnsSession)
                page.StatusText = status;
        }

        void IRecordingPipelineCallbacks.OnTranscriptRefreshed(string transcript)
        {
            if (OwnsSession)
                page.LiveTranscriptText = transcript;
        }

        void IRecordingPipelineCallbacks.OnMeetingSaved(MeetingRecord record)
        {
            _firstSave.TrySetResult(true);

            if (!ReferenceEquals(page._latestRun, this))
            {
                // A newer take owns this page; the Session page can still refresh this meeting.
                AppServices.Workspace.NotifyMeetingChanged(record.Id);
                return;
            }

            AppServices.Workspace.SetLastProcessed(record);
            page.LastMeeting = record;
        }

        void IRecordingPipelineCallbacks.OnFinished(string status) =>
            EndOrReport(status, resetForNextTake: false);

        void IRecordingPipelineCallbacks.OnTitleResetAndFinished(string status) =>
            EndOrReport(status, resetForNextTake: true);

        void IRecordingPipelineCallbacks.OnMeetingCompleted(Guid completedMeetingId, string status)
        {
            if (PageIsIdleOnThisMeeting)
                page.StatusText = status;
        }

        void IRecordingPipelineCallbacks.OnSummaryFailedAfterTranscriptSaved(Guid failedMeetingId, string message) =>
            EndOrReport(message, resetForNextTake: true);

        void IRecordingPipelineCallbacks.OnSavedWithoutTranscript(Guid savedMeetingId, string status) =>
            EndOrReport(status, resetForNextTake: true);

        private void EndOrReport(string status, bool resetForNextTake)
        {
            if (!ReleaseSession(status, resetForNextTake) && PageIsIdleOnThisMeeting)
                page.StatusText = status;
        }

        /// <summary>Hands the page back. A no-op for a run that already did, so its later callbacks
        /// can never reset a newer take.</summary>
        private bool ReleaseSession(string status, bool resetForNextTake)
        {
            if (!OwnsSession)
                return false;

            _notes = page.SessionNotes;
            page._activeRun = null;
            if (resetForNextTake)
            {
                page.MeetingTitle = AppStrings.MeetingTitle(DateTime.Now);
                page.ClearCalendarLink();
            }

            page.FinishProcessing(status);
            return true;
        }
    }
}
