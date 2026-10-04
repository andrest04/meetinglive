using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveAnswerWebPolicyTests
{
    [Theory]
    [InlineData(SummaryProviderKind.ClaudeCode, true)]
    [InlineData(SummaryProviderKind.Codex, true)]
    [InlineData(SummaryProviderKind.Xai, false)]
    [InlineData(SummaryProviderKind.Local, false)]
    public void SupportsWebSearch_ByProviderKind(SummaryProviderKind kind, bool expected)
    {
        Assert.Equal(expected, LiveAnswerWebPolicy.SupportsWebSearch(kind));
    }

    [Theory]
    [InlineData(true, true, true, true)]
    [InlineData(true, true, false, true)]
    [InlineData(true, false, true, true)]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, true, false)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(false, false, false, false)]
    public void ShouldUseWeb_RequiresProviderSupportAndForcedOrJev(
        bool supports, bool forced, bool jev, bool expected)
    {
        Assert.Equal(expected, LiveAnswerWebPolicy.ShouldUseWeb(supports, forced, jev));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("  ", "\n\t")]
    public void BuildSessionContext_BlankInputs_ReturnsNull(string? title, string? brief)
    {
        Assert.Null(LiveAnswerWebPolicy.BuildSessionContext(title, brief));
    }

    [Fact]
    public void BuildSessionContext_TitleOnly_ReturnsMeetingLine()
    {
        Assert.Equal("Meeting: Weekly sync", LiveAnswerWebPolicy.BuildSessionContext("  Weekly sync ", null));
    }

    [Fact]
    public void BuildSessionContext_BriefOnly_ReturnsTrimmedBrief()
    {
        Assert.Equal("Intro to graph theory", LiveAnswerWebPolicy.BuildSessionContext(" ", "  Intro to graph theory\n"));
    }

    [Fact]
    public void BuildSessionContext_TitleAndBrief_JoinsBoth()
    {
        var result = LiveAnswerWebPolicy.BuildSessionContext("Algorithms 101", "Covers sorting.");

        Assert.NotNull(result);
        Assert.StartsWith("Meeting: Algorithms 101", result);
        Assert.EndsWith("Covers sorting.", result);
    }

    [Fact]
    public void BuildSessionContext_LongBrief_IsCapped()
    {
        var result = LiveAnswerWebPolicy.BuildSessionContext("T", new string('x', 5000));

        Assert.NotNull(result);
        Assert.True(result.Length <= LiveAnswerWebPolicy.MaxSessionContextChars);
    }
}
