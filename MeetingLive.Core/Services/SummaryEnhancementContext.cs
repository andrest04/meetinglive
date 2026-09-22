namespace MeetingLive.Core.Services;

/// <summary>
/// Optional context for enhanced notes. Omitted fields leave the current summary prompt unchanged.
/// </summary>
public sealed record SummaryEnhancementContext(
    string? RawNotes = null,
    IReadOnlyList<string>? Attendees = null,
    string? Agenda = null,
    string? TemplateInstructions = null)
{
    public bool HasRawNotes => !string.IsNullOrWhiteSpace(RawNotes);

    public bool HasAttendees => Attendees?.Any(name => !string.IsNullOrWhiteSpace(name)) == true;

    public bool HasAgenda => !string.IsNullOrWhiteSpace(Agenda);

    public bool HasTemplateInstructions => !string.IsNullOrWhiteSpace(TemplateInstructions);

    public bool HasAny => HasRawNotes || HasAttendees || HasAgenda || HasTemplateInstructions;
}
