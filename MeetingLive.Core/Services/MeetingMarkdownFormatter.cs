using System.Globalization;
using System.Text;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Renders a <see cref="MeetingRecord"/> to the frontmatter + sections Markdown
/// format used by <see cref="MarkdownMeetingRepository"/>, and parses it back.
/// Kept separate from the repository because this format changes for different
/// reasons than the file-location/layout logic that owns the repository.
/// </summary>
internal static class MeetingMarkdownFormatter
{
    internal const string TranscriptHeader = "## Transcript";
    internal const string SummaryHeader = "## Summary";
    internal const string ActionItemsHeader = "## Action Items";
    internal const string PersonalNotesHeader = "## Personal Notes";

    /// <summary>Renders a <see cref="MeetingRecord"/> as the frontmatter + sections
    /// Markdown format described in the plan. A section is omitted entirely when its
    /// backing field is null/empty (e.g. no summary generated yet).</summary>
    internal static string Render(MeetingRecord record)
    {
        var sb = new StringBuilder();
        sb.Append("---\n");
        sb.Append("id: ").Append(record.Id).Append('\n');
        sb.Append("title: ").Append(record.Title).Append('\n');
        sb.Append("recordedAt: ").Append(record.RecordedAt.ToString("O", CultureInfo.InvariantCulture)).Append('\n');
        if (record.EndedAt is { } endedAt)
            sb.Append("endedAt: ").Append(endedAt.ToString("O", CultureInfo.InvariantCulture)).Append('\n');
        sb.Append("audioFilePath: ").Append(record.AudioFilePath).Append('\n');
        if (record.FolderId is { } folderId)
            sb.Append("folderId: ").Append(folderId).Append('\n');
        if (!string.IsNullOrEmpty(record.SummaryProvider))
            sb.Append("summaryProvider: ").Append(record.SummaryProvider).Append('\n');
        sb.Append("---\n");

        if (!string.IsNullOrEmpty(record.Transcript))
        {
            sb.Append('\n').Append(TranscriptHeader).Append('\n').Append('\n');
            sb.Append(record.Transcript.Trim()).Append('\n');
        }

        if (!string.IsNullOrEmpty(record.Summary))
        {
            sb.Append('\n').Append(SummaryHeader).Append('\n').Append('\n');
            sb.Append(record.Summary.Trim()).Append('\n');
        }

        if (record.ActionItems.Count > 0)
        {
            sb.Append('\n').Append(ActionItemsHeader).Append('\n').Append('\n');
            sb.Append(ActionItemParser.Render(record.ActionItems));
        }

        if (!string.IsNullOrEmpty(record.Notes))
        {
            sb.Append('\n').Append(PersonalNotesHeader).Append('\n').Append('\n');
            sb.Append(record.Notes.Trim()).Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>Parses a meeting Markdown file back into a <see cref="MeetingRecord"/>.
    /// The frontmatter parser is hand-rolled (split only on the first ':') so an
    /// <c>audioFilePath</c> value like <c>C:\...</c> doesn't get mangled.</summary>
    internal static MeetingRecord Parse(string path, string markdown)
    {
        var lines = markdown.Replace("\r\n", "\n").Split('\n');

        if (lines.Length == 0 || lines[0] != "---")
            throw new FormatException($"Meeting file '{path}' is missing the opening frontmatter delimiter '---'.");

        var frontmatter = new Dictionary<string, string>();
        var i = 1;
        for (; i < lines.Length && lines[i] != "---"; i++)
        {
            var line = lines[i];
            var separatorIndex = line.IndexOf(':');
            if (separatorIndex < 0)
                continue;

            var key = line[..separatorIndex].Trim();
            var value = line[(separatorIndex + 1)..].Trim();
            frontmatter[key] = value;
        }

        if (i >= lines.Length)
            throw new FormatException($"Meeting file '{path}' is missing the closing frontmatter delimiter '---'.");

        var bodyStart = i + 1;

        if (!frontmatter.TryGetValue("id", out var idText) || !Guid.TryParse(idText, out var id))
            throw new FormatException($"Meeting file '{path}' has a missing or invalid 'id' in its frontmatter.");

        if (!frontmatter.TryGetValue("recordedAt", out var recordedAtText) ||
            !DateTimeOffset.TryParse(recordedAtText, CultureInfo.InvariantCulture, DateTimeStyles.None, out var recordedAt))
            throw new FormatException($"Meeting file '{path}' has a missing or invalid 'recordedAt' in its frontmatter.");

        DateTimeOffset? endedAt = null;
        if (frontmatter.TryGetValue("endedAt", out var endedAtText) &&
            !string.IsNullOrWhiteSpace(endedAtText) &&
            DateTimeOffset.TryParse(endedAtText, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedEndedAt))
        {
            endedAt = parsedEndedAt;
        }

        var title = frontmatter.GetValueOrDefault("title", string.Empty);
        var audioFilePath = frontmatter.GetValueOrDefault("audioFilePath", string.Empty);
        var siblingWav = Path.ChangeExtension(path, ".wav");
        if ((string.IsNullOrWhiteSpace(audioFilePath) || !File.Exists(audioFilePath)) && File.Exists(siblingWav))
            audioFilePath = siblingWav;
        var summaryProvider = frontmatter.GetValueOrDefault("summaryProvider");
        Guid? folderId = null;
        if (frontmatter.TryGetValue("folderId", out var folderIdText) &&
            !string.IsNullOrWhiteSpace(folderIdText) &&
            Guid.TryParse(folderIdText, out var parsedFolderId))
        {
            folderId = parsedFolderId;
        }

        var transcript = ExtractSection(lines, bodyStart, TranscriptHeader);
        var summary = ExtractSection(lines, bodyStart, SummaryHeader);
        var actionItemsBody = ExtractSection(lines, bodyStart, ActionItemsHeader);
        var actionItems = actionItemsBody is null ? [] : ActionItemParser.Parse(actionItemsBody);
        var notes = ExtractSection(lines, bodyStart, PersonalNotesHeader);

        return new MeetingRecord
        {
            Id = id,
            Title = title,
            RecordedAt = recordedAt,
            EndedAt = endedAt,
            AudioFilePath = audioFilePath,
            Transcript = transcript,
            Summary = summary,
            SummaryProvider = summaryProvider,
            FolderId = folderId,
            Notes = notes,
            ActionItems = actionItems,
            SourcePath = path,
        };
    }

    /// <summary>Finds the exact, case-sensitive <paramref name="header"/> line and
    /// returns everything up to (but not including) the next meeting section header
    /// (<c>## Transcript</c> / <c>## Summary</c> / <c>## Action Items</c> /
    /// <c>## Personal Notes</c>), or null if the header isn't present at all.</summary>
    private static string? ExtractSection(string[] lines, int bodyStart, string header)
    {
        var start = -1;
        for (var j = bodyStart; j < lines.Length; j++)
        {
            if (lines[j] == header)
            {
                start = j + 1;
                break;
            }
        }

        if (start < 0)
            return null;

        var end = lines.Length;
        for (var j = start; j < lines.Length; j++)
        {
            // Only the three meeting section headers bound a section. LLM summaries
            // routinely contain `## Decisions` / `## Risks` which must stay in Summary.
            if (lines[j] != header && IsMeetingSectionHeader(lines[j]))
            {
                end = j;
                break;
            }
        }

        var content = string.Join('\n', lines[start..end]).Trim();
        return content.Length == 0 ? null : content;
    }

    private static bool IsMeetingSectionHeader(string line) =>
        line is TranscriptHeader or SummaryHeader or ActionItemsHeader or PersonalNotesHeader;
}
