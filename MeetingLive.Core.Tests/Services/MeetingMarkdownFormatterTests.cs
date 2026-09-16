using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingMarkdownFormatterTests
{
    [Fact]
    public void RenderThenParse_RoundtripsAllFields()
    {
        var id = Guid.NewGuid();
        var folderId = Guid.NewGuid();
        var recordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00.0000000+00:00");
        var endedAt = DateTimeOffset.Parse("2026-09-01T13:45:00.0000000+00:00");
        var record = new MeetingRecord
        {
            Id = id,
            Title = "Standup",
            RecordedAt = recordedAt,
            EndedAt = endedAt,
            AudioFilePath = string.Empty,
            FolderId = folderId,
            SummaryProvider = "claude-code",
            Transcript = "hello there",
            Summary = "### Notes\nHello\n\n## Decisions\nShip it",
            Notes = "Remember the exam date.",
            ActionItems = [new ActionItem { Text = "Follow up", IsDone = false }],
        };

        var markdown = MeetingMarkdownFormatter.Render(record);
        var parsed = MeetingMarkdownFormatter.Parse("fake-path.md", markdown);

        Assert.Equal(id, parsed.Id);
        Assert.Equal("Standup", parsed.Title);
        Assert.Equal(recordedAt, parsed.RecordedAt);
        Assert.Equal(endedAt, parsed.EndedAt);
        Assert.Equal(folderId, parsed.FolderId);
        Assert.Equal("claude-code", parsed.SummaryProvider);
        Assert.Equal("hello there", parsed.Transcript);
        Assert.Equal(record.Summary, parsed.Summary);
        Assert.Equal("Remember the exam date.", parsed.Notes);
        Assert.Single(parsed.ActionItems);
        Assert.Equal("Follow up", parsed.ActionItems[0].Text);
        Assert.Equal("fake-path.md", parsed.SourcePath);
    }

    [Fact]
    public void Render_WhenOptionalFieldsAreEmpty_OmitsTheirFrontmatterAndSections()
    {
        var record = new MeetingRecord
        {
            Id = Guid.NewGuid(),
            Title = "Standup",
            RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
            AudioFilePath = string.Empty,
        };

        var markdown = MeetingMarkdownFormatter.Render(record);

        Assert.DoesNotContain("endedAt:", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("folderId:", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("summaryProvider:", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("## Personal Notes", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("## Action Items", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_MissingOpeningDelimiter_ThrowsFormatException()
    {
        var exception = Record.Exception(() => MeetingMarkdownFormatter.Parse("bad.md", "no frontmatter here"));

        Assert.IsType<FormatException>(exception);
    }

    [Fact]
    public void Parse_MissingId_ThrowsFormatException()
    {
        var markdown = "---\ntitle: Standup\nrecordedAt: 2026-09-01T12:00:00.0000000+00:00\n---\n";

        var exception = Record.Exception(() => MeetingMarkdownFormatter.Parse("bad.md", markdown));

        Assert.IsType<FormatException>(exception);
    }
}
