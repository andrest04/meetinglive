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

    [Theory]
    [InlineData("not logged in", CliFailureKind.NotSignedIn, "session expired")]
    [InlineData("subscription expired", CliFailureKind.SubscriptionInactive, "subscription")]
    [InlineData("command not found", CliFailureKind.NotInstalled, "not installed")]
    [InlineData("request timed out", CliFailureKind.TimedOut, "took too long")]
    [InlineData("model crashed mysteriously", CliFailureKind.Unknown, "could not finish")]
    public async Task SummarizeAsync_WhenCliFails_ThrowsClassifiedCliToolException(
        string stderr, CliFailureKind expectedKind, string expectedPhrase)
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, stderr));
        var provider = new CodexCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Equal(expectedKind, exception.Kind);
        Assert.Equal(CliFailureMapper.CodexDisplayName, exception.ProviderDisplayName);
        Assert.Contains(expectedPhrase, exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SummarizeAsync_WhenStandardOutputIsEmpty_ThrowsCliToolExceptionEmptyOutput()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var provider = new CodexCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Equal(CliFailureKind.EmptyOutput, exception.Kind);
        Assert.Equal(CliFailureMapper.CodexDisplayName, exception.ProviderDisplayName);
    }
}
