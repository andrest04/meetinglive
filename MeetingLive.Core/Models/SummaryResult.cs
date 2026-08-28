namespace MeetingLive.Core.Models;

/// <summary>
/// What any <c>ISummaryProvider</c> returns: the rendered Markdown summary body plus the
/// action items already parsed out of it, tagged with the id of the provider that produced
/// it (persisted as <see cref="MeetingRecord.SummaryProvider"/>).
/// </summary>
public sealed record SummaryResult(
    string SummaryMarkdown,
    IReadOnlyList<ActionItem> ActionItems,
    string ProviderId);
