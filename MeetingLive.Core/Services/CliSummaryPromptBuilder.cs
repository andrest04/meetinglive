using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the non-interactive prompt for every summary provider (Claude Code, Codex, local LLM).
/// Output contract stays "## Summary" / "## Action Items" so
/// <see cref="SummaryMarkdownSplitter"/> can parse all three the same way.
/// </summary>
internal static class CliSummaryPromptBuilder
{
    public static string Build(
        string title,
        DateTimeOffset recordedAt,
        string transcript,
        string? outputLanguage = null)
    {
        var languageName = ToEnglishLanguageName(outputLanguage);
        var headings = SubheadingsFor(outputLanguage);
        var actionExamples = ActionExamplesFor(outputLanguage);

        return $"""
            # Identity

            You extract meeting and lecture notes from an automatic-speech-recognition transcript.
            The transcript may contain ASR errors, false starts, and filler. You are a note-taker,
            not a novelist.

            # Instructions

            Respond with exactly two Markdown sections, in this order, and nothing else
            (no preamble, no code fences, no closing commentary):

            ## Summary

            Use these subheadings inside the Summary body, verbatim (omit a subheading if that
            content is not in the transcript):

            ### {headings.WhatThisWas}
            One or two sentences: meeting, class, informal test, or unclear.

            ### {headings.KeyPoints}
            Bullet list of substantive points actually said.

            ### {headings.Decisions}
            Bullet list of decisions that were explicitly made. If none, omit this subheading.

            ### {headings.OpenQuestions}
            Unresolved questions or disagreements. If none, omit this subheading.

            ## Action Items

            Each follow-up as a Markdown checkbox. Include owner and due date only when the
            transcript states them. If priority was stated, append it. Examples:
            {actionExamples}

            If there are no action items, leave this section empty (keep the heading).

            Rules:
            - Ground every sentence in the transcript. Do not invent attendees, dates, companies, or tasks.
            - If the recording is an informal ASR test or rambling, say so in "{headings.WhatThisWas}". Do not dress it up as a formal meeting.
            - If a name or number is unclear because of ASR noise, paraphrase without guessing the spelling.
            - Write the Summary body and action-item text in {languageName}.
            - Use the ### subheadings above verbatim — do not translate them.
            - Keep the Markdown headings exactly "## Summary" and "## Action Items" in English.

            # Context

            <meeting_title>{title}</meeting_title>
            <recorded_at>{recordedAt.ToString("O", CultureInfo.InvariantCulture)}</recorded_at>
            <transcript>
            {transcript}
            </transcript>
            """;
    }

    internal readonly record struct Subheadings(
        string WhatThisWas,
        string KeyPoints,
        string Decisions,
        string OpenQuestions);

    internal static Subheadings SubheadingsFor(string? code) =>
        IsEnglish(code)
            ? new("What this was", "Key points", "Decisions", "Open questions")
            : new("Qué fue esto", "Puntos clave", "Decisiones", "Preguntas abiertas");

    private static string ActionExamplesFor(string? code) =>
        IsEnglish(code)
            ? """
            - [ ] Send the revised deck — Owner: Ana — Due: Friday
            - [ ] Review the API contract
            """
            : """
            - [ ] Enviar el deck revisado — Owner: Ana — Due: viernes
            - [ ] Revisar el contrato de la API
            """;

    private static bool IsEnglish(string? code) =>
        string.Equals(code?.Trim(), "en", StringComparison.OrdinalIgnoreCase);

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
