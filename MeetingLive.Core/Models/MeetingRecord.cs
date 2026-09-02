namespace MeetingLive.Core.Models;

public sealed class MeetingRecord
{
    public required Guid Id { get; init; }
    public required string Title { get; set; }
    public required DateTimeOffset RecordedAt { get; init; }
    public required string AudioFilePath { get; init; }
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
}
