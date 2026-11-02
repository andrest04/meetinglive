using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

/// <summary>
/// Drives the map and merge flow with a fake model and a fake token counter. No GGUF model is
/// available to tests, so these prove the plan and the budget against the counter, not what a
/// real model writes or how LLamaSharp counts.
/// </summary>
public class LocalLlmSummaryMapReduceTests
{
    private const string FinalResponse = """
        ## Title

        Budget review

        ## Summary

        ### Key points
        - The budget was approved.

        ## Action Items

        - [ ] Send the deck — Owner: Ana
        """;

    private static readonly DateTimeOffset RecordedAt = new(2026, 3, 2, 10, 0, 0, TimeSpan.Zero);

    private static int CountTokens(string text) => text.Length / 3;

    private static LocalLlmSummaryRequest Request(string transcript, SummaryEnhancementContext? enhancement = null) =>
        new("Weekly sync", RecordedAt, transcript, "en", RecordedAt.AddHours(1), enhancement);

    private static string Transcript(int lines) =>
        string.Join("\n", Enumerable.Range(0, lines).Select(i => $"[00:{i:0000}.00-00:{i:0000}.50] [ Speaker-1 ] word{i} is what was said here"));

    /// <summary>Records every call; a final prompt gets the contract, the rest get short notes.</summary>
    private sealed class FakeModel(string noteText = "- a note")
    {
        public List<(string Prompt, int MaxTokens)> Calls { get; } = [];

        public Task<string> InferAsync(string prompt, int maxTokens, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls.Add((prompt, maxTokens));
            return Task.FromResult(
                maxTokens == LocalLlmSummaryMapReduce.FinalMaxOutputTokens ? FinalResponse : $"{noteText} {Calls.Count}");
        }
    }

    private static void AssertEveryCallFits(FakeModel model)
    {
        foreach (var (prompt, maxTokens) in model.Calls)
            Assert.True(CountTokens(prompt) + maxTokens <= LocalLlmSummaryMapReduce.ContextTokens, $"Prompt of {CountTokens(prompt)} tokens with {maxTokens} of output overflows.");
    }

    [Fact]
    public async Task Summarize_WhenTheTranscriptFits_SendsTheFullPromptOnce()
    {
        var model = new FakeModel();
        var transcript = Transcript(3);

        var raw = await LocalLlmSummaryMapReduce.SummarizeAsync(Request(transcript), CountTokens, model.InferAsync);

        var call = Assert.Single(model.Calls);
        Assert.Equal(CliSummaryPromptBuilder.Build("Weekly sync", RecordedAt, transcript, "en", RecordedAt.AddHours(1)), call.Prompt);
        Assert.Equal(LocalLlmSummaryMapReduce.FinalMaxOutputTokens, call.MaxTokens);
        Assert.Equal(FinalResponse, raw);
    }

    [Fact]
    public async Task Summarize_WhenTheTranscriptIsLong_EveryPromptFitsTheContext()
    {
        var model = new FakeModel();

        await LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(1500)), CountTokens, model.InferAsync);

        Assert.True(model.Calls.Count > 1);
        AssertEveryCallFits(model);
    }

    [Fact]
    public async Task Summarize_WhenTheTranscriptIsLong_NoLineIsLeftOut()
    {
        var model = new FakeModel();
        const int lines = 1500;

        await LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(lines)), CountTokens, model.InferAsync);

        var mapPrompts = model.Calls
            .Where(call => call.Prompt.Contains("<transcript_part>", StringComparison.Ordinal))
            .Select(call => call.Prompt)
            .ToList();
        var position = -1;
        for (var i = 0; i < lines; i++)
        {
            var next = mapPrompts.FindIndex(Math.Max(position, 0), prompt => prompt.Contains($"word{i} is what", StringComparison.Ordinal));
            Assert.True(next >= 0, $"Line {i} reached no prompt, or came out of order.");
            position = next;
        }
    }

    [Fact]
    public async Task Summarize_WhenTheTranscriptIsLong_TheFinalPromptIsTheFullContract()
    {
        var model = new FakeModel();
        var enhancement = new SummaryEnhancementContext(RawNotes: "Remember the deck");

        var raw = await LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(200), enhancement), CountTokens, model.InferAsync);

        var final = model.Calls[^1];
        Assert.Equal(LocalLlmSummaryMapReduce.FinalMaxOutputTokens, final.MaxTokens);
        Assert.Contains("## Action Items", final.Prompt, StringComparison.Ordinal);
        Assert.Contains("<meeting_title>Weekly sync</meeting_title>", final.Prompt, StringComparison.Ordinal);
        Assert.Contains("Remember the deck", final.Prompt, StringComparison.Ordinal);
        Assert.Contains("- a note 1", final.Prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("word0 is what", final.Prompt, StringComparison.Ordinal);

        var (summary, actionItems, title) = SummaryMarkdownSplitter.Split(raw);
        Assert.Equal("Budget review", title);
        Assert.Contains("The budget was approved", summary, StringComparison.Ordinal);
        Assert.Single(actionItems);
    }

    [Fact]
    public async Task Summarize_WhenTheNotesDoNotFit_MergesThemAndKeepsEveryPromptInBudget()
    {
        var longNote = string.Join(' ', Enumerable.Repeat("detail", 250));
        var model = new FakeModel(longNote);

        await LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(6000)), CountTokens, model.InferAsync);

        Assert.Contains(model.Calls, call => call.Prompt.Contains("<notes_part>", StringComparison.Ordinal));
        AssertEveryCallFits(model);
        Assert.Equal(LocalLlmSummaryMapReduce.FinalMaxOutputTokens, model.Calls[^1].MaxTokens);
    }

    [Fact]
    public async Task Summarize_WhenALineIsLongerThanAChunk_SplitsItAndKeepsEveryWord()
    {
        var model = new FakeModel();
        var words = Enumerable.Range(0, 8000).Select(i => $"w{i}x").ToList();

        await LocalLlmSummaryMapReduce.SummarizeAsync(Request(string.Join(' ', words)), CountTokens, model.InferAsync);

        AssertEveryCallFits(model);
        var sent = string.Join(' ', model.Calls.Select(call => call.Prompt));
        Assert.All(words, word => Assert.Contains(word, sent, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Summarize_WhenCancelled_StopsBeforeTheNextCall()
    {
        var model = new FakeModel();
        using var cts = new CancellationTokenSource();

        Task<string> CancelAfterFirst(string prompt, int maxTokens, CancellationToken token)
        {
            cts.Cancel();
            return model.InferAsync(prompt, maxTokens, CancellationToken.None);
        }

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(1500)), CountTokens, CancelAfterFirst, cts.Token));

        Assert.Single(model.Calls);
    }

    [Fact]
    public async Task Summarize_WhenTheTranscriptExceedsTheBound_FailsBeforeAnyInference()
    {
        var model = new FakeModel();
        var words = string.Join('\n', Enumerable.Repeat(new string('x', 3000), 300));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            LocalLlmSummaryMapReduce.SummarizeAsync(Request(words), CountTokens, model.InferAsync));

        Assert.Empty(model.Calls);
        Assert.Contains("too long", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Summarize_WhenTheSuppliedNotesLeaveNoRoom_FailsBeforeAnyInference()
    {
        var model = new FakeModel();
        var enhancement = new SummaryEnhancementContext(RawNotes: new string('n', 12000));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(3), enhancement), CountTokens, model.InferAsync));

        Assert.Empty(model.Calls);
        Assert.Contains("notes", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Summarize_WhenAChunkFails_TheErrorReachesTheCaller()
    {
        var calls = 0;

        Task<string> FailSecond(string prompt, int maxTokens, CancellationToken token) =>
            ++calls == 2 ? throw new InvalidOperationException("The local model did not return any content.") : Task.FromResult("- note");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            LocalLlmSummaryMapReduce.SummarizeAsync(Request(Transcript(1500)), CountTokens, FailSecond));

        Assert.Equal(2, calls);
    }

    [Fact]
    public void SplitToBudget_KeepsLinesTogetherAndInOrder()
    {
        var chunks = LocalLlmSummaryMapReduce.SplitToBudget("aaaaaa\nbbbbbb\ncccccc", 5, CountTokens);

        Assert.Equal(["aaaaaa", "bbbbbb", "cccccc"], chunks.Select(chunk => chunk.Trim()));
        Assert.All(chunks, chunk => Assert.True(CountTokens(chunk) <= 5));
    }

    [Fact]
    public void SplitToBudget_WithoutWhitespace_StillKeepsEveryCharacter()
    {
        var text = new string('z', 1000);

        var chunks = LocalLlmSummaryMapReduce.SplitToBudget(text, 50, CountTokens);

        Assert.Equal(text, string.Concat(chunks));
        Assert.All(chunks, chunk => Assert.True(CountTokens(chunk) <= 50));
    }

    [Fact]
    public void SplitToBudget_NeverSplitsASurrogatePair()
    {
        var text = string.Concat(Enumerable.Repeat("\U0001F600", 200));

        var chunks = LocalLlmSummaryMapReduce.SplitToBudget(text, 20, CountTokens);

        Assert.Equal(text, string.Concat(chunks));
        Assert.All(chunks, chunk => Assert.False(char.IsLowSurrogate(chunk[0])));
    }
}
