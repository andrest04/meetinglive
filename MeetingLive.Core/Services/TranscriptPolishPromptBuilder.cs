namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the non-interactive prompt for transcript polish (Claude Code, Codex, local LLM).
/// The model must return only the polished transcript — no summary, no speakers, no extra lines.
/// </summary>
internal static class TranscriptPolishPromptBuilder
{
    public static string Build(string transcript, string? meetingLanguage = null)
    {
        var languageName = ToEnglishLanguageName(meetingLanguage);

        return $"""
            # Identity

            You polish an automatic-speech-recognition transcript. You fix writing, not content.

            # Instructions

            Return ONLY the polished transcript. No preamble, no code fences, no commentary.

            Rules:
            - Keep the "Recorded ..." header (if present) and every [stamp] prefix byte-for-byte.
            - Only edit the spoken text after the stamp.
            - Fix punctuation, Spanish/English accents, truecasing, and well-known acronyms (ONU, NASA, FBI, UNESCO).
            - Convert obvious questions to ¿? / ?.
            - Represent a clear pause as `...` only when the transcript already implies one.
            - Do not add speakers, action items, or a summary.
            - Do not drop lines.
            - Do not invent content that was not spoken.
            - Write the spoken text in {languageName}.

            # Transcript

            <transcript>
            {transcript}
            </transcript>
            """;
    }

    /// <summary>
    /// Splits a timestamped transcript into chunks of whole lines that fit
    /// <paramref name="maxChars"/> so a 4096-token local context can polish long meetings.
    /// A single line longer than the budget is still emitted as its own chunk.
    /// </summary>
    public static IReadOnlyList<string> SplitTimestampedChunks(string transcript, int maxChars)
    {
        if (maxChars <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxChars));

        if (string.IsNullOrEmpty(transcript) || transcript.Length <= maxChars)
            return [transcript];

        var lines = transcript.Split(["\r\n", "\n"], StringSplitOptions.None);
        var chunks = new List<string>();
        var buffer = new List<string>();
        var length = 0;

        foreach (var line in lines)
        {
            var extra = buffer.Count == 0 ? line.Length : Environment.NewLine.Length + line.Length;
            if (buffer.Count > 0 && length + extra > maxChars)
            {
                chunks.Add(string.Join(Environment.NewLine, buffer));
                buffer.Clear();
                length = 0;
                extra = line.Length;
            }

            buffer.Add(line);
            length += extra;
        }

        if (buffer.Count > 0)
            chunks.Add(string.Join(Environment.NewLine, buffer));

        return chunks;
    }

    internal static string ToEnglishLanguageName(string? code) =>
        string.IsNullOrWhiteSpace(code) ? "Spanish" : code.Trim().ToLowerInvariant() switch
        {
            "es" => "Spanish",
            "en" => "English",
            "pt" => "Portuguese",
            "fr" => "French",
            "de" => "German",
            "it" => "Italian",
            "nl" => "Dutch",
            "ja" => "Japanese",
            "zh" => "Chinese",
            _ => "Spanish",
        };
}
