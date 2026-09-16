namespace MeetingLive.Core.Services;

/// <summary>
/// Template Method base for the CLI-backed summary/polisher providers
/// (<see cref="ClaudeCodeCliSummaryProvider"/>, <see cref="CodexCliSummaryProvider"/>,
/// <see cref="ClaudeCodeCliTranscriptPolisher"/>, <see cref="CodexCliTranscriptPolisher"/>).
/// All four ran the exact same steps — resolve executable, build arguments, run the process
/// via <see cref="ICliProcessRunner"/>, and map failures through
/// <see cref="CliFailureMapper.RunRequiredStdoutAsync"/> — and differed only in which CLI they
/// invoked and how its arguments were built. This base owns that shared plumbing once;
/// subclasses supply only <see cref="ExecutableName"/>, <see cref="Timeout"/>,
/// <see cref="Arguments"/>, and <see cref="ProviderDisplayName"/>.
/// </summary>
public abstract class CliToolProviderBase(ICliProcessRunner processRunner)
{
    /// <summary>The CLI executable to resolve on PATH and invoke, e.g. <c>"claude"</c>.</summary>
    protected abstract string ExecutableName { get; }

    /// <summary>How long to wait for the CLI process before it is killed as timed out.</summary>
    protected abstract TimeSpan Timeout { get; }

    /// <summary>The fixed, non-interactive argument string built from <see cref="CliInvocation"/>.</summary>
    protected abstract string Arguments { get; }

    /// <summary>User-facing CLI name used in mapped <see cref="CliToolException"/> messages.</summary>
    protected abstract string ProviderDisplayName { get; }

    /// <summary>
    /// Runs the CLI with <paramref name="prompt"/> piped over stdin and returns trimmed
    /// stdout, or throws a <see cref="CliToolException"/> classified by
    /// <see cref="CliFailureMapper"/>.
    /// </summary>
    protected Task<string> RunAsync(string prompt, CancellationToken cancellationToken) =>
        CliFailureMapper.RunRequiredStdoutAsync(
            processRunner,
            ExecutableName,
            Arguments,
            prompt,
            Timeout,
            ProviderDisplayName,
            cancellationToken);
}
