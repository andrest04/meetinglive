using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App;

namespace MeetingLive_App.Services;

/// <summary>
/// Everything a finished take needs (recorded or imported) before it becomes a saved
/// <see cref="MeetingRecord"/>: WAV-quality transcription, summary-provider resolution, and
/// summarization. Extracted from <c>RecordingPageViewModel.ProcessRecordingAsync</c>, which forced
/// record/stop UI state, mic metering, and this multi-stage background pipeline to change together.
/// </summary>
/// <remarks>
/// Lives in the App project (not Core) because it marshals every UI-visible update onto
/// <see cref="App.DispatcherQueue"/> and formats user-facing status text via
/// <see cref="AppStrings"/> / <see cref="CliFailureUserMessage"/>, both App-only concerns the
/// Core layer intentionally has no dependency on. It reports progress and results to
/// <see cref="IRecordingPipelineCallbacks"/>, which the hosting ViewModel implements to translate
/// pipeline events into its own observable properties — the orchestrator never touches a
/// ViewModel property directly.
/// </remarks>
public sealed class RecordingPipelineOrchestrator(
    ITranscriptionService transcription,
    IMeetingRepository meetings)
{
    public async Task RunAsync(
        RecordingPipelineRequest request,
        Func<Task<string?>>? ensureSummaryModelAsync,
        Func<SummaryProviderKind, Task<bool>>? ensureCliProviderAsync,
        Func<Task<bool>>? ensureXaiProviderAsync,
        IRecordingPipelineCallbacks callbacks,
        CancellationToken cancellationToken)
    {
        var meetingId = request.MeetingId;
        var audioPath = request.AudioPath;
        var recordedAt = request.RecordedAt;
        var endedAt = request.EndedAt;
        var title = request.Title;
        var pausedDuration = request.PausedDuration;
        var folderId = request.FolderId;

        string? transcript = StampEndedHeader(request.LiveDraft, recordedAt, endedAt);
        var meetingIsDurable = false;
        try
        {
            // First, before anything that can fail: the take becomes a meeting that keeps its audio.
            var existing = await meetings.GetByIdAsync(meetingId);
            if (RecordingPipelineRules.ShouldSaveBeforeTranscribing(transcript, existing?.AudioFilePath, audioPath))
            {
                var hasDraft = !string.IsNullOrWhiteSpace(transcript);
                await SaveProcessedMeetingAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId,
                    hasDraft ? transcript : existing?.Transcript,
                    summary: hasDraft ? null : existing?.Summary,
                    actionItems: hasDraft ? [] : existing?.ActionItems ?? [],
                    summaryProviderId: hasDraft ? null : existing?.SummaryProvider,
                    callbacks);
            }

            meetingIsDurable = true;

            var transcriptionSettings = await AppServices.Settings.LoadAsync();
            var language = transcriptionSettings.ResolveTranscriptionLanguage();
            string? transcriptionWarning = null;

            if (TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime))
            {
                Dispatch(() => callbacks.OnStatusChanged(AppStrings.Get("Status_Transcribing")));
                var progress = new Progress<int>(percent =>
                    Dispatch(() => callbacks.OnStatusChanged(AppStrings.Format("Status_TranscribingPercent", percent))));

                string? wavTranscript = null;
                Exception? transcriptionFailure = null;
                try
                {
                    wavTranscript = await transcription.TranscribeAsync(
                        audioPath,
                        language,
                        progress,
                        cancellationToken,
                        recordedAt,
                        pausedDuration,
                        transcriptionSettings.SpeakerDiarizationEnabled);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    transcriptionFailure = ex;
                }

                switch (RecordingPipelineRules.ResolveTranscriptionStage(transcript, wavTranscript, transcriptionFailure is not null))
                {
                    case TranscriptionStageOutcome.OfflineTranscript:
                        var stamped = TranscriptStampFormatter.EnsureEndedHeader(wavTranscript!, recordedAt, endedAt);
                        transcript = stamped;
                        Dispatch(() => callbacks.OnTranscriptRefreshed(stamped));
                        break;

                    case TranscriptionStageOutcome.LiveDraftAfterFailure:
                        transcriptionWarning = AppStrings.Format(
                            "Status_LiveDraftKeptTranscriptionFailed",
                            CliFailureUserMessage.Format(transcriptionFailure!));
                        break;

                    case TranscriptionStageOutcome.FailedWithoutTranscript:
                        var failed = AppStrings.Format(
                            "Error_TranscriptionFailedAudioKept",
                            CliFailureUserMessage.Format(transcriptionFailure!));
                        Dispatch(() => callbacks.OnSavedWithoutTranscript(meetingId, failed));
                        return;

                    case TranscriptionStageOutcome.NoTranscript:
                        Dispatch(() => callbacks.OnSavedWithoutTranscript(meetingId, AppStrings.Get("Error_NoTranscript")));
                        return;
                }
            }
            else if (string.IsNullOrWhiteSpace(transcript))
            {
                Dispatch(() => callbacks.OnSavedWithoutTranscript(meetingId, AppStrings.Get("Error_EngineNotReady")));
                return;
            }

            cancellationToken.ThrowIfCancellationRequested();
            await SaveProcessedMeetingAsync(
                request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript,
                summary: null, actionItems: [], summaryProviderId: null, callbacks);

            var pipeline = await ResolveSummaryProviderAsync(
                ensureSummaryModelAsync, ensureCliProviderAsync, ensureXaiProviderAsync);
            if (pipeline is null)
            {
                var doneNoSummary = transcriptionWarning ?? AppStrings.Get("Status_DoneNoSummary");
                Dispatch(() => callbacks.OnTitleResetAndFinished(doneNoSummary));
                return;
            }

            Dispatch(() => callbacks.OnTitleResetAndFinished(AppStrings.Get("Status_GeneratingSummary")));

            var summaryLanguage = transcriptionSettings.ResolveSummaryLanguage();
            var enhancement = new SummaryEnhancementContext(
                callbacks.CurrentSessionNotes,
                request.Attendees,
                request.Agenda,
                request.TemplateInstructions);
            var result = await pipeline.Provider.SummarizeAsync(
                transcript, title, recordedAt, cancellationToken, summaryLanguage,
                endedAt == default ? null : endedAt,
                enhancement.HasAny ? enhancement : null);

            var saveTitle = SuggestedMeetingTitle.Resolve(title, result.SuggestedTitle);
            var record = await SaveProcessedMeetingAsync(
                request, meetingId, saveTitle, recordedAt, endedAt, audioPath, folderId, transcript,
                result.SummaryMarkdown, result.ActionItems, result.ProviderId, callbacks);

            if (!string.Equals(saveTitle, title, StringComparison.Ordinal))
                AppServices.Workspace.NotifyMeetingChanged(meetingId);

            try
            {
                await MeetingJevRunner.TryAnalyzeAndSaveAsync(record, meetings, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // Summary is already saved; do not take the summary-failed path.
            }

            var done = transcriptionWarning ?? AppStrings.Get("Status_DoneWithSummary");
            Dispatch(() => callbacks.OnMeetingCompleted(meetingId, done));
        }
        catch (OperationCanceledException)
        {
            transcript = string.IsNullOrWhiteSpace(transcript)
                ? StampEndedHeader(request.LiveDraft, recordedAt, endedAt)
                : transcript;
            if (string.IsNullOrWhiteSpace(transcript))
            {
                ReportNoTranscript(meetingId, meetingIsDurable, AppStrings.Get("Status_ProcessingCancelled"), callbacks);
                return;
            }

            if (await TrySaveTranscriptAfterFailureAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript, callbacks))
            {
                Dispatch(() => callbacks.OnTitleResetAndFinished(AppStrings.Get("Status_CancelledTranscriptSaved")));
            }
        }
        catch (Exception ex)
        {
            var friendly = CliFailureUserMessage.Format(ex);
            if (string.IsNullOrWhiteSpace(transcript))
            {
                ReportNoTranscript(meetingId, meetingIsDurable, AppStrings.Format("Error_ProcessRecording", friendly), callbacks);
                return;
            }

            if (await TrySaveTranscriptAfterFailureAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript, callbacks))
            {
                var message = AppStrings.Format("Status_TranscriptSavedSummaryFailed", friendly);
                Dispatch(() => callbacks.OnSummaryFailedAfterTranscriptSaved(meetingId, message));
            }
        }
    }

    /// <summary>The terminal report when no transcript exists: an already durable meeting keeps its
    /// audio and ends the session; otherwise nothing was saved and the take stays on screen.</summary>
    private static void ReportNoTranscript(
        Guid meetingId, bool meetingIsDurable, string status, IRecordingPipelineCallbacks callbacks)
    {
        if (meetingIsDurable)
            Dispatch(() => callbacks.OnSavedWithoutTranscript(meetingId, status));
        else
            Dispatch(() => callbacks.OnFinished(status));
    }

    /// <summary>A save from a failure handler hits the same store that may have caused the failure,
    /// so it reports a terminal state itself rather than escaping and leaving the host processing.</summary>
    private async Task<bool> TrySaveTranscriptAfterFailureAsync(
        RecordingPipelineRequest request,
        Guid meetingId,
        string title,
        DateTimeOffset recordedAt,
        DateTimeOffset endedAt,
        string audioPath,
        Guid? folderId,
        string transcript,
        IRecordingPipelineCallbacks callbacks)
    {
        try
        {
            await SaveProcessedMeetingAsync(
                request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript,
                summary: null, actionItems: [], summaryProviderId: null, callbacks);
            return true;
        }
        catch (Exception ex)
        {
            var status = AppStrings.Format("Error_ProcessRecording", CliFailureUserMessage.Format(ex));
            Dispatch(() => callbacks.OnFinished(status));
            return false;
        }
    }

    /// <summary>Resolves an already-chosen engine (and, for a CLI provider, gates on PATH as a
    /// safety net). The first-time engine chooser lives in pre-record setup — this must not
    /// prompt after the WAV exists. Returns null when no engine was chosen or a gate failed;
    /// the caller then skips summarization.</summary>
    private static async Task<ResolvedSummaryPipeline?> ResolveSummaryProviderAsync(
        Func<Task<string?>>? ensureSummaryModelAsync,
        Func<SummaryProviderKind, Task<bool>>? ensureCliProviderAsync,
        Func<Task<bool>>? ensureXaiProviderAsync)
    {
        var settings = await AppServices.Settings.LoadAsync();
        if (string.IsNullOrWhiteSpace(settings.SelectedSummaryProvider))
            return null;

        var providerKind = settings.ResolveSummaryProviderKind();
        return await SummaryProviderResolver.ResolveAsync(
            providerKind, ensureSummaryModelAsync, ensureCliProviderAsync, ensureXaiProviderAsync);
    }

    private async Task<MeetingRecord> SaveProcessedMeetingAsync(
        RecordingPipelineRequest request,
        Guid meetingId,
        string title,
        DateTimeOffset recordedAt,
        DateTimeOffset endedAt,
        string audioPath,
        Guid? folderId,
        string? transcript,
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? summaryProviderId,
        IRecordingPipelineCallbacks callbacks)
    {
        transcript = StampEndedHeader(transcript, recordedAt, endedAt);
        var existing = await meetings.GetByIdAsync(meetingId);
        var record = new MeetingRecord
        {
            Id = meetingId,
            Title = title,
            RecordedAt = recordedAt,
            EndedAt = endedAt == default ? null : endedAt,
            AudioFilePath = audioPath,
            Transcript = string.IsNullOrWhiteSpace(transcript)
                ? null
                : TranscriptHighlightApplicator.Apply(transcript, request.Highlights),
            Summary = summary,
            ActionItems = actionItems,
            SummaryProvider = summaryProviderId,
            FolderId = folderId,
            Notes = string.IsNullOrWhiteSpace(callbacks.CurrentSessionNotes) ? null : callbacks.CurrentSessionNotes.Trim(),
            CalendarEventId = BlankToNull(request.CalendarEventId),
            CalendarId = BlankToNull(request.CalendarId),
            SeriesId = BlankToNull(request.SeriesId),
            JoinUrl = BlankToNull(request.JoinUrl),
            Attendees = request.Attendees?
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.Trim())
                .ToArray() ?? [],
            Brief = BlankToNull(request.Brief) ?? existing?.Brief,
            NoteTemplateId = BlankToNull(request.NoteTemplateId),
            FollowUp = existing?.FollowUp,
            ProjectPlan = existing?.ProjectPlan,
        };

        await meetings.SaveAsync(record);
        Dispatch(() => callbacks.OnMeetingSaved(record));
        return record;
    }

    private static string? StampEndedHeader(string? transcript, DateTimeOffset recordedAt, DateTimeOffset endedAt)
    {
        if (transcript is null)
            return null;

        return TranscriptStampFormatter.EnsureEndedHeader(transcript, recordedAt, endedAt);
    }

    private static string? BlankToNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void Dispatch(Action action) => App.DispatcherQueue.TryEnqueue(() => action());
}

/// <summary>
/// Pipeline events <see cref="RecordingPipelineOrchestrator"/> reports back to its host. Every
/// method is invoked already marshaled onto <see cref="App.DispatcherQueue"/>, so implementations
/// (the hosting ViewModel) can set observable properties directly.
/// </summary>
public interface IRecordingPipelineCallbacks
{
    /// <summary>The notes that belong to this run, read fresh at every save so a note typed while the
    /// run still owns the notes box is not lost. A later take's notes must never appear here.</summary>
    string? CurrentSessionNotes { get; }

    /// <summary>An interim status message (e.g. "Transcribing… 42%").</summary>
    void OnStatusChanged(string status);

    /// <summary>The WAV-quality transcript arrived; refresh the live preview shown while processing.</summary>
    void OnTranscriptRefreshed(string transcript);

    /// <summary>A meeting record was written to disk. The host decides whether to still care
    /// (e.g. it may already be showing a different meeting).</summary>
    void OnMeetingSaved(MeetingRecord record);

    /// <summary>Processing has reached a terminal state (success, partial, cancelled, or error)
    /// with no accompanying title reset.</summary>
    void OnFinished(string status);

    /// <summary>Resets the meeting title field for the next recording, then reports a terminal
    /// or transitional status the same way <see cref="OnFinished"/> does.</summary>
    void OnTitleResetAndFinished(string status);

    /// <summary>Summarization finished successfully. The host applies <paramref name="status"/>
    /// only if it is still showing the meeting with <paramref name="meetingId"/>.</summary>
    void OnMeetingCompleted(Guid meetingId, string status);

    /// <summary>The transcript was saved but summarization failed. The host decides how to
    /// surface <paramref name="message"/> depending on whether it is still mid-processing or has
    /// already moved on.</summary>
    void OnSummaryFailedAfterTranscriptSaved(Guid meetingId, string message);

    /// <summary>The run ended with no new transcript, but the meeting exists and keeps its audio, so
    /// it can be retranscribed. Hosts with a session to release override this; others treat it as
    /// any terminal state.</summary>
    void OnSavedWithoutTranscript(Guid meetingId, string status) => OnFinished(status);
}
