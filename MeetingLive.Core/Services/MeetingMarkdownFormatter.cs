using System.Globalization;
using System.Text;
using System.Text.Json;
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
    internal const string JevHeader = "## Jev";
    internal const string PersonalNotesHeader = "## Personal Notes";
    internal const string BriefHeader = "## Brief";
    internal const string FollowUpHeader = "## Follow-up";
    internal const string ProjectPlanHeader = "## Project plan";

    /// <summary>
    /// Separator for the single <c>attendees</c> frontmatter line.
    /// Split only on this token, not on commas or colons.
    /// </summary>
    internal const string AttendeeSeparator = " | ";

    /// <summary>
    /// Frontmatter key written only when a text section holds a line equal to a section header.
    /// Those lines are saved with a closing <see cref="HeaderEscapeSuffix"/>, which is valid
    /// Markdown for the same heading, so only real section headers match exactly. Files without
    /// the key are read literally, so every file written before it existed parses as it did.
    /// </summary>
    private const string HeaderEscapingKey = "headerEscaping";

    private const string HeaderEscapeSuffix = " ##";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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
        AppendOptional(sb, "calendarEventId", record.CalendarEventId);
        AppendOptional(sb, "calendarId", record.CalendarId);
        AppendOptional(sb, "seriesId", record.SeriesId);
        AppendOptional(sb, "joinUrl", record.JoinUrl);
        AppendOptional(sb, "noteTemplateId", record.NoteTemplateId);
        if (record.Attendees.Count > 0)
            sb.Append("attendees: ").Append(string.Join(AttendeeSeparator, record.Attendees.Select(FrontmatterValue))).Append('\n');
        var escapeHeaders = HoldsSectionHeaderLine(record);
        if (escapeHeaders)
            sb.Append(HeaderEscapingKey).Append(": 1\n");
        sb.Append("---\n");

        AppendSection(sb, BriefHeader, record.Brief, escapeHeaders);

        if (!string.IsNullOrEmpty(record.Transcript))
        {
            sb.Append('\n').Append(TranscriptHeader).Append('\n').Append('\n');
            sb.Append(SectionBody(record.Transcript, escapeHeaders)).Append('\n');
        }

        if (!string.IsNullOrEmpty(record.Summary))
        {
            sb.Append('\n').Append(SummaryHeader).Append('\n').Append('\n');
            sb.Append(SectionBody(record.Summary, escapeHeaders)).Append('\n');
        }

        if (record.ActionItems.Count > 0)
        {
            sb.Append('\n').Append(ActionItemsHeader).Append('\n').Append('\n');
            sb.Append(ActionItemParser.Render(record.ActionItems));
        }

        if (record.JevAnalysis is not null)
        {
            sb.Append('\n').Append(JevHeader).Append('\n').Append('\n');
            sb.Append(JsonSerializer.Serialize(record.JevAnalysis, JsonOptions)).Append('\n');
        }

        if (!string.IsNullOrEmpty(record.Notes))
        {
            sb.Append('\n').Append(PersonalNotesHeader).Append('\n').Append('\n');
            sb.Append(SectionBody(record.Notes, escapeHeaders)).Append('\n');
        }

        AppendSection(sb, FollowUpHeader, record.FollowUp, escapeHeaders);
        AppendSection(sb, ProjectPlanHeader, record.ProjectPlan, escapeHeaders);

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

        var attendees = frontmatter.TryGetValue("attendees", out var attendeesText)
            ? ParseAttendees(attendeesText)
            : [];

        var escapedHeaders = frontmatter.ContainsKey(HeaderEscapingKey);
        string? TextSection(string header)
        {
            var body = ExtractSection(lines, bodyStart, header);
            return escapedHeaders ? UnescapeHeaderLines(body) : body;
        }

        var transcript = TextSection(TranscriptHeader);
        var summary = TextSection(SummaryHeader);
        var actionItemsBody = ExtractSection(lines, bodyStart, ActionItemsHeader);
        var actionItems = actionItemsBody is null ? [] : ActionItemParser.Parse(actionItemsBody);
        var notes = TextSection(PersonalNotesHeader);
        var brief = TextSection(BriefHeader);
        var followUp = TextSection(FollowUpHeader);
        var projectPlan = TextSection(ProjectPlanHeader);
        var jevBody = ExtractSection(lines, bodyStart, JevHeader);
        MeetingJevAnalysis? jevAnalysis = null;
        if (jevBody is not null)
        {
            try
            {
                jevAnalysis = JsonSerializer.Deserialize<MeetingJevAnalysis>(jevBody, JsonOptions);
            }
            catch (JsonException ex)
            {
                throw new FormatException($"Meeting file '{path}' has an invalid Jev section.", ex);
            }
        }

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
            JevAnalysis = jevAnalysis,
            SourcePath = path,
            CalendarEventId = Optional(frontmatter, "calendarEventId"),
            CalendarId = Optional(frontmatter, "calendarId"),
            SeriesId = Optional(frontmatter, "seriesId"),
            JoinUrl = Optional(frontmatter, "joinUrl"),
            Attendees = attendees,
            Brief = brief,
            NoteTemplateId = Optional(frontmatter, "noteTemplateId"),
            FollowUp = followUp,
            ProjectPlan = projectPlan,
        };
    }

    private static void AppendSection(StringBuilder sb, string header, string? body, bool escapeHeaders)
    {
        if (string.IsNullOrWhiteSpace(body))
            return;

        sb.Append('\n').Append(header).Append('\n').Append('\n');
        sb.Append(SectionBody(body, escapeHeaders)).Append('\n');
    }

    private static string SectionBody(string body, bool escapeHeaders)
    {
        var trimmed = body.Trim();
        return escapeHeaders ? EscapeHeaderLines(trimmed) : trimmed;
    }

    private static bool HoldsSectionHeaderLine(MeetingRecord record)
    {
        string?[] bodies = [record.Brief, record.Transcript, record.Summary, record.Notes, record.FollowUp, record.ProjectPlan];
        return bodies.Any(body => body is not null && SplitLines(body.Trim()).Any(IsMeetingSectionHeader));
    }

    /// <summary>Adds one closing suffix to every header line and to every line that already looks
    /// escaped, so <see cref="UnescapeHeaderLines"/> gets the original back in all cases.</summary>
    private static string EscapeHeaderLines(string body) =>
        string.Join('\n', SplitLines(body).Select(line => IsEscapableHeaderLine(line) ? line + HeaderEscapeSuffix : line));

    private static string? UnescapeHeaderLines(string? body) =>
        body is null
            ? null
            : string.Join('\n', SplitLines(body).Select(line =>
                line.EndsWith(HeaderEscapeSuffix, StringComparison.Ordinal) && IsEscapableHeaderLine(line)
                    ? line[..^HeaderEscapeSuffix.Length]
                    : line));

    private static bool IsEscapableHeaderLine(string line)
    {
        var bare = line;
        while (bare.EndsWith(HeaderEscapeSuffix, StringComparison.Ordinal))
            bare = bare[..^HeaderEscapeSuffix.Length];

        return IsMeetingSectionHeader(bare);
    }

    private static string[] SplitLines(string text) => text.Replace("\r\n", "\n").Split('\n');

    private static void AppendOptional(StringBuilder sb, string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        sb.Append(key).Append(": ").Append(FrontmatterValue(value)).Append('\n');
    }

    private static string? Optional(Dictionary<string, string> frontmatter, string key) =>
        frontmatter.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    private static IReadOnlyList<string> ParseAttendees(string value) =>
        value.Split(AttendeeSeparator, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static string FrontmatterValue(string value) =>
        value.Replace("\r", " ", StringComparison.Ordinal).Replace("\n", " ", StringComparison.Ordinal);

    /// <summary>Finds the exact, case-sensitive <paramref name="header"/> line and
    /// returns everything up to (but not including) the next meeting section header
    /// (<c>## Transcript</c> / <c>## Summary</c> / <c>## Action Items</c> /
    /// <c>## Jev</c> / <c>## Personal Notes</c> / <c>## Brief</c> / <c>## Follow-up</c> /
    /// <c>## Project plan</c>), or null if the header isn't present at all.</summary>
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
        line is TranscriptHeader or SummaryHeader or ActionItemsHeader or JevHeader or PersonalNotesHeader
            or BriefHeader or FollowUpHeader or ProjectPlanHeader;
}
