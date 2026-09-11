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
}
