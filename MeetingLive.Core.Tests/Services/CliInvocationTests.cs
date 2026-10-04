using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CliInvocationTests
{
    [Fact]
    public void ClaudePrint_WhenUnset_IsBarePrintFlag()
    {
        Assert.Equal("-p", CliInvocation.ClaudePrint(null, null));
    }

    [Fact]
    public void ClaudePrint_WhenModelAndEffortSet_AppendsFlags()
    {
        Assert.Equal("-p --model sonnet --effort low", CliInvocation.ClaudePrint("sonnet", "low"));
    }

    [Fact]
    public void CodexExec_WhenUnset_IsStdinDash()
    {
        Assert.Equal("exec -", CliInvocation.CodexExec(null, null));
    }

    [Fact]
    public void CodexExec_WhenModelAndEffortSet_AppendsFlags()
    {
        Assert.Equal(
            "exec - -m gpt-5.6 -c model_reasoning_effort=\"low\"",
            CliInvocation.CodexExec("gpt-5.6", "low"));
    }

    [Fact]
    public void ClaudePrint_WhenWebSearchIsTrue_AppendsWebSearchToolFlags()
    {
        Assert.Equal(
            "-p --tools WebSearch --allowedTools WebSearch",
            CliInvocation.ClaudePrint(null, null, webSearch: true));
    }

    [Fact]
    public void ClaudePrint_WhenWebSearchAndModelSet_KeepsModelBeforeToolFlags()
    {
        Assert.Equal(
            "-p --model sonnet --effort low --tools WebSearch --allowedTools WebSearch",
            CliInvocation.ClaudePrint("sonnet", "low", webSearch: true));
    }

    [Fact]
    public void CodexExec_WhenWebSearchIsTrue_PrefixesTopLevelSearchFlag()
    {
        Assert.Equal("--search exec -", CliInvocation.CodexExec(null, null, webSearch: true));
    }

    [Fact]
    public void CodexExec_WhenWebSearchAndModelSet_KeepsExecArgumentsAfterSearchFlag()
    {
        Assert.Equal(
            "--search exec - -m gpt-5.6 -c model_reasoning_effort=\"low\"",
            CliInvocation.CodexExec("gpt-5.6", "low", webSearch: true));
    }
}
