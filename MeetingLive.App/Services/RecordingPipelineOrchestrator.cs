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
        try
        {
            var transcriptionSettings = await AppServices.Settings.LoadAsync();
            var language = transcriptionSettings.ResolveTranscriptionLanguage();

            if (!string.IsNullOrWhiteSpace(transcript))
            {
                await SaveProcessedMeetingAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript,
                    summary: null, actionItems: [], summaryProviderId: null, callbacks);
            }

            if (TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime))
            {
                Dispatch(() => callbacks.OnStatusChanged(AppStrings.Get("Status_Transcribing")));
                var progress = new Progress<int>(percent =>
                    Dispatch(() => callbacks.OnStatusChanged(AppStrings.Format("Status_TranscribingPercent", percent))));

                string? wavTranscript = null;
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
                catch
                {
                    wavTranscript = null;
                }

                if (!string.IsNullOrWhiteSpace(wavTranscript))
                {
                    var stamped = TranscriptStampFormatter.EnsureEndedHeader(wavTranscript, recordedAt, endedAt);
                    transcript = stamped;
                    Dispatch(() => callbacks.OnTranscriptRefreshed(stamped));
                }
            }
            else if (string.IsNullOrWhiteSpace(transcript))
            {
                Dispatch(() => callbacks.OnFinished(AppStrings.Get("Error_EngineNotReady")));
                return;
            }

            if (string.IsNullOrWhiteSpace(transcript))
            {
                Dispatch(() => callbacks.OnFinished(AppStrings.Get("Error_NoTranscript")));
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
                Dispatch(() => callbacks.OnTitleResetAndFinished(AppStrings.Get("Status_DoneNoSummary")));
                return;
            }

            Dispatch(() => callbacks.OnTitleResetAndFinished(AppStrings.Get("Status_GeneratingSummary")));

            var summaryLanguage = transcriptionSettings.ResolveSummaryLanguage();
            var result = await pipeline.Provider.SummarizeAsync(
                transcript, title, recordedAt, cancellationToken, summaryLanguage,
                endedAt == default ? null : endedAt);

            var saveTitle = SuggestedMeetingTitle.Resolve(title, result.SuggestedTitle);
            var record = await SaveProcessedMeetingAsync(
                request, meetingId, saveTitle, recordedAt, endedAt, audioPath, folderId, transcript,
                result.SummaryMarkdown, result.ActionItems, result.ProviderId, callbacks);

            if (!string.Equals(saveTitle, title, StringComparison.Ordinal))
                AppServices.Workspace.NotifyMeetingChanged(meetingId);

            var doneMessage = AppStrings.Get("Status_DoneWithSummary");
            try
            {
                var jevStatus = await MeetingJevRunner.TryAnalyzeAndSaveAsync(record, meetings, cancellationToken);
                if (jevStatus is not null)
                    doneMessage = jevStatus;
            }
            catch (OperationCanceledException)
            {
                // Summary is already saved; do not take the summary-failed path.
            }

            Dispatch(() => callbacks.OnMeetingCompleted(meetingId, doneMessage));
        }
        catch (OperationCanceledException)
        {
            transcript = string.IsNullOrWhiteSpace(transcript)
                ? StampEndedHeader(request.LiveDraft, recordedAt, endedAt)
                : transcript;
            if (transcript is not null)
            {
                await SaveProcessedMeetingAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript,
                    summary: null, actionItems: [], summaryProviderId: null, callbacks);
                Dispatch(() => callbacks.OnTitleResetAndFinished(AppStrings.Get("Status_CancelledTranscriptSaved")));
            }
            else
            {
                Dispatch(() => callbacks.OnFinished(AppStrings.Get("Status_ProcessingCancelled")));
            }
        }
        catch (Exception ex)
        {
            var friendly = CliFailureUserMessage.Format(ex);
            if (transcript is not null)
            {
                await SaveProcessedMeetingAsync(
                    request, meetingId, title, recordedAt, endedAt, audioPath, folderId, transcript,
                    summary: null, actionItems: [], summaryProviderId: null, callbacks);
                var message = AppStrings.Format("Status_TranscriptSavedSummaryFailed", friendly);
                Dispatch(() => callbacks.OnSummaryFailedAfterTranscriptSaved(meetingId, message));
            }
            else
            {
                Dispatch(() => callbacks.OnFinished(AppStrings.Format("Error_ProcessRecording", friendly)));
            }
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
        string transcript,
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? summaryProviderId,
        IRecordingPipelineCallbacks callbacks)
    {
        transcript = StampEndedHeader(transcript, recordedAt, endedAt) ?? transcript;
        var record = new MeetingRecord
        {
            Id = meetingId,
            Title = title,
            RecordedAt = recordedAt,
            EndedAt = endedAt == default ? null : endedAt,
            AudioFilePath = audioPath,
            Transcript = TranscriptHighlightApplicator.Apply(transcript, request.Highlights),
            Summary = summary,
            ActionItems = actionItems,
            SummaryProvider = summaryProviderId,
            FolderId = folderId,
            Notes = string.IsNullOrWhiteSpace(callbacks.CurrentSessionNotes) ? null : callbacks.CurrentSessionNotes.Trim(),
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

    private static void Dispatch(Action action) => App.DispatcherQueue.TryEnqueue(() => action());
}

/// <summary>Everything <see cref="RecordingPipelineOrchestrator"/> needs about one finished take
/// (recorded or imported) to run transcription, summarization, and saving. <see cref="Highlights"/>
/// is a snapshot (highlighting requires <c>IsRecording</c>, so it cannot change once processing
/// starts) — Session notes are read live at each save through
/// <see cref="IRecordingPipelineCallbacks.CurrentSessionNotes"/> instead, since the notes field
/// stays editable while processing runs.</summary>
public sealed record RecordingPipelineRequest(
    Guid MeetingId,
    string AudioPath,
    DateTimeOffset RecordedAt,
    DateTimeOffset EndedAt,
    string Title,
    string? LiveDraft,
    TimeSpan PausedDuration,
    Guid? FolderId,
    IReadOnlyList<TimeSpan> Highlights);

/// <summary>
/// Pipeline events <see cref="RecordingPipelineOrchestrator"/> reports back to its host. Every
/// method is invoked already marshaled onto <see cref="App.DispatcherQueue"/>, so implementations
/// (the hosting ViewModel) can set observable properties directly.
/// </summary>
public interface IRecordingPipelineCallbacks
{
    /// <summary>The host's session-notes text as of right now (it stays editable while processing
    /// runs), read fresh at every save so a note typed mid-pipeline is not lost.</summary>
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
}
