using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>Confidence gates for the Summary-page Jev strip. Raw probabilities stay on the model.</summary>
public static class MeetingJevPresentation
{
    public const double PiiWarningThreshold = 0.7;
    public const double UnfaithfulThreshold = 0.4;

    public static bool ShowMeetingType(MeetingJevAnalysis analysis) =>
        !string.IsNullOrWhiteSpace(analysis.MeetingType) &&
        analysis.MeetingTypeConfidence >= MeetingJevAnalyzer.AutoAcceptConfidence;

    public static int? UrgencyLabelScore(MeetingJevAnalysis analysis)
    {
        if (analysis.UrgencyConfidence is not { } confidence ||
            confidence < MeetingJevAnalyzer.AutoAcceptConfidence)
            return null;

        return (int)Math.Clamp(Math.Round(analysis.UrgencyScore, MidpointRounding.AwayFromZero), 0, 2);
    }

    public static bool ShowPiiWarning(MeetingJevAnalysis analysis) =>
        analysis.PiiRisk >= PiiWarningThreshold;

    public static bool ShowFaithfulWarning(MeetingJevAnalysis analysis) =>
        analysis.SummaryFaithful is { } faithful && faithful < UnfaithfulThreshold;

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
