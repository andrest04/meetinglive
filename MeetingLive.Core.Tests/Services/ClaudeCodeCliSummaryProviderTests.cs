using System.Globalization;
using MeetingLive.Core.Services;
using MeetingLive.Core.Strings;
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
            Assert.Equal("-p --model sonnet --effort low", arguments);
            Assert.Contains("<transcript>", stdin);
            Assert.Contains("Hello everyone.", stdin);
            Assert.Contains("in Spanish", stdin);
            Assert.Contains("Do not invent", stdin);
            Assert.Contains("## Title", stdin);
            Assert.Contains("exactly three Markdown sections", stdin);
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

        var provider = new ClaudeCodeCliSummaryProvider(runner, "sonnet", "low");

        var result = await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow);

        Assert.Equal("Kickoff meeting.", result.SummaryMarkdown);
        Assert.Single(result.ActionItems);
        Assert.Equal("Send the invite", result.ActionItems[0].Text);
        Assert.Equal(ClaudeCodeCliSummaryProvider.ProviderId, result.ProviderId);
        Assert.Null(result.SuggestedTitle);
    }

    [Fact]
    public async Task SummarizeAsync_WhenStdoutIncludesTitle_SetsSuggestedTitle()
    {
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            Assert.Contains("## Title", stdin);
            return new CliProcessResult(0, """
                ## Title

                Q3 planning with Ana

                ## Summary

                Kickoff meeting.

                ## Action Items

                - [ ] Send the invite
                """, string.Empty);
        });

        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var result = await provider.SummarizeAsync("Hello everyone.", "Meeting 11 Sep, 15:42", DateTimeOffset.UtcNow);

        Assert.Equal("Q3 planning with Ana", result.SuggestedTitle);
        Assert.Equal("Kickoff meeting.", result.SummaryMarkdown);
        Assert.DoesNotContain("Q3 planning with Ana", result.SummaryMarkdown, StringComparison.Ordinal);
        Assert.Single(result.ActionItems);
        Assert.Equal("Send the invite", result.ActionItems[0].Text);
        Assert.Equal(ClaudeCodeCliSummaryProvider.ProviderId, result.ProviderId);
    }

    [Theory]
    [InlineData("not logged in", CliFailureKind.NotSignedIn, "CliFailureNotSignedIn")]
    [InlineData("subscription expired", CliFailureKind.SubscriptionInactive, "CliFailureSubscriptionInactive")]
    [InlineData("command not found", CliFailureKind.NotInstalled, "CliFailureNotInstalled")]
    [InlineData("request timed out", CliFailureKind.TimedOut, "CliFailureTimedOut")]
    [InlineData("model crashed mysteriously", CliFailureKind.Unknown, "CliFailureUnknown")]
    public async Task SummarizeAsync_WhenCliFails_ThrowsClassifiedCliToolException(
        string stderr, CliFailureKind expectedKind, string expectedMessageKey)
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, stderr));
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => provider.SummarizeAsync("transcript", "title", DateTimeOffset.UtcNow));

        Assert.Equal(expectedKind, exception.Kind);
        Assert.Equal(CliFailureMapper.ClaudeCodeDisplayName, exception.ProviderDisplayName);
        Assert.Contains(
            CoreStrings.Format(expectedMessageKey, CliFailureMapper.ClaudeCodeDisplayName),
            exception.Message,
            StringComparison.Ordinal);
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
    public async Task SuggestTitleAsync_SendsTitleOnlyPrompt_AndReturnsNormalizedTitle()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("claude", fileName);
            Assert.Equal("-p", arguments);
            stdinCaptured = stdin;
            return new CliProcessResult(0, "Q3 planning with Ana\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var raw = await provider.SuggestTitleAsync(
            "We will plan Q3 with Ana.",
            DateTimeOffset.UtcNow,
            outputLanguage: "en");

        Assert.Equal("Q3 planning with Ana", SuggestedMeetingTitle.FromModelResponse(raw));
        Assert.Contains("ONLY a short title", stdinCaptured);
        Assert.Contains("<transcript>", stdinCaptured);
        Assert.Contains("<recorded_at>", stdinCaptured);
        Assert.Contains("We will plan Q3 with Ana.", stdinCaptured);
        Assert.Contains("in English", stdinCaptured);
        Assert.DoesNotContain("## Summary", stdinCaptured);
        Assert.DoesNotContain("Action Items", stdinCaptured);
        Assert.DoesNotContain("<meeting_title>", stdinCaptured);
        Assert.DoesNotContain("exactly three Markdown sections", stdinCaptured);
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

    [Fact]
    public async Task SummarizeAsync_WhenEndedAtIsPassed_IncludesEndedAtTagInStdin()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            stdinCaptured = stdin;
            return new CliProcessResult(0, "## Summary\n\nHello.\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        await provider.SummarizeAsync(
            "Hello everyone.",
            "Kickoff",
            DateTimeOffset.UtcNow,
            endedAt: endedAt);

        Assert.Contains(
            $"<ended_at>{endedAt.ToString("O", CultureInfo.InvariantCulture)}</ended_at>",
            stdinCaptured,
            StringComparison.Ordinal);
        Assert.Contains("Never write that the end time was not recorded", stdinCaptured, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SummarizeAsync_WhenEndedAtIsOmitted_DoesNotEmitEndedAtTag()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            stdinCaptured = stdin;
            return new CliProcessResult(0, "## Summary\n\nHello.\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow);

        Assert.DoesNotContain("</ended_at>", stdinCaptured, StringComparison.Ordinal);
        Assert.Contains("Never write that the end time was not recorded", stdinCaptured, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CompletePromptAsync_SendsPromptOnStdin()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("claude", fileName);
            Assert.Equal("-p", arguments);
            stdinCaptured = stdin;
            return new CliProcessResult(0, "## What you need to do\n\n- [ ] Send the deck\n", string.Empty);
        });
        var provider = new ClaudeCodeCliSummaryProvider(runner);

        var result = await provider.CompletePromptAsync("Write a checklist from evidence.");

        Assert.Equal("## What you need to do\n\n- [ ] Send the deck", result);
        Assert.Equal("Write a checklist from evidence.", stdinCaptured);
    }
}
