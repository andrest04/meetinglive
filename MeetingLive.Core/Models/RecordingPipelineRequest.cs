namespace MeetingLive.Core.Models;

/// <summary>Everything the recording pipeline needs about one finished take (recorded, imported,
/// or re-transcribed from its saved audio) to run transcription, summarization, and saving.
/// <see cref="Highlights"/> is a snapshot (highlighting requires recording, so it cannot change
/// once processing starts) — session notes are read live at each save instead, since the notes
/// field stays editable while processing runs.</summary>
public sealed record RecordingPipelineRequest(
    Guid MeetingId,
    string AudioPath,
    DateTimeOffset RecordedAt,
    DateTimeOffset EndedAt,
    string Title,
    string? LiveDraft,
    TimeSpan PausedDuration,
    Guid? FolderId,
    IReadOnlyList<TimeSpan> Highlights,
    string? CalendarEventId = null,
    string? CalendarId = null,
    string? SeriesId = null,
    string? JoinUrl = null,
    IReadOnlyList<string>? Attendees = null,
    string? Brief = null,
    string? Agenda = null,
    string? NoteTemplateId = null,
    string? TemplateInstructions = null);
