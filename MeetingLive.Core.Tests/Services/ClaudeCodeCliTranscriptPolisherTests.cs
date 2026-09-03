using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class ClaudeCodeCliTranscriptPolisherTests
{
    [Fact]
    public async Task PolishAsync_OnSuccess_InvokesClaudeWithPrompt_AndReturnsStdout()
    {
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("claude", fileName);
            Assert.Equal("-p", arguments);
            Assert.Contains("<transcript>", stdin);
            Assert.Contains("[00:00:01 | 15:00] hola onu", stdin);
            Assert.Contains("Return ONLY the polished transcript", stdin);
            Assert.Contains("in Spanish", stdin);
            Assert.DoesNotContain("## Summary", stdin);

            return new CliProcessResult(0, "[00:00:01 | 15:00] Hola, ONU.", string.Empty);
        });
        var polisher = new ClaudeCodeCliTranscriptPolisher(runner);

        var result = await polisher.PolishAsync("[00:00:01 | 15:00] hola onu", "es");

        Assert.Equal("[00:00:01 | 15:00] Hola, ONU.", result);
    }

    [Fact]
    public async Task PolishAsync_WhenNotLoggedIn_ThrowsCliToolExceptionNotSignedIn()
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, "not logged in"));
        var polisher = new ClaudeCodeCliTranscriptPolisher(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => polisher.PolishAsync("transcript", "es"));

        Assert.Equal(CliFailureKind.NotSignedIn, exception.Kind);
        Assert.Equal(CliFailureMapper.ClaudeCodeDisplayName, exception.ProviderDisplayName);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PolishAsync_WhenStandardOutputIsEmpty_ThrowsCliToolExceptionEmptyOutput()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var polisher = new ClaudeCodeCliTranscriptPolisher(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => polisher.PolishAsync("transcript", "es"));

        Assert.Equal(CliFailureKind.EmptyOutput, exception.Kind);
    }

    [Fact]
    public async Task PolishAsync_WhenLanguageIsEnglish_AsksForEnglish()
    {
        string? stdinCaptured = null;
        var runner = new FakeCliProcessRunner((_, _, stdin) =>
        {
            stdinCaptured = stdin;
            return new CliProcessResult(0, "Hello, NASA.", string.Empty);
        });
        var polisher = new ClaudeCodeCliTranscriptPolisher(runner);

        await polisher.PolishAsync("hello nasa", "en");

        Assert.Contains("in English", stdinCaptured);
        Assert.DoesNotContain("in Spanish", stdinCaptured);
    }
}
