namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the short live-answer prompt. The model may use its own knowledge when the transcript lacks the fact.
/// </summary>
public static class LiveAnswerPromptBuilder
{
    public static string Build(
        string question,
        string transcriptWindow,
        string? outputLanguage,
        string? sessionContext = null,
        bool webSearch = false)
    {
        question ??= string.Empty;
        transcriptWindow ??= string.Empty;
        var language = ToAnswerLanguage(outputLanguage);

        var contextBlock = string.IsNullOrWhiteSpace(sessionContext)
            ? string.Empty
            : $"""
                Session context:
                {sessionContext.Trim()}

                The session context is the topic, course, or meeting brief supplied by the user. Use it to interpret the question.

                """;

        var webLine = webSearch
            ? "You may use web search for current or external facts (competitors, prices, recent news) and keep the answer short.\n\n"
            : string.Empty;

        return $"""
            You are answering a question that was just asked in a live class or meeting.

            Write a short answer in 2 to 5 sentences. Write the answer in {language}.

            Use the transcript window as context for the topic and who asked.

            If the transcript does not contain the factual answer, answer from knowledge. Do not refuse just because the meeting did not state the fact. Do not say that you only know what was said.

            {contextBlock}{webLine}Question:
            {question}

            Transcript window:
            {transcriptWindow}
            """;
    }

    private static string ToAnswerLanguage(string? outputLanguage)
    {
        if (string.Equals(outputLanguage?.Trim(), "en", StringComparison.OrdinalIgnoreCase))
            return "English";

        return "Spanish";
    }
}
