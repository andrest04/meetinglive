using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public enum ActionItemVerdictCaptionKind
{
    None,
    Verified,
    Conflicts,
    NeedsReview,
}

/// <summary>Maps a Jev action-item verdict to the caption kind the Summary UI shows.</summary>
public static class ActionItemVerdictDisplay
{
    public static ActionItemVerdict? Match(IReadOnlyList<ActionItemVerdict>? verdicts, string text)
    {
        if (verdicts is null || verdicts.Count == 0)
            return null;

        return verdicts.FirstOrDefault(verdict =>
            string.Equals(verdict.Text, text, StringComparison.Ordinal));
    }

    public static ActionItemVerdictCaptionKind CaptionKind(ActionItemVerdict? verdict)
    {
        if (verdict is null || string.IsNullOrWhiteSpace(verdict.Relation))
            return ActionItemVerdictCaptionKind.None;

        if (string.Equals(verdict.Relation, "contradicts", StringComparison.OrdinalIgnoreCase))
            return ActionItemVerdictCaptionKind.Conflicts;

        if (string.Equals(verdict.Relation, "supports", StringComparison.OrdinalIgnoreCase) &&
            verdict.Confidence >= MeetingJevAnalyzer.AutoAcceptConfidence)
            return ActionItemVerdictCaptionKind.Verified;

        return ActionItemVerdictCaptionKind.NeedsReview;
    }
}
