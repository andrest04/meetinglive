namespace MeetingLive.Core.Services;

/// <summary>Result of running an external CLI process to completion.</summary>
public sealed record CliProcessResult(int ExitCode, string StandardOutput, string StandardError);

/// <summary>
/// Thin abstraction over <see cref="System.Diagnostics.Process"/> for invoking external CLI
/// tools (Claude Code, Codex) as summary providers — the seam that lets
/// <see cref="ClaudeCodeCliSummaryProvider"/>/<see cref="CodexCliSummaryProvider"/> and
/// <c>CliProviderResolver</c> (App layer) be tested without actually spawning a CLI.
/// </summary>
public interface ICliProcessRunner
{
    /// <summary>True if <paramref name="fileName"/> resolves to an executable on the current PATH.</summary>
    bool IsOnPath(string fileName);

    /// <summary>
    /// Runs <paramref name="fileName"/> with <paramref name="arguments"/>, writes
    /// <paramref name="stdin"/> to its standard input (when not null) and closes it, then
    /// waits for exit. Throws <see cref="TimeoutException"/> and kills the process if it
    /// hasn't exited within <paramref name="timeout"/>.
    /// </summary>
    Task<CliProcessResult> RunAsync(
        string fileName,
        string arguments,
        string? stdin,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);
}
