using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Title-only prompt for an explicit regenerate. Does not ask for Summary or Action Items.
/// </summary>
internal static class CliMeetingTitlePromptBuilder
{
    public static string Build(string transcript, DateTimeOffset recordedAt, string? outputLanguage = null)
    {
        var languageName = CliSummaryPromptBuilder.ToEnglishLanguageName(outputLanguage);

        return $"""
            # Identity

            You name a recording from an automatic-speech-recognition transcript.
            The transcript may contain ASR errors, false starts, and filler.

            # Instructions

            Return ONLY a short title, about 3–8 words. Nothing else:
            no preamble, no code fences, no ## headings, no quotes, no trailing period.

            Write the title in {languageName}.
            Ground it in the transcript. Do not invent.
            If the recording is an informal ASR test, say so plainly (e.g. Microphone test).
            This is an explicit regenerate: do not copy a current title; name the recording from the transcript.

            # Context

            <recorded_at>{recordedAt.ToString("O", CultureInfo.InvariantCulture)}</recorded_at>
            <transcript>
            {transcript}
            </transcript>
            """;
    }
}
