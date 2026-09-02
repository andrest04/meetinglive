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
