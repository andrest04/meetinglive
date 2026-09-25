using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Confidence gates that turn a Jev analysis into silent record edits — no UI reads these
/// verdicts directly; they only ever mutate the record before it is shown or saved.
/// </summary>
public static class MeetingJevPresentation
{
    /// <summary>Drops action items Jev contradicts with high confidence. Leaves the list
    /// untouched (same reference) when there is nothing to remove.</summary>
    public static IReadOnlyList<ActionItem> FilterOutContradicted(
        IReadOnlyList<ActionItem> actionItems,
        IReadOnlyList<ActionItemVerdict> verdicts)
    {
        if (actionItems.Count == 0 || verdicts.Count == 0)
            return actionItems;

        var contradicted = verdicts
            .Where(verdict =>
                verdict.Confidence >= MeetingJevAnalyzer.AutoAcceptConfidence &&
                string.Equals(verdict.Relation, "contradicts", StringComparison.OrdinalIgnoreCase))
            .Select(verdict => verdict.Text)
            .ToHashSet(StringComparer.Ordinal);

        if (contradicted.Count == 0)
            return actionItems;

        return actionItems.Where(item => !contradicted.Contains(item.Text)).ToList();
    }

    public static bool TryGetSuggestedFolderId(
        MeetingJevAnalysis analysis,
        Guid? currentFolderId,
        out Guid folderId)
    {
        folderId = default;
        if (analysis.FolderConfidence is not { } confidence ||
            confidence < MeetingJevAnalyzer.AutoAcceptConfidence)
            return false;

        var suggested = analysis.SuggestedFolderId;
        if (string.IsNullOrWhiteSpace(suggested) ||
            string.Equals(suggested, "inbox", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(suggested, "none", StringComparison.OrdinalIgnoreCase))
            return false;

        if (!Guid.TryParse(suggested, out folderId))
            return false;

        return folderId != currentFolderId;
    }
}
