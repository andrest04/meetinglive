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
}
