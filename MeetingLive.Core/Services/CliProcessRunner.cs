using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace MeetingLive.Core.Services;

/// <inheritdoc cref="ICliProcessRunner"/>
public sealed class CliProcessRunner : ICliProcessRunner
{
    public bool IsOnPath(string fileName)
    {
        var pathVariable = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT").Split(';')
            : [string.Empty];

        foreach (var directory in pathVariable.Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(directory))
                continue;

            foreach (var extension in extensions)
            {
                var candidate = Path.Combine(directory, fileName + extension);
                if (File.Exists(candidate))
                    return true;
            }
        }

        return false;
    }

    public async Task<CliProcessResult> RunAsync(
        string fileName,
        string arguments,
        string? stdin,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            RedirectStandardInput = stdin is not null,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (stdin is not null)
            startInfo.StandardInputEncoding = Encoding.UTF8;

        using var process = new Process { StartInfo = startInfo };

        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            process.Start();
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode is 2 or 3)
        {
            throw new FileNotFoundException($"The executable '{fileName}' was not found.", fileName, ex);
        }

        // All pipes run at once: a child can block writing output until someone reads it, and it
        // can stop reading a prompt far larger than the pipe buffer. The timeout covers all of them.
        var stdoutTask = process.StandardOutput.ReadToEndAsync(linkedCts.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(linkedCts.Token);
        var stdinTask = stdin is null
            ? Task.FromResult(true)
            : WriteStdinAsync(process.StandardInput, stdin, linkedCts.Token);
        var completion = Task.WhenAll(stdoutTask, stderrTask, stdinTask, process.WaitForExitAsync(linkedCts.Token));

        try
        {
            // WaitAsync returns at the deadline even if a blocked pipe call ignores its token.
            await completion.WaitAsync(linkedCts.Token);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            _ = completion.ContinueWith(static task => _ = task.Exception, TaskScheduler.Default);

            if (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
                throw new TimeoutException($"'{fileName}' did not exit within {timeout}.");

            throw;
        }

        // A failing child reports through its exit code and stderr. Exit 0 with a prompt it did
        // not take in fully is not a success: its output may answer only part of the prompt.
        if (!await stdinTask && process.ExitCode == 0)
            throw new IOException($"'{fileName}' exited before reading all of its input.");

        return new CliProcessResult(process.ExitCode, await stdoutTask, await stderrTask);
    }

    /// <summary>Returns whether the whole input was delivered. A pipe the child closed is an
    /// outcome here, not an error, so the child's own exit code and stderr can explain it.</summary>
    private static async Task<bool> WriteStdinAsync(StreamWriter writer, string stdin, CancellationToken cancellationToken)
    {
        bool delivered;
        try
        {
            await writer.WriteAsync(stdin.AsMemory(), cancellationToken);
            await writer.FlushAsync(cancellationToken);
            delivered = true;
        }
        catch (OperationCanceledException)
        {
            // The caller kills the child. Closing here could block on a full pipe.
            return false;
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            delivered = false;
        }

        try
        {
            writer.Close();
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            delivered = false;
        }

        return delivered;
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best-effort — the process may have already exited between the check and the kill.
        }
    }
}
