using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingBriefPromptBuilderTests
{
    [Fact]
    public void HasUsefulContext_WhenNoPriorMeetingAgendaOrAttendees_IsFalse()
    {
        var useful = MeetingBriefPromptBuilder.HasUsefulContext([], agenda: null, attendees: []);

        Assert.False(useful);
    }

    [Theory]
    [InlineData("Review the API")]
    [InlineData("  agenda  ")]
    public void HasUsefulContext_WhenAgendaPresent_IsTrue(string agenda)
    {
        Assert.True(MeetingBriefPromptBuilder.HasUsefulContext([], agenda, []));
    }

    [Fact]
    public void HasUsefulContext_WhenAttendeePresent_IsTrue()
    {
        Assert.True(MeetingBriefPromptBuilder.HasUsefulContext([], agenda: " ", attendees: ["Ada Lovelace"]));
    }

    [Fact]
    public void HasUsefulContext_WhenPriorMeetingPresent_IsTrue()
    {
        var prior = new MeetingRecord
        {
            Id = Guid.NewGuid(),
            Title = "Standup",
            RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
            AudioFilePath = string.Empty,
        };

        Assert.True(MeetingBriefPromptBuilder.HasUsefulContext([prior], agenda: null, attendees: null));
    }

    [Fact]
    public void Build_IncludesSubjectAttendeesAgendaAndPriorSources_WithoutInventingMail()
    {
        var prior = new MeetingRecord
        {
            Id = Guid.NewGuid(),
            Title = "API review",
            RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
            AudioFilePath = string.Empty,
            Summary = "Left the contract open.",
            Notes = "Ask Grace about pagination.",
            ActionItems = [new ActionItem { Text = "Send the revised contract", IsDone = false }],
        };

        var prompt = MeetingBriefPromptBuilder.Build(
            "API review",
            ["Ada Lovelace"],
            "Walk the open questions.",
            [prior]);

        Assert.Contains("Ada Lovelace", prompt, StringComparison.Ordinal);
        Assert.Contains("Walk the open questions.", prompt, StringComparison.Ordinal);
        Assert.Contains("Left the contract open.", prompt, StringComparison.Ordinal);
        Assert.Contains("Ask Grace about pagination.", prompt, StringComparison.Ordinal);
        Assert.Contains("Send the revised contract", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not invent email addresses", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("@", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("mailto:", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_CapsPriorMeetingsAtThree()
    {
        var priors = Enumerable.Range(1, 4).Select(index => new MeetingRecord
        {
            Id = Guid.NewGuid(),
            Title = "Series",
            RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
            AudioFilePath = string.Empty,
            Summary = $"summary-marker-{index}",
        }).ToArray();

        var prompt = MeetingBriefPromptBuilder.Build("Series", [], null, priors);

        Assert.Contains("summary-marker-1", prompt, StringComparison.Ordinal);
        Assert.Contains("summary-marker-3", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("summary-marker-4", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("NONE")]
    [InlineData("none")]
    public void Normalize_WhenEmptyOrNone_ReturnsNull(string? raw)
    {
        Assert.Null(MeetingBriefPromptBuilder.Normalize(raw));
    }
}
