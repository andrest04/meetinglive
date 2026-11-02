using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CliProcessRunnerTests
{
    [Fact]
    public void IsOnPath_ForAnExecutableKnownToBeOnPath_ReturnsTrue()
    {
        // dotnet itself must be on PATH for this test project to have been run at all.
        var runner = new CliProcessRunner();

        Assert.True(runner.IsOnPath("dotnet"));
    }

    [Fact]
    public void IsOnPath_ForANonExistentExecutable_ReturnsFalse()
    {
        var runner = new CliProcessRunner();

        Assert.False(runner.IsOnPath("this-executable-definitely-does-not-exist-anywhere"));
    }

    [Fact]
    public async Task RunAsync_CapturesExitCodeAndStandardOutput()
    {
        var runner = new CliProcessRunner();

        var result = await runner.RunAsync("cmd.exe", "/c echo hello", stdin: null, timeout: TimeSpan.FromSeconds(10));

        Assert.Equal(0, result.ExitCode);
        Assert.Contains("hello", result.StandardOutput);
    }

    [Fact]
    public async Task RunAsync_WritesStdinToTheProcess()
    {
        var runner = new CliProcessRunner();

        var result = await runner.RunAsync("cmd.exe", "/c more", "piped input", TimeSpan.FromSeconds(10));

        Assert.Equal(0, result.ExitCode);
        Assert.Contains("piped input", result.StandardOutput);
    }

    [Fact]
    public async Task RunAsync_RoundtripsSpanishUtf8ThroughStdinAndStdout()
    {
        var runner = new CliProcessRunner();
        const string spanish = "niño cañón reunión";

        var result = await runner.RunAsync(
            "powershell.exe",
            "-NoProfile -Command [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; [Console]::Out.Write([Console]::In.ReadToEnd())",
            spanish,
            TimeSpan.FromSeconds(15));

        Assert.Equal(0, result.ExitCode);
        Assert.Contains("niño", result.StandardOutput);
        Assert.Contains("cañón", result.StandardOutput);
        Assert.Contains("reunión", result.StandardOutput);
        Assert.DoesNotContain("niÃ±o", result.StandardOutput);
        Assert.DoesNotContain("reuniÃ³n", result.StandardOutput);
    }

    [Fact]
    public async Task RunAsync_WhenExecutableIsMissing_ThrowsFileNotFoundException()
    {
        var runner = new CliProcessRunner();

        await Assert.ThrowsAsync<FileNotFoundException>(
            () => runner.RunAsync(
                "this-executable-definitely-does-not-exist-anywhere",
                arguments: "",
                stdin: null,
                timeout: TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task RunAsync_WhenProcessExceedsTimeout_ThrowsTimeoutException()
    {
        var runner = new CliProcessRunner();

        await Assert.ThrowsAsync<TimeoutException>(
            () => runner.RunAsync("cmd.exe", "/c ping -n 6 127.0.0.1 >nul", stdin: null, timeout: TimeSpan.FromMilliseconds(200)));
    }

    private static readonly string LargeStdin = new('x', 1024 * 1024);
    private static readonly TimeSpan HangGuard = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task RunAsync_WhenChildExitsWithAFailureWithoutReadingStdin_ReportsItsExitCodeAndStderr()
    {
        var runner = new CliProcessRunner();

        var result = await runner.RunAsync(
            "cmd.exe",
            "/c \"echo not logged in 1>&2 & exit /b 3\"",
            LargeStdin,
            TimeSpan.FromSeconds(20)).WaitAsync(HangGuard);

        Assert.Equal(3, result.ExitCode);
        Assert.Contains("not logged in", result.StandardError);
    }

    [Fact]
    public async Task RunRequiredStdoutAsync_WhenChildExitsEarlyWithAuthFailure_ClassifiesTheRealFailure()
    {
        var exception = await Assert.ThrowsAsync<CliToolException>(
            () => CliFailureMapper.RunRequiredStdoutAsync(
                new CliProcessRunner(),
                "cmd",
                "/c \"echo not logged in 1>&2 & exit /b 3\"",
                LargeStdin,
                TimeSpan.FromSeconds(20),
                CliFailureMapper.ClaudeCodeDisplayName,
                CancellationToken.None).WaitAsync(HangGuard));

        Assert.Equal(CliFailureKind.NotSignedIn, exception.Kind);
    }

    [Fact]
    public async Task RunAsync_WhenChildSucceedsWithoutReadingAllStdin_DoesNotReportSuccess()
    {
        var runner = new CliProcessRunner();

        var exception = await Assert.ThrowsAsync<IOException>(
            () => runner.RunAsync("cmd.exe", "/c exit /b 0", LargeStdin, TimeSpan.FromSeconds(20)).WaitAsync(HangGuard));

        Assert.Contains("before reading all of its input", exception.Message);
    }

    [Fact]
    public async Task RunAsync_WhenChildEchoesWhileReading_DoesNotDeadlockOnFullPipes()
    {
        var runner = new CliProcessRunner();
        var lines = string.Join('\n', Enumerable.Range(0, 100_000).Select(i => $"line {i}")) + "\n";

        var run = runner.RunAsync("findstr.exe", "\"^\"", lines, TimeSpan.FromSeconds(25));
        var winner = await Task.WhenAny(run, Task.Delay(HangGuard));

        Assert.Same(run, winner);
        var result = await run;
        Assert.Equal(0, result.ExitCode);
        Assert.Contains("line 99999", result.StandardOutput);
    }

    [Fact]
    public async Task RunAsync_WhenChildHangsWithoutReadingStdin_TimesOutAndKillsIt()
    {
        var runner = new CliProcessRunner();
        var marker = Path.Combine(Path.GetTempPath(), $"meetinglive-cli-{Guid.NewGuid():N}.txt");

        var run = runner.RunAsync(
            "cmd.exe",
            $"/c \"ping -n 30 127.0.0.1 > \"{marker}\"\"",
            LargeStdin,
            TimeSpan.FromSeconds(3));
        var winner = await Task.WhenAny(run, Task.Delay(HangGuard));

        Assert.Same(run, winner);
        await Assert.ThrowsAsync<TimeoutException>(() => run);

        // The redirected file stays locked until the child is really gone.
        Assert.True(File.Exists(marker));
        Assert.True(await TryDeleteWithinAsync(marker, TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task RunAsync_WhenCallerCancelsWhileStdinIsBlocked_ThrowsCancellation()
    {
        var runner = new CliProcessRunner();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));

        var run = runner.RunAsync("ping.exe", "-n 30 127.0.0.1", LargeStdin, TimeSpan.FromSeconds(25), cts.Token);
        var winner = await Task.WhenAny(run, Task.Delay(HangGuard));

        Assert.Same(run, winner);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run);
    }

    private static async Task<bool> TryDeleteWithinAsync(string path, TimeSpan limit)
    {
        var deadline = DateTime.UtcNow + limit;
        while (true)
        {
            try
            {
                File.Delete(path);
                return true;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (DateTime.UtcNow > deadline)
                    return false;

                await Task.Delay(100);
            }
        }
    }
}
