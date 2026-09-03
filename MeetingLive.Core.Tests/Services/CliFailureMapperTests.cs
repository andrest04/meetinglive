using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CliFailureMapperTests
{
    [Theory]
    [InlineData(1, "", "not logged in", CliFailureKind.NotSignedIn)]
    [InlineData(1, "Please sign in", "", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "session expired", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "token expired", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "unauthorized", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "HTTP 401", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "please run claude login", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "oauth error", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "Not Logged In", CliFailureKind.NotSignedIn)]
    [InlineData(1, "", "subscription expired", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "payment required", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "HTTP 402", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "quota exceeded", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "billing problem", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "plan expired", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "403 payment required", CliFailureKind.SubscriptionInactive)]
    [InlineData(1, "", "The system cannot find the file specified", CliFailureKind.NotInstalled)]
    [InlineData(1, "", "ENOENT", CliFailureKind.NotInstalled)]
    [InlineData(1, "", "command not found", CliFailureKind.NotInstalled)]
    [InlineData(1, "", "cannot find claude", CliFailureKind.NotInstalled)]
    [InlineData(1, "", "request timed out", CliFailureKind.TimedOut)]
    [InlineData(1, "", "timeout waiting", CliFailureKind.TimedOut)]
    [InlineData(0, "", "", CliFailureKind.EmptyOutput)]
    [InlineData(0, "   ", "", CliFailureKind.EmptyOutput)]
    [InlineData(1, "", "model crashed mysteriously", CliFailureKind.Unknown)]
    [InlineData(1, "", "403 forbidden", CliFailureKind.Unknown)]
    public void Classify_ExitCodeAndStreams_ReturnsExpectedKind(
        int exitCode, string stdout, string stderr, CliFailureKind expected)
    {
        Assert.Equal(expected, CliFailureMapper.Classify(exitCode, stdout, stderr));
    }

    [Fact]
    public void Classify_WhenNotOnPath_ReturnsNotInstalled()
    {
        Assert.Equal(CliFailureKind.NotInstalled, CliFailureMapper.Classify(0, "ok", "", isOnPath: false));
    }

    [Fact]
    public void Classify_CredentialsText_IsNotSubscriptionInactive()
    {
        Assert.Equal(CliFailureKind.Unknown, CliFailureMapper.Classify(1, "", "invalid credentials"));
    }

    [Fact]
    public void Classify_TimeoutException_ReturnsTimedOut()
    {
        Assert.Equal(CliFailureKind.TimedOut, CliFailureMapper.Classify(new TimeoutException("waited too long")));
    }

    [Fact]
    public void Classify_FileNotFoundException_ReturnsNotInstalled()
    {
        Assert.Equal(CliFailureKind.NotInstalled, CliFailureMapper.Classify(new FileNotFoundException("missing", "claude")));
    }

    [Fact]
    public void Create_NotSignedIn_UsesFriendlyTextWithoutExitCode()
    {
        var exception = CliFailureMapper.Create("Claude Code", 1, "", "not logged in");

        Assert.Equal(CliFailureKind.NotSignedIn, exception.Kind);
        Assert.Equal("Claude Code", exception.ProviderDisplayName);
        Assert.Contains("session expired", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("not logged in", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Create_Unknown_IncludesSanitizedSnippetWithoutSecretsOrExitCode()
    {
        var exception = CliFailureMapper.Create(
            "Codex",
            1,
            "",
            "fatal: Bearer sk-secret1234abc boom and then a very long explanation that should be truncated because it is far longer than one hundred twenty characters of stderr");

        Assert.Equal(CliFailureKind.Unknown, exception.Kind);
        Assert.Equal("Codex", exception.ProviderDisplayName);
        Assert.StartsWith("Codex could not finish the summary.", exception.Message);
        Assert.DoesNotContain("exited with code", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("sk-secret", exception.Message);
        Assert.Contains("[redacted]", exception.Message);
        Assert.True(exception.Detail!.Length <= 121);
    }

    [Fact]
    public void Wrap_TimeoutException_ReturnsTimedOut()
    {
        var wrapped = CliFailureMapper.Wrap("Claude Code", new TimeoutException("'claude' did not exit within 00:05:00."));

        Assert.Equal(CliFailureKind.TimedOut, wrapped.Kind);
        Assert.Contains("took too long", wrapped.Message, StringComparison.OrdinalIgnoreCase);
        Assert.IsType<TimeoutException>(wrapped.InnerException);
    }
}
