using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class CodexCliSummaryProviderTests
{
    [Fact]
    public async Task SummarizeAsync_OnSuccess_InvokesCodexExecDash_AndParsesResult()
    {
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("codex", fileName);
            Assert.Equal("exec -", arguments);
            Assert.Contains("<transcript>", stdin);
            Assert.Contains("Hello everyone.", stdin);

            return new CliProcessResult(0, """
                ## Summary

                Kickoff meeting.

                ## Action Items

                - [ ] Send the invite
                """, string.Empty);
        });

        var provider = new CodexCliSummaryProvider(runner);

        var result = await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow);

        Assert.Equal("Kickoff meeting.", result.SummaryMarkdown);
        Assert.Single(result.ActionItems);
        Assert.Equal("Send the invite", result.ActionItems[0].Text);
        Assert.Equal(CodexCliSummaryProvider.ProviderId, result.ProviderId);
    }

    [Fact]
    public async Task SummarizeAsync_WhenExitCodeIsNonZero_ThrowsWithStderr()
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, "not logged in"));
        var provider = new CodexCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Contains("not logged in", exception.Message);
    }

    [Fact]
    public async Task SummarizeAsync_WhenStandardOutputIsEmpty_Throws()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var provider = new CodexCliSummaryProvider(runner);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));
    }
}
