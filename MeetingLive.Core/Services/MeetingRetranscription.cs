using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public enum RetranscriptionAvailability
{
    Available,
    NoAudio,
    Busy,
}

/// <summary>
/// Rules for re-running the offline transcription → summary pipeline over an already saved
/// meeting. The pipeline itself is the one that runs after Stop/import; this only decides
/// whether a meeting qualifies and builds the request that pipeline consumes.
/// </summary>
public static class MeetingRetranscription
{
    /// <summary>Re-transcription needs the saved audio and an idle engine. Audio is checked first
    /// so a meeting without audio is reported as unavailable rather than merely busy.</summary>
    public static RetranscriptionAvailability Evaluate(
        MeetingRecord? record, bool isBusy, Func<string, bool>? fileExists = null)
    {
        if (record is null || string.IsNullOrWhiteSpace(record.AudioFilePath))
            return RetranscriptionAvailability.NoAudio;

        if (!(fileExists ?? File.Exists)(record.AudioFilePath))
            return RetranscriptionAvailability.NoAudio;

        return isBusy ? RetranscriptionAvailability.Busy : RetranscriptionAvailability.Available;
    }

    /// <summary>A pipeline request with no live draft, so the offline pass result becomes the
    /// transcript and the old one stays untouched until that pass succeeds.</summary>
    public static RecordingPipelineRequest CreateRequest(MeetingRecord record, string? templateInstructions = null)
    {
        ArgumentNullException.ThrowIfNull(record);

        return new RecordingPipelineRequest(
            record.Id,
            record.AudioFilePath,
            record.RecordedAt,
            record.EndedAt ?? default,
            record.Title,
            LiveDraft: null,
            PausedDuration: TimeSpan.Zero,
            record.FolderId,
            Highlights: [],
            record.CalendarEventId,
            record.CalendarId,
            record.SeriesId,
            record.JoinUrl,
            record.Attendees,
            record.Brief,
            Agenda: null,
            record.NoteTemplateId,
            templateInstructions);
    }
}
