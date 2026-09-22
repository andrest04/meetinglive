using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ProjectPlanPromptBuilderTests
{
    [Fact]
    public void Build_UsesSources_AndDoesNotInventAnAddress()
    {
        var prompt = ProjectPlanPromptBuilder.Build(
            "Ship the contract.",
            [new ActionItem { Text = "Review the API", IsDone = false }],
            "Grace owns pagination.",
            ["Grace Hopper"]);

        Assert.Contains("Grace Hopper", prompt, StringComparison.Ordinal);
        Assert.Contains("Ship the contract.", prompt, StringComparison.Ordinal);
        Assert.Contains("Review the API", prompt, StringComparison.Ordinal);
        Assert.Contains("Grace owns pagination.", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not emit a mailto link", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("@", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("mailto:", prompt, StringComparison.Ordinal);
    }
}
