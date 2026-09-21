namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the short live-answer prompt. The model may use its own knowledge when the transcript lacks the fact.
/// </summary>
public static class LiveAnswerPromptBuilder
{
    public static string Build(string question, string transcriptWindow, string? outputLanguage)
    {
        question ??= string.Empty;
        transcriptWindow ??= string.Empty;
        var language = ToAnswerLanguage(outputLanguage);

        return $"""
            You are answering a question that was just asked in a live class or meeting.

            Write a short answer in 2 to 5 sentences. Write the answer in {language}.

            Use the transcript window as context for the topic and who asked.

            If the transcript does not contain the factual answer, answer from knowledge. Do not refuse just because the meeting did not state the fact. Do not say that you only know what was said.

            Question:
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
