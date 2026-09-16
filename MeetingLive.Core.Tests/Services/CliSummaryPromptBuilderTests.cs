using System.Globalization;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CliSummaryPromptBuilderTests
{
    [Fact]
    public void Build_WhenEndedAtIsSet_IncludesEndedAtTagAndNeverNotRecordedRule()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);

        var prompt = CliSummaryPromptBuilder.Build(
            "Kickoff",
            new DateTimeOffset(2026, 9, 2, 15, 0, 0, TimeSpan.Zero),
            "Recorded 2026-09-02 12:00\nEnded 2026-09-02 13:30\n[00:00:01 | 12:00] Hello",
            endedAt: endedAt);

        Assert.Contains(
            $"<ended_at>{endedAt.ToString("O", CultureInfo.InvariantCulture)}</ended_at>",
            prompt,
            StringComparison.Ordinal);
        Assert.Contains("Never write that the end time was not recorded", prompt, StringComparison.Ordinal);
        Assert.Contains("</ended_at>", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenEndedAtIsOmitted_DoesNotEmitEndedAtTag_AndKeepsNeverNotRecordedRule()
    {
        var prompt = CliSummaryPromptBuilder.Build(
            "Kickoff",
            new DateTimeOffset(2026, 9, 2, 15, 0, 0, TimeSpan.Zero),
            "[00:00:01 | 15:00] Hello");

        Assert.DoesNotContain("</ended_at>", prompt, StringComparison.Ordinal);
        Assert.Contains("Never write that the end time was not recorded", prompt, StringComparison.Ordinal);
        Assert.Contains("do not say \"not recorded\"", prompt, StringComparison.Ordinal);
    }
}
