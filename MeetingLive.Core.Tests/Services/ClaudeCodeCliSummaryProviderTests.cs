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
            Assert.Contains("<transcript>", stdin);
            Assert.Contains("Hello everyone.", stdin);
            Assert.Contains("in Spanish", stdin);
            Assert.Contains("Do not invent", stdin);
            Assert.Contains("### Qué fue esto", stdin);
            Assert.Contains("### Puntos clave", stdin);
            Assert.Contains("### Decisiones", stdin);
            Assert.Contains("### Preguntas abiertas", stdin);
            Assert.DoesNotContain("### What this was", stdin);

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
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Equal(expectedKind, exception.Kind);
        Assert.Equal(CliFailureMapper.ClaudeCodeDisplayName, exception.ProviderDisplayName);
        Assert.Contains(expectedPhrase, exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SummarizeAsync_WhenStandardOutputIsEmpty_ThrowsCliToolExceptionEmptyOutput()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Equal(CliFailureKind.EmptyOutput, exception.Kind);
        Assert.Equal(CliFailureMapper.ClaudeCodeDisplayName, exception.ProviderDisplayName);
    }

    [Fact]
    public async Task SummarizeAsync_WhenOutputLanguageIsEnglish_AsksForEnglish()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            stdinCaptured = stdin;
            return new CliProcessResult(0, "## Summary\n\nHello.\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow, outputLanguage: "en");

        Assert.Contains("in English", stdinCaptured);
        Assert.Contains("### What this was", stdinCaptured);
        Assert.Contains("### Decisions", stdinCaptured);
        Assert.DoesNotContain("### Qué fue esto", stdinCaptured);
    }

    [Fact]
    public async Task SummarizeAsync_WhenOutputLanguageIsSpanish_UsesSpanishSubheadings()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            stdinCaptured = stdin;
            return new CliProcessResult(0, "## Summary\n\nHola.\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        await provider.SummarizeAsync("Hola a todos.", "Kickoff", DateTimeOffset.UtcNow, outputLanguage: "es");

        Assert.Contains("in Spanish", stdinCaptured);
        Assert.Contains("### Qué fue esto", stdinCaptured);
        Assert.Contains("### Decisiones", stdinCaptured);
        Assert.DoesNotContain("### What this was", stdinCaptured);
    }
}
