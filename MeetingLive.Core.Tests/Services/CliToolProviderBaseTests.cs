using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

/// <summary>
/// Exercises the Template Method plumbing shared by the four CLI-backed providers
/// (<see cref="ClaudeCodeCliSummaryProvider"/>, <see cref="CodexCliSummaryProvider"/>,
/// <see cref="ClaudeCodeCliTranscriptPolisher"/>, <see cref="CodexCliTranscriptPolisher"/>)
/// directly against a minimal concrete subclass, since <see cref="CliToolProviderBase"/> is
/// abstract and has no public surface of its own.
/// </summary>
public class CliToolProviderBaseTests
{
    private sealed class FakeCliToolProvider(
        ICliProcessRunner processRunner,
        string executableName,
        TimeSpan timeout,
        string arguments,
        string providerDisplayName) : CliToolProviderBase(processRunner)
    {
        protected override string ExecutableName => executableName;
        protected override TimeSpan Timeout { get; } = timeout;
        protected override string Arguments { get; } = arguments;
        protected override string ProviderDisplayName => providerDisplayName;

        public Task<string> Invoke(string prompt, CancellationToken cancellationToken = default) =>
            RunAsync(prompt, cancellationToken);
    }

    [Fact]
    public async Task RunAsync_OnSuccess_InvokesConfiguredExecutableWithArgumentsAndStdin_AndReturnsTrimmedStdout()
    {
        var runner = new FakeCliProcessRunner((fileName, arguments, stdin) =>
        {
            Assert.Equal("some-cli", fileName);
            Assert.Equal("--flag value", arguments);
            Assert.Equal("the prompt", stdin);
            return new CliProcessResult(0, "  the answer  ", string.Empty);
        });
        var provider = new FakeCliToolProvider(runner, "some-cli", TimeSpan.FromMinutes(1), "--flag value", "Some CLI");

        var result = await provider.Invoke("the prompt");

        Assert.Equal("the answer", result);
    }

    [Fact]
    public async Task RunAsync_WhenExecutableIsNotOnPath_ThrowsCliToolExceptionNotInstalled_UsingProviderDisplayName()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "unused", string.Empty))
        {
            OnPathResult = false,
        };
        var provider = new FakeCliToolProvider(runner, "some-cli", TimeSpan.FromMinutes(1), "--flag", "Some CLI");

        var exception = await Assert.ThrowsAsync<CliToolException>(() => provider.Invoke("prompt"));

        Assert.Equal(CliFailureKind.NotInstalled, exception.Kind);
        Assert.Equal("Some CLI", exception.ProviderDisplayName);
    }

    [Fact]
    public async Task RunAsync_WhenCliExitsNonZero_ThrowsClassifiedCliToolException()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(1, string.Empty, "not logged in"));
        var provider = new FakeCliToolProvider(runner, "some-cli", TimeSpan.FromMinutes(1), "--flag", "Some CLI");

        var exception = await Assert.ThrowsAsync<CliToolException>(() => provider.Invoke("prompt"));

        Assert.Equal(CliFailureKind.NotSignedIn, exception.Kind);
        Assert.Equal("Some CLI", exception.ProviderDisplayName);
    }

    [Fact]
    public async Task RunAsync_WhenStandardOutputIsEmpty_ThrowsCliToolExceptionEmptyOutput()
    {
        var runner = new FakeCliProcessRunner((_, _, _) => new CliProcessResult(0, "   ", string.Empty));
        var provider = new FakeCliToolProvider(runner, "some-cli", TimeSpan.FromMinutes(1), "--flag", "Some CLI");

        var exception = await Assert.ThrowsAsync<CliToolException>(() => provider.Invoke("prompt"));

        Assert.Equal(CliFailureKind.EmptyOutput, exception.Kind);
    }
}
