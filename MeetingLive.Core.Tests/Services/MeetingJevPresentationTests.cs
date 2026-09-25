using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevPresentationTests
{
    [Fact]
    public void FilterOutContradicted_WhenVerdictContradictsWithHighConfidence_RemovesItem()
    {
        var actionItems = new[]
        {
            new ActionItem { Text = "Ana files the bug" },
            new ActionItem { Text = "Ship the patch" },
        };
        var verdicts = new[]
        {
            new ActionItemVerdict
            {
                Text = "Ana files the bug",
                Relation = "contradicts",
                Confidence = MeetingJevAnalyzer.AutoAcceptConfidence,
            },
        };

        var result = MeetingJevPresentation.FilterOutContradicted(actionItems, verdicts);

        Assert.Single(result);
        Assert.Equal("Ship the patch", result[0].Text);
    }

    [Fact]
    public void FilterOutContradicted_WhenContradictionConfidenceLow_KeepsItem()
    {
        var actionItems = new[] { new ActionItem { Text = "Ana files the bug" } };
        var verdicts = new[]
        {
            new ActionItemVerdict { Text = "Ana files the bug", Relation = "contradicts", Confidence = 0.5 },
        };

        var result = MeetingJevPresentation.FilterOutContradicted(actionItems, verdicts);

        Assert.Same(actionItems, result);
    }

    [Theory]
    [InlineData("supports")]
    [InlineData("says_nothing")]
    public void FilterOutContradicted_WhenVerdictNotContradicts_KeepsItem(string relation)
    {
        var actionItems = new[] { new ActionItem { Text = "Ana files the bug" } };
        var verdicts = new[]
        {
            new ActionItemVerdict
            {
                Text = "Ana files the bug",
                Relation = relation,
                Confidence = MeetingJevAnalyzer.AutoAcceptConfidence,
            },
        };

        var result = MeetingJevPresentation.FilterOutContradicted(actionItems, verdicts);

        Assert.Same(actionItems, result);
    }

    [Fact]
    public void FilterOutContradicted_WhenNoVerdicts_ReturnsSameList()
    {
        var actionItems = new[] { new ActionItem { Text = "Ana files the bug" } };

        var result = MeetingJevPresentation.FilterOutContradicted(actionItems, []);

        Assert.Same(actionItems, result);
    }

    [Fact]
    public void TryGetSuggestedFolderId_WhenGuidAndConfidentAndDifferent_ReturnsTrue()
    {
        var folderId = Guid.NewGuid();
        var analysis = new MeetingJevAnalysis
        {
            SuggestedFolderId = folderId.ToString("D"),
            FolderConfidence = MeetingJevAnalyzer.AutoAcceptConfidence,
        };

        Assert.True(MeetingJevPresentation.TryGetSuggestedFolderId(analysis, currentFolderId: null, out var parsed));
        Assert.Equal(folderId, parsed);
    }

    [Theory]
    [InlineData("inbox")]
    [InlineData("none")]
    public void TryGetSuggestedFolderId_WhenInboxOrNone_ReturnsFalse(string suggested)
    {
        var analysis = new MeetingJevAnalysis
        {
            SuggestedFolderId = suggested,
            FolderConfidence = 0.99,
        };

        Assert.False(MeetingJevPresentation.TryGetSuggestedFolderId(analysis, currentFolderId: null, out _));
    }

    [Fact]
    public void TryGetSuggestedFolderId_WhenSameAsCurrent_ReturnsFalse()
    {
        var folderId = Guid.NewGuid();
        var analysis = new MeetingJevAnalysis
        {
            SuggestedFolderId = folderId.ToString("D"),
            FolderConfidence = 0.99,
        };

        Assert.False(MeetingJevPresentation.TryGetSuggestedFolderId(analysis, folderId, out _));
    }
}
