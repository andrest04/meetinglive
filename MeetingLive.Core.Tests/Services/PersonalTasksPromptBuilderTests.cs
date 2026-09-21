using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class PersonalTasksPromptBuilderTests
{
    [Fact]
    public void Build_WhenEvidenceEmpty_InstructsNoneAndSpanishByDefault()
    {
        var prompt = PersonalTasksPromptBuilder.Build([], topic: null);

        Assert.Contains("output NONE", prompt, StringComparison.Ordinal);
        Assert.Contains("## What you need to do", prompt, StringComparison.Ordinal);
        Assert.Contains("in Spanish", prompt, StringComparison.Ordinal);
        Assert.Contains("(none)", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("<topic>", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not invent", prompt, StringComparison.Ordinal);
        Assert.Contains("No extra chatter", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenEvidenceAndTopic_IncludesLinesAndEnglishWhenRequested()
    {
        var lines = new TranscriptLine[]
        {
            new("L001", 1, "Please send the TV1 deck tomorrow."),
        };

        var prompt = PersonalTasksPromptBuilder.Build(lines, "TV1", "en");

        Assert.Contains("Please send the TV1 deck tomorrow.", prompt, StringComparison.Ordinal);
        Assert.Contains("<topic>TV1</topic>", prompt, StringComparison.Ordinal);
        Assert.Contains("in English", prompt, StringComparison.Ordinal);
        Assert.Contains("- [ ]", prompt, StringComparison.Ordinal);
    }
}
