using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.TestHelpers;

/// <summary>
/// Minimal <see cref="ICliProcessRunner"/> test double — the seam
/// <c>ClaudeCodeCliSummaryProvider</c>/<c>CodexCliSummaryProvider</c> depend on, so their
/// tests never spawn a real CLI process.
/// </summary>
public sealed class FakeCliProcessRunner(Func<string, string, string?, CliProcessResult> respond) : ICliProcessRunner
{
    public string? LastFileName { get; private set; }
    public string? LastArguments { get; private set; }
    public string? LastStdin { get; private set; }
    public bool OnPathResult { get; set; } = true;

    public bool IsOnPath(string fileName) => OnPathResult;

    public Task<CliProcessResult> RunAsync(
        string fileName, string arguments, string? stdin, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        LastFileName = fileName;
        LastArguments = arguments;
        LastStdin = stdin;
        return Task.FromResult(respond(fileName, arguments, stdin));
    }
}
