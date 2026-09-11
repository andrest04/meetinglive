namespace MeetingLive.Core.Models;

/// <summary>
/// What any <c>ISummaryProvider</c> returns: the rendered Markdown summary body plus the
/// action items already parsed out of it, tagged with the id of the provider that produced
/// it (persisted as <see cref="MeetingRecord.SummaryProvider"/>).
/// <see cref="SuggestedTitle"/> is the optional short title parsed from a <c>## Title</c>
/// section in the same model response — never a second inference.
/// </summary>
public sealed record SummaryResult(
    string SummaryMarkdown,
    IReadOnlyList<ActionItem> ActionItems,
    string ProviderId,
    string? SuggestedTitle = null);
