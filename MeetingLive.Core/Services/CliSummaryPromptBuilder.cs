using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the non-interactive prompt piped over stdin to both CLI-based summary providers
/// (Claude Code, Codex) — the same "## Summary" / "## Action Items" two-section contract
/// <see cref="LocalLlmSummaryProvider"/> asks its local model for, so
/// <see cref="SummaryMarkdownSplitter"/> can parse all three providers' output the same way.
/// </summary>
internal static class CliSummaryPromptBuilder
{
    public static string Build(string title, DateTimeOffset recordedAt, string transcript) => $"""
        You are an assistant that summarizes meetings and lectures. Summarize the meeting
        transcript below and respond with exactly two Markdown sections, in this order, and
        nothing else (no preamble, no code fences):

        ## Summary

        A concise summary covering key points and decisions made.

        ## Action Items

        Every follow-up task as a Markdown checkbox line, e.g. "- [ ] Follow up with design on
        mockups" (with owner if mentioned). If there are no action items, leave this section empty.

        Meeting title: {title}
        Recorded at: {recordedAt.ToString("O", CultureInfo.InvariantCulture)}

        Transcript:
        {transcript}
        """;
}
