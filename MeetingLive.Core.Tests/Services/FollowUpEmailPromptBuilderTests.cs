using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class FollowUpEmailPromptBuilderTests
{
    [Fact]
    public void Build_UsesDisplayNamesAndSources_AndDoesNotInventAnAddress()
    {
        var prompt = FollowUpEmailPromptBuilder.Build(
            "We left the contract open.",
            [new ActionItem { Text = "Send the revised contract", IsDone = false }],
            "Mention the Friday review.",
            ["Ada Lovelace"]);

        Assert.Contains("Ada Lovelace", prompt, StringComparison.Ordinal);
        Assert.Contains("We left the contract open.", prompt, StringComparison.Ordinal);
        Assert.Contains("Send the revised contract", prompt, StringComparison.Ordinal);
        Assert.Contains("Mention the Friday review.", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not invent email addresses", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not emit a mailto link", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("@", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("mailto:", prompt, StringComparison.Ordinal);
    }
}
