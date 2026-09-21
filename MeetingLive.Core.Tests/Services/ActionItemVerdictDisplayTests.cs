using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ActionItemVerdictDisplayTests
{
    [Fact]
    public void Match_ByExactText_ReturnsVerdict()
    {
        var verdicts = new[]
        {
            new ActionItemVerdict { Text = "Ana files the bug", Relation = "supports", Confidence = 0.9 },
            new ActionItemVerdict { Text = "Ship Friday", Relation = "contradicts", Confidence = 0.4 },
        };

        var match = ActionItemVerdictDisplay.Match(verdicts, "Ship Friday");

        Assert.NotNull(match);
        Assert.Equal("contradicts", match.Relation);
    }

    [Fact]
    public void CaptionKind_WhenNoVerdict_IsNone()
    {
        Assert.Equal(ActionItemVerdictCaptionKind.None, ActionItemVerdictDisplay.CaptionKind(null));
    }

    [Fact]
    public void CaptionKind_SupportsAboveAutoAccept_IsVerified()
    {
        var verdict = new ActionItemVerdict
        {
            Text = "Ana files the bug",
            Relation = "supports",
            Confidence = MeetingJevAnalyzer.AutoAcceptConfidence,
        };

        Assert.Equal(ActionItemVerdictCaptionKind.Verified, ActionItemVerdictDisplay.CaptionKind(verdict));
    }

    [Fact]
    public void CaptionKind_SupportsBelowAutoAccept_IsNeedsReview()
    {
        var verdict = new ActionItemVerdict
        {
            Text = "Ana files the bug",
            Relation = "supports",
            Confidence = 0.79,
        };

        Assert.Equal(ActionItemVerdictCaptionKind.NeedsReview, ActionItemVerdictDisplay.CaptionKind(verdict));
    }

    [Theory]
    [InlineData(0.1)]
    [InlineData(0.9)]
    public void CaptionKind_ContradictsAnyConfidence_IsConflicts(double confidence)
    {
        var verdict = new ActionItemVerdict
        {
            Text = "Ship Friday",
            Relation = "contradicts",
            Confidence = confidence,
        };

        Assert.Equal(ActionItemVerdictCaptionKind.Conflicts, ActionItemVerdictDisplay.CaptionKind(verdict));
    }

    [Fact]
    public void CaptionKind_SaysNothing_IsNeedsReview()
    {
        var verdict = new ActionItemVerdict
        {
            Text = "Maybe later",
            Relation = "says_nothing",
            Confidence = 0.95,
        };

        Assert.Equal(ActionItemVerdictCaptionKind.NeedsReview, ActionItemVerdictDisplay.CaptionKind(verdict));
    }
}
