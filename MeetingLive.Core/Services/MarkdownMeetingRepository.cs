using System.Globalization;
using System.Text;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Persists each <see cref="MeetingRecord"/> as its own human-readable Markdown
/// file under <see cref="AppPaths.MeetingsDirectory"/> (<c>{id}.md</c>) instead of
/// one shared JSON blob. One file per meeting means saves never rewrite the whole
/// history and lookups by id are direct file reads instead of an O(n) scan.
/// The optional constructor argument overrides the meetings directory so tests
/// never write into the user's real %LOCALAPPDATA%\MeetingLive data.
/// </summary>
public sealed class MarkdownMeetingRepository(string? meetingsDirectory = null) : IMeetingRepository
{
    private const string TranscriptHeader = "## Transcript";
    private const string SummaryHeader = "## Summary";
    private const string ActionItemsHeader = "## Action Items";

    private readonly string _meetingsDirectory = meetingsDirectory ?? AppPaths.MeetingsDirectory;

    public async Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(_meetingsDirectory))
            return [];

        var records = new List<MeetingRecord>();
        foreach (var path in Directory.EnumerateFiles(_meetingsDirectory, "*.md"))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var markdown = await File.ReadAllTextAsync(path, cancellationToken);
            records.Add(Parse(path, markdown));
        }

        return records;
    }

    public async Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var path = PathFor(id);
        if (!File.Exists(path))
            return null;

        var markdown = await File.ReadAllTextAsync(path, cancellationToken);
        return Parse(path, markdown);
    }

    public async Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_meetingsDirectory);
        var markdown = Render(record);
        await File.WriteAllTextAsync(PathFor(record.Id), markdown, cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var path = PathFor(id);
        string? audioFilePath = null;
        if (File.Exists(path))
        {
            var markdown = await File.ReadAllTextAsync(path, cancellationToken);
            audioFilePath = Parse(path, markdown).AudioFilePath;
            File.Delete(path);
        }

        if (!string.IsNullOrWhiteSpace(audioFilePath) && File.Exists(audioFilePath))
            File.Delete(audioFilePath);
    }

    private string PathFor(Guid id) => Path.Combine(_meetingsDirectory, $"{id}.md");

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
        sb.Append("audioFilePath: ").Append(record.AudioFilePath).Append('\n');
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

        var title = frontmatter.GetValueOrDefault("title", string.Empty);
        var audioFilePath = frontmatter.GetValueOrDefault("audioFilePath", string.Empty);
        var summaryProvider = frontmatter.GetValueOrDefault("summaryProvider");

        var transcript = ExtractSection(lines, bodyStart, TranscriptHeader);
        var summary = ExtractSection(lines, bodyStart, SummaryHeader);
        var actionItemsBody = ExtractSection(lines, bodyStart, ActionItemsHeader);
        var actionItems = actionItemsBody is null ? [] : ActionItemParser.Parse(actionItemsBody);

        return new MeetingRecord
        {
            Id = id,
            Title = title,
            RecordedAt = recordedAt,
            AudioFilePath = audioFilePath,
            Transcript = transcript,
            Summary = summary,
            SummaryProvider = summaryProvider,
            ActionItems = actionItems,
        };
    }

    /// <summary>Finds the exact, case-sensitive <paramref name="header"/> line and
    /// returns everything up to (but not including) the next "## " header, or null
    /// if the header isn't present at all.</summary>
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
            if (lines[j].StartsWith("## ", StringComparison.Ordinal))
            {
                end = j;
                break;
            }
        }

        var content = string.Join('\n', lines[start..end]).Trim();
        return content.Length == 0 ? null : content;
    }
}
