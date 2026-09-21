namespace MeetingLive.Core.Models;

/// <summary>Typed Jev judgments for one meeting. Raw probabilities; the UI applies confidence gates.</summary>
public sealed class MeetingJevAnalysis
{
    public string? MeetingType { get; set; }

    public double? MeetingTypeConfidence { get; set; }

    public string? SpokenLanguage { get; set; }

    public double UrgencyScore { get; set; }

    public double? UrgencyConfidence { get; set; }

    public double ContainsDecisions { get; set; }

    public double ContainsCommitments { get; set; }

    public double PiiRisk { get; set; }

    public double? SummaryFaithful { get; set; }

    public string? SuggestedFolderId { get; set; }

    public double? FolderConfidence { get; set; }

    public IReadOnlyList<ActionItemVerdict> ActionItems { get; set; } = [];

    public string Model { get; set; } = "";

    public DateTimeOffset AnalyzedAt { get; set; }
}

public sealed class ActionItemVerdict
{
    public string Text { get; set; } = "";

    public string Relation { get; set; } = "";

    public double? Confidence { get; set; }
}
