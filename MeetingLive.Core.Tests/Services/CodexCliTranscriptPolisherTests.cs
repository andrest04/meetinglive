using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class CodexCliTranscriptPolisherTests
{
    [Fact]
    public async Task PolishAsync_OnSuccess_InvokesCodexExecDash_AndReturnsStdout()
    {
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("codex", fileName);
            Assert.Equal("exec -", arguments);
            Assert.Contains("<transcript>", stdin);
            Assert.Contains("[00:00:01 | 15:00] hola onu", stdin);

            return new CliProcessResult(0, "[00:00:01 | 15:00] Hola, ONU.", string.Empty);
        });
        var polisher = new CodexCliTranscriptPolisher(runner);

        var result = await polisher.PolishAsync("[00:00:01 | 15:00] hola onu", "es");

        Assert.Equal("[00:00:01 | 15:00] Hola, ONU.", result);
    }

    [Fact]
    public async Task PolishAsync_WhenNotLoggedIn_ThrowsCliToolExceptionNotSignedIn()
    {
        var runner = new FakeCliProcessRunner((_, _, _) =>
            new CliProcessResult(1, string.Empty, "not logged in"));
        var polisher = new CodexCliTranscriptPolisher(runner);

        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => polisher.PolishAsync("transcript", "es"));

        Assert.Equal(CliFailureKind.NotSignedIn, exception.Kind);
        Assert.Equal(CliFailureMapper.CodexDisplayName, exception.ProviderDisplayName);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
    }
}
