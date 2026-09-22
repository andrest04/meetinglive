namespace MeetingLive.Core.Services;

/// <summary>
/// Built-in note templates. Auto adds no instructions. Custom instructions live in
/// <see cref="JsonCustomNoteTemplateStore"/>, not here.
/// </summary>
public static class NoteTemplateCatalog
{
    public const string AutoId = "auto";
    public const string OneOnOneId = "one-on-one";
    public const string StandupId = "standup";
    public const string SalesId = "sales";
    public const string UserInterviewId = "user-interview";
    public const string CustomId = "custom";

    public static IReadOnlyList<string> BuiltInIds { get; } =
        [AutoId, OneOnOneId, StandupId, SalesId, UserInterviewId];

    /// <summary>Null for Auto, Custom, blank, and unknown ids. Custom text comes from the store.</summary>
    public static string? InstructionsFor(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
            return null;

        return id.Trim() switch
        {
            OneOnOneId =>
                "Shape the enhanced notes as a 1:1. Include decisions, feedback, and commitments that were actually stated. Omit a heading if that content is not in the sources.",
            StandupId =>
                "Shape the enhanced notes as a standup. Include yesterday, today, and blockers that were actually stated. Omit a heading if that content is not in the sources.",
            SalesId =>
                "Shape the enhanced notes as a sales call. Include pain, decision process, next step, and objections that were actually stated. Omit a heading if that content is not in the sources.",
            UserInterviewId =>
                "Shape the enhanced notes as a user interview. Include what they tried, quotes, and jobs-to-be-done. Quotes must be taken from the transcript or the raw notes. Do not invent quotes.",
            _ => null,
        };
    }

    /// <summary>Auto and blank are omitted from frontmatter. Other ids are stored as given.</summary>
    public static string? NormalizeId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
            return null;

        var trimmed = id.Trim();
        return trimmed.Equals(AutoId, StringComparison.OrdinalIgnoreCase) ? null : trimmed;
    }
}
