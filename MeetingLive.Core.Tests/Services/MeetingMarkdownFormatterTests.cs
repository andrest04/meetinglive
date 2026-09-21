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
        Assert.DoesNotContain("## Jev", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void RenderThenParse_RoundtripsJevAnalysis()
    {
        var id = Guid.NewGuid();
        var recordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00.0000000+00:00");
        var analyzedAt = DateTimeOffset.Parse("2026-09-01T13:00:00.0000000+00:00");
        var record = new MeetingRecord
        {
            Id = id,
            Title = "Standup",
            RecordedAt = recordedAt,
            AudioFilePath = string.Empty,
            Transcript = "hello there",
            Summary = "### Notes\nHello\n\n## Decisions\nShip it",
            ActionItems = [new ActionItem { Text = "Follow up", IsDone = false }],
            JevAnalysis = new MeetingJevAnalysis
            {
                MeetingType = "standup",
                MeetingTypeConfidence = 0.85,
                SpokenLanguage = "en",
                UrgencyScore = 1.0,
                UrgencyConfidence = 0.9,
                ContainsDecisions = 0.8,
                ContainsCommitments = 0.2,
                PiiRisk = 0.01,
                SummaryFaithful = 0.7,
                SuggestedFolderId = "inbox",
                FolderConfidence = 0.5,
                Model = "jev-1.13.0",
                AnalyzedAt = analyzedAt,
                ActionItems =
                [
                    new ActionItemVerdict { Text = "Follow up", Relation = "supports", Confidence = 0.88 },
                ],
            },
        };

        var markdown = MeetingMarkdownFormatter.Render(record);
        var parsed = MeetingMarkdownFormatter.Parse("fake-path.md", markdown);

        Assert.Contains("## Jev", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-key", markdown, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", markdown, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(record.Summary, parsed.Summary);
        Assert.NotNull(parsed.JevAnalysis);
        Assert.Equal("standup", parsed.JevAnalysis.MeetingType);
        Assert.Equal(0.85, parsed.JevAnalysis.MeetingTypeConfidence);
        Assert.Equal("en", parsed.JevAnalysis.SpokenLanguage);
        Assert.Equal(1.0, parsed.JevAnalysis.UrgencyScore);
        Assert.Equal(0.8, parsed.JevAnalysis.ContainsDecisions);
        Assert.Equal(0.7, parsed.JevAnalysis.SummaryFaithful);
        Assert.Equal("inbox", parsed.JevAnalysis.SuggestedFolderId);
        Assert.Equal("jev-1.13.0", parsed.JevAnalysis.Model);
        Assert.Equal(analyzedAt, parsed.JevAnalysis.AnalyzedAt);
        var verdict = Assert.Single(parsed.JevAnalysis.ActionItems);
        Assert.Equal("Follow up", verdict.Text);
        Assert.Equal("supports", verdict.Relation);
        Assert.Equal(0.88, verdict.Confidence);
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
