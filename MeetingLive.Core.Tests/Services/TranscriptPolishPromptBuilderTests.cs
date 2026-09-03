using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptPolishPromptBuilderTests
{
    [Fact]
    public void Build_InstructsModelToReturnOnlyPolishedTranscript()
    {
        var prompt = TranscriptPolishPromptBuilder.Build("[00:00:01 | 15:00] hola onu", "es");

        Assert.Contains("Return ONLY the polished transcript", prompt, StringComparison.Ordinal);
        Assert.Contains("Keep the \"Recorded ...\" header", prompt, StringComparison.Ordinal);
        Assert.Contains("byte-for-byte", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not add speakers, action items, or a summary", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not invent content", prompt, StringComparison.Ordinal);
        Assert.Contains("in Spanish", prompt, StringComparison.Ordinal);
        Assert.Contains("[00:00:01 | 15:00] hola onu", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("## Summary", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenLanguageIsEnglish_AsksForEnglish()
    {
        var prompt = TranscriptPolishPromptBuilder.Build("hello", "en");

        Assert.Contains("in English", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("in Spanish", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void SplitTimestampedChunks_WhenShort_ReturnsSingleChunk()
    {
        const string transcript = "Recorded 2026-09-02 15:00\n[00:00:01 | 15:00] Hello";

        var chunks = TranscriptPolishPromptBuilder.SplitTimestampedChunks(transcript, 3500);

        Assert.Single(chunks);
        Assert.Equal(transcript, chunks[0]);
    }

    [Fact]
    public void SplitTimestampedChunks_SplitsOnWholeLines()
    {
        var line1 = "[00:00:00 | 15:00] " + new string('a', 40);
        var line2 = "[00:00:30 | 15:00] " + new string('b', 40);
        var transcript = line1 + Environment.NewLine + line2;

        var chunks = TranscriptPolishPromptBuilder.SplitTimestampedChunks(transcript, line1.Length + 10);

        Assert.Equal(2, chunks.Count);
        Assert.Equal(line1, chunks[0]);
        Assert.Equal(line2, chunks[1]);
    }

    [Fact]
    public void SplitTimestampedChunks_SingleLongLine_StaysOneChunk()
    {
        var line = "[00:00:00 | 15:00] " + new string('x', 200);

        var chunks = TranscriptPolishPromptBuilder.SplitTimestampedChunks(line, 50);

        Assert.Single(chunks);
        Assert.Equal(line, chunks[0]);
    }
}
