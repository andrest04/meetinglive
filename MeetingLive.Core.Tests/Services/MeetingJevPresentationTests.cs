using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevPresentationTests
{
    [Fact]
    public void ShowMeetingType_WhenConfidenceAtLeastAutoAccept_IsTrue()
    {
        var analysis = new MeetingJevAnalysis
        {
            MeetingType = "standup",
            MeetingTypeConfidence = MeetingJevAnalyzer.AutoAcceptConfidence,
        };

        Assert.True(MeetingJevPresentation.ShowMeetingType(analysis));
    }

    [Fact]
    public void ShowMeetingType_WhenConfidenceLow_IsFalse()
    {
        var analysis = new MeetingJevAnalysis
        {
            MeetingType = "standup",
            MeetingTypeConfidence = 0.5,
        };

        Assert.False(MeetingJevPresentation.ShowMeetingType(analysis));
    }

    [Theory]
    [InlineData(0.2, 0)]
    [InlineData(1.0, 1)]
    [InlineData(1.6, 2)]
    public void UrgencyLabelScore_WhenConfident_RoundsToBucket(double score, int expected)
    {
        var analysis = new MeetingJevAnalysis
        {
            UrgencyScore = score,
            UrgencyConfidence = MeetingJevAnalyzer.AutoAcceptConfidence,
        };

        Assert.Equal(expected, MeetingJevPresentation.UrgencyLabelScore(analysis));
    }

    [Fact]
    public void UrgencyLabelScore_WhenConfidenceLow_IsNull()
    {
        var analysis = new MeetingJevAnalysis
        {
            UrgencyScore = 2,
            UrgencyConfidence = 0.4,
        };

        Assert.Null(MeetingJevPresentation.UrgencyLabelScore(analysis));
    }

    [Fact]
    public void ShowPiiWarning_WhenAtLeastThreshold_IsTrue()
    {
        Assert.True(MeetingJevPresentation.ShowPiiWarning(new MeetingJevAnalysis { PiiRisk = 0.7 }));
        Assert.False(MeetingJevPresentation.ShowPiiWarning(new MeetingJevAnalysis { PiiRisk = 0.69 }));
    }

    [Fact]
    public void ShowFaithfulWarning_WhenPresentAndLow_IsTrue()
    {
        Assert.True(MeetingJevPresentation.ShowFaithfulWarning(new MeetingJevAnalysis { SummaryFaithful = 0.39 }));
        Assert.False(MeetingJevPresentation.ShowFaithfulWarning(new MeetingJevAnalysis { SummaryFaithful = 0.4 }));
        Assert.False(MeetingJevPresentation.ShowFaithfulWarning(new MeetingJevAnalysis { SummaryFaithful = null }));
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
