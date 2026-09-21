namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the checklist prompt sent to the selected summary provider after Jev picks evidence lines.
/// </summary>
public static class PersonalTasksPromptBuilder
{
    public static string Build(
        IReadOnlyList<TranscriptLine> evidenceLines,
        string? topic,
        string? outputLanguage = null)
    {
        ArgumentNullException.ThrowIfNull(evidenceLines);

        var languageName = CliSummaryPromptBuilder.ToEnglishLanguageName(outputLanguage);
        var topicBlock = string.IsNullOrWhiteSpace(topic)
            ? string.Empty
            : $"\n            <topic>{topic.Trim()}</topic>";
        var evidenceBlock = evidenceLines.Count == 0
            ? "(none)"
            : string.Join('\n', evidenceLines.Select(line => $"- {line.Text}"));

        return $"""
            # Identity

            You write a short personal checklist of work the listener should do after a meeting.
            You only use the evidence lines. You do not invent tasks.

            # Instructions

            Respond with Markdown only, in this shape, and nothing else
            (no preamble, no code fences, no closing commentary):

            ## What you need to do

            - [ ] first task
            - [ ] second task

            Rules:
            - Use only the evidence lines. Do not invent work, owners, dates, or topics.
            - If the evidence is empty, output NONE and nothing else.
            - Write checkbox item text in {languageName}.
            - Keep the heading exactly "## What you need to do" in English.
            - No extra chatter.

            # Context
            {topicBlock}
            <evidence>
            {evidenceBlock}
            </evidence>
            """;
    }
}
