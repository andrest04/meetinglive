using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class ClaudeCodeCliSummaryProviderTests
{
    [Fact]
    public async Task SummarizeAsync_OnSuccess_InvokesClaudeWithPromptPrompt_AndParsesResult()
    {
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("claude", fileName);
            Assert.Equal("-p", arguments);
            Assert.Contains("Transcript:", stdin);
            Assert.Contains("Hello everyone.", stdin);

            return new CliProcessResult(0, """
                ## Summary

                Kickoff meeting.

                ## Action Items

                - [ ] Send the invite
                """, string.Empty);
        });

        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var result = await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow);

        Assert.Equal("Kickoff meeting.", result.SummaryMarkdown);
        Assert.Single(result.ActionItems);
        Assert.Equal("Send the invite", result.ActionItems[0].Text);
        Assert.Equal(ClaudeCodeCliSummaryProvider.ProviderId, result.ProviderId);
    }

    [Fact]
    public async Task SummarizeAsync_WhenExitCodeIsNonZero_ThrowsWithStderr()
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, "not logged in"));
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Contains("not logged in", exception.Message);
    }

    [Fact]
    public async Task SummarizeAsync_WhenStandardOutputIsEmpty_Throws()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));
    }
}
