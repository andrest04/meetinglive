using System.Text;

namespace MeetingLive.Core.Services;

internal sealed record LocalLlmSummaryRequest(
    string Title,
    DateTimeOffset RecordedAt,
    string Transcript,
    string? OutputLanguage,
    DateTimeOffset? EndedAt,
    SummaryEnhancementContext? Enhancement);

/// <summary>
/// Fits a summary of any meeting into the local model's fixed context. A transcript that fits
/// goes through unchanged. A longer one is cut into parts, each part becomes short notes, notes
/// are merged until they fit, and the final prompt runs over them with the normal output
/// contract. Nothing is dropped to make room: when a budget cannot be met, this fails with a
/// message instead. Each prompt is measured up front, because what LLamaSharp does on overflow
/// was not verified and must not be relied on.
/// </summary>
internal static class LocalLlmSummaryMapReduce
{
    public const int ContextTokens = 4096;
    public const int FinalMaxOutputTokens = 1024;
    public const int NotesMaxOutputTokens = 640;

    /// <summary>Room for the chat template wrapped around each prompt and for counting drift.</summary>
    private const int SafetyMarginTokens = 128;

    /// <summary>Bounds the work: at about 3,000 tokens a part, this is many hours of speech.</summary>
    private const int MaxParts = 64;

    /// <summary>Every pass at least halves the notes, so this covers <see cref="MaxParts"/>.</summary>
    private const int MaxMergePasses = 8;

    public static async Task<string> SummarizeAsync(
        LocalLlmSummaryRequest request,
        Func<string, int> countTokens,
        Func<string, int, CancellationToken, Task<string>> infer,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var directPrompt = BuildFinalPrompt(request, request.Transcript);
        if (Fits(directPrompt, FinalMaxOutputTokens, countTokens))
            return await infer(directPrompt, FinalMaxOutputTokens, cancellationToken);

        // A single merged note must always fit the final prompt, or the merge could never end.
        if (RoomFor(BuildFinalPrompt(request, string.Empty), FinalMaxOutputTokens, countTokens) < NotesMaxOutputTokens)
        {
            throw new InvalidOperationException(
                "The meeting notes, agenda, or template are too long for the local summary model. Shorten them or use another summary provider.");
        }

        var language = CliSummaryPromptBuilder.ToEnglishLanguageName(request.OutputLanguage);
        var parts = SplitToBudget(
            request.Transcript,
            RoomFor(BuildPartPrompt(string.Empty, MaxParts, MaxParts, language), NotesMaxOutputTokens, countTokens),
            countTokens);
        if (parts.Count > MaxParts)
        {
            throw new InvalidOperationException(
                $"The transcript is too long for the local summary model ({parts.Count} parts, limit {MaxParts}). Use another summary provider.");
        }

        var notes = new List<string>(parts.Count);
        for (var i = 0; i < parts.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            notes.Add(await infer(BuildPartPrompt(parts[i], i + 1, parts.Count, language), NotesMaxOutputTokens, cancellationToken));
        }

        var finalPrompt = await MergeUntilFinalFitsAsync(request, notes, language, countTokens, infer, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        return await infer(finalPrompt, FinalMaxOutputTokens, cancellationToken);
    }

    /// <summary>
    /// Greedily packs whole lines into chunks of at most <paramref name="maxTokens"/>, the way
    /// <see cref="TranscriptPolishPromptBuilder.SplitTimestampedChunks"/> does with characters. A
    /// tokenizer budget also holds for languages where a character costs more than one token.
    /// A line over the budget is cut, so transcripts without line breaks lose nothing.
    /// </summary>
    internal static IReadOnlyList<string> SplitToBudget(string text, int maxTokens, Func<string, int> countTokens)
    {
        var chunks = new List<string>();
        var buffer = new StringBuilder();
        var used = 0;

        void Flush()
        {
            if (!string.IsNullOrWhiteSpace(buffer.ToString()))
                chunks.Add(buffer.ToString());
            buffer.Clear();
            used = 0;
        }

        foreach (var line in text.Split(["\r\n", "\n"], StringSplitOptions.None))
        {
            // One more for the line break the chunk puts back.
            var cost = countTokens(line) + 1;
            if (cost > maxTokens)
            {
                Flush();
                chunks.AddRange(SplitLongLine(line, maxTokens - 1, countTokens));
                continue;
            }

            if (used + cost > maxTokens)
                Flush();

            if (buffer.Length > 0)
                buffer.Append('\n');
            buffer.Append(line);
            used += cost;
        }

        Flush();
        return chunks;
    }

    private static IEnumerable<string> SplitLongLine(string line, int maxTokens, Func<string, int> countTokens)
    {
        var start = 0;
        while (start < line.Length)
        {
            var end = start + LongestPrefixWithin(line, start, maxTokens, countTokens);
            if (end < line.Length)
                end = BackOffToBoundary(line, start, end);

            yield return line[start..end];
            start = end;
        }
    }

    private static int LongestPrefixWithin(string line, int start, int maxTokens, Func<string, int> countTokens)
    {
        var low = 1;
        var high = line.Length - start;
        while (low < high)
        {
            var middle = (low + high + 1) / 2;
            if (countTokens(line.Substring(start, middle)) <= maxTokens)
                low = middle;
            else
                high = middle - 1;
        }

        return low;
    }

    /// <summary>Prefers a cut after whitespace, and never cuts a surrogate pair in two.</summary>
    private static int BackOffToBoundary(string line, int start, int end)
    {
        for (var i = end - 1; i > start + ((end - start) / 2); i--)
        {
            if (char.IsWhiteSpace(line[i]))
                return i + 1;
        }

        return char.IsLowSurrogate(line[end]) && end - 1 > start ? end - 1 : end;
    }

    private static async Task<string> MergeUntilFinalFitsAsync(
        LocalLlmSummaryRequest request,
        List<string> notes,
        string language,
        Func<string, int> countTokens,
        Func<string, int, CancellationToken, Task<string>> infer,
        CancellationToken cancellationToken)
    {
        var mergeRoom = RoomFor(BuildMergePrompt(string.Empty, language), NotesMaxOutputTokens, countTokens);

        for (var pass = 0; pass <= MaxMergePasses; pass++)
        {
            var finalPrompt = BuildFinalPrompt(request, JoinNotes(notes));
            if (Fits(finalPrompt, FinalMaxOutputTokens, countTokens))
                return finalPrompt;

            var groups = GroupToBudget(notes, mergeRoom, countTokens);
            if (groups.Count == notes.Count)
                break;

            var merged = new List<string>(groups.Count);
            foreach (var group in groups)
            {
                cancellationToken.ThrowIfCancellationRequested();
                merged.Add(group.Count == 1
                    ? group[0]
                    : await infer(BuildMergePrompt(JoinNotes(group), language), NotesMaxOutputTokens, cancellationToken));
            }

            notes = merged;
        }

        throw new InvalidOperationException(
            "The local summary model could not condense this meeting enough to summarize it. Use another summary provider.");
    }

    private static List<List<string>> GroupToBudget(List<string> notes, int maxTokens, Func<string, int> countTokens)
    {
        var groups = new List<List<string>>();
        var used = 0;
        foreach (var note in notes)
        {
            // Two more for the blank line between notes.
            var cost = countTokens(note) + 2;
            if (groups.Count == 0 || used + cost > maxTokens)
            {
                groups.Add([]);
                used = 0;
            }

            groups[^1].Add(note);
            used += cost;
        }

        return groups;
    }

    private static bool Fits(string prompt, int maxOutputTokens, Func<string, int> countTokens) =>
        RoomFor(prompt, maxOutputTokens, countTokens) >= 0;

    private static int RoomFor(string prompt, int maxOutputTokens, Func<string, int> countTokens) =>
        ContextTokens - SafetyMarginTokens - maxOutputTokens - countTokens(prompt);

    private static string JoinNotes(IEnumerable<string> notes) => string.Join("\n\n", notes);

    private static string BuildFinalPrompt(LocalLlmSummaryRequest request, string transcript) =>
        CliSummaryPromptBuilder.Build(
            request.Title, request.RecordedAt, transcript, request.OutputLanguage, request.EndedAt, request.Enhancement);

    private static string BuildPartPrompt(string part, int number, int total, string language) => $"""
        You take notes on part {number} of {total} of an automatic-speech-recognition transcript.
        Another step combines the notes from all parts, so anything you leave out is lost.

        Respond only with Markdown bullets in {language}, about 300 words at most, with no preamble:
        - The substantive points actually said.
        - Decisions explicitly made, starting with "Decision:".
        - Unresolved questions, starting with "Question:".
        - Follow-ups as "- [ ] task", with an owner and a due date only when stated.

        Keep the [mm:ss.ff-mm:ss.ff] range on decisions and follow-ups, and any Recorded or Ended stamp.
        Ground every bullet in the text. Do not invent names, dates, or tasks.
        If this part has nothing substantive, respond with one bullet that says so.

        <transcript_part>
        {part}
        </transcript_part>
        """;

    private static string BuildMergePrompt(string notes, string language) => $"""
        These are consecutive notes on a recording, in time order. Combine them into one shorter set.

        Respond only with Markdown bullets in {language}, about 300 words at most, with no preamble.
        Remove repetition and minor detail. Keep every decision, open question, and follow-up,
        with their "Decision:", "Question:", and "- [ ]" forms and their time ranges.
        Do not invent anything that is not in the notes.

        <notes_part>
        {notes}
        </notes_part>
        """;
}
