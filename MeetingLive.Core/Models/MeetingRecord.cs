namespace MeetingLive.Core.Models;

public sealed class MeetingRecord
{
    public required Guid Id { get; init; }
    public required string Title { get; set; }
    public required DateTimeOffset RecordedAt { get; init; }

    /// <summary>
    /// When capture actually stopped (live Stop) or source duration after import.
    /// Omitted from Markdown frontmatter when null so existing files stay valid.
    /// </summary>
    public DateTimeOffset? EndedAt { get; set; }

    public required string AudioFilePath { get; set; }

    /// <summary>Absolute markdown path when loaded from disk. Not persisted in frontmatter.</summary>
    public string? SourcePath { get; init; }
    public string? Transcript { get; set; }
    public string? Summary { get; set; }

    /// <summary>Id of the <c>ISummaryProvider</c> that produced <see cref="Summary"/> (e.g. "local").</summary>
    public string? SummaryProvider { get; set; }

    /// <summary>
    /// Library folder this session lives in. <see langword="null"/> means Inbox
    /// (unfiled). Omitted from Markdown frontmatter when null so existing files stay valid.
    /// </summary>
    public Guid? FolderId { get; set; }

    /// <summary>
    /// Human-written notes for this session, distinct from the AI <see cref="Summary"/>.
    /// Persisted as a trailing <c>## Personal Notes</c> Markdown section.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>Parsed from the "## Action Items" Markdown section — not a separately
    /// persisted field, the rendered Markdown is the source of truth.</summary>
    public IReadOnlyList<ActionItem> ActionItems { get; set; } = [];

    /// <summary>Typed Jev judgments persisted as a <c>## Jev</c> JSON section. Null when analysis was skipped or failed.</summary>
    public MeetingJevAnalysis? JevAnalysis { get; set; }

    /// <summary>Windows calendar appointment id. Omitted from frontmatter when null or empty.</summary>
    public string? CalendarEventId { get; set; }

    /// <summary>Windows calendar id. Omitted from frontmatter when null or empty.</summary>
    public string? CalendarId { get; set; }

    /// <summary>Recurring series id when the calendar API provided one. Omitted from frontmatter when null or empty.</summary>
    public string? SeriesId { get; set; }

    /// <summary>Join URL for the calendar event. Omitted from frontmatter when null or empty.</summary>
    public string? JoinUrl { get; set; }

    /// <summary>
    /// Attendee display names. Omitted from frontmatter when empty.
    /// Written as one line joined by <c> | </c> so a title that contains a colon is unaffected
    /// (frontmatter already splits each line on the first colon only).
    /// </summary>
    public IReadOnlyList<string> Attendees { get; set; } = [];

    /// <summary>Pre-meeting brief. Persisted as <c>## Brief</c>. Omitted when empty.</summary>
    public string? Brief { get; set; }

    /// <summary>Selected note template id. Omitted from frontmatter when empty. Auto is stored as empty.</summary>
    public string? NoteTemplateId { get; set; }

    /// <summary>Copied follow-up draft. Persisted as <c>## Follow-up</c>. Omitted when empty. Nothing is sent.</summary>
    public string? FollowUp { get; set; }

    /// <summary>Copied project-plan draft. Persisted as <c>## Project plan</c>. Omitted when empty. Nothing is sent.</summary>
    public string? ProjectPlan { get; set; }
}
