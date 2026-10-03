using System.Net;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class XaiSummaryProviderTests
{
    [Fact]
    public async Task SummarizeAsync_ParsesSummaryAndActionItems()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """
            {"choices":[{"message":{"content":"## Summary\n\nKickoff meeting.\n\n## Action Items\n\n- [ ] Send the invite"}}]}
            """));
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, "key", null, null));
        var http = new HttpClient(handler);
        var provider = new XaiSummaryProvider(
            new XaiAuthSession(store, new XaiOAuthClient(http)),
            new XaiApiClient(http),
            "grok-4-fast");

        var result = await provider.SummarizeAsync("Hello everyone.", "Kickoff", DateTimeOffset.UtcNow);

        Assert.Equal("Kickoff meeting.", result.SummaryMarkdown);
        Assert.Single(result.ActionItems);
        Assert.Equal("Send the invite", result.ActionItems[0].Text);
        Assert.Equal(XaiSummaryProvider.ProviderId, result.ProviderId);
        var prompt = ChatPrompt(handler.LastRequestBody);
        Assert.Contains("<transcript>", prompt);
        Assert.Contains("Hello everyone.", prompt);
    }

    [Fact]
    public async Task SuggestTitleAsync_UsesTitlePromptBuilder()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"choices":[{"message":{"content":"Q3 planning with Ana"}}]}"""));
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, "key", null, null));
        var http = new HttpClient(handler);
        var provider = new XaiSummaryProvider(
            new XaiAuthSession(store, new XaiOAuthClient(http)),
            new XaiApiClient(http),
            "grok-4-fast");

        var raw = await provider.SuggestTitleAsync(
            "We will plan Q3 with Ana.",
            DateTimeOffset.UtcNow,
            outputLanguage: "en");

        Assert.Equal("Q3 planning with Ana", SuggestedMeetingTitle.FromModelResponse(raw));
        var prompt = ChatPrompt(handler.LastRequestBody);
        Assert.Contains("ONLY a short title", prompt);
        Assert.Contains("We will plan Q3 with Ana.", prompt);
        Assert.DoesNotContain("## Summary", prompt);
        Assert.DoesNotContain("Action Items", prompt);
        Assert.DoesNotContain("<meeting_title>", prompt);
        Assert.DoesNotContain("exactly three Markdown sections", prompt);
    }

    [Fact]
    public async Task CompletePromptAsync_SendsPromptInChatBody()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"choices":[{"message":{"content":"## What you need to do\n\n- [ ] Send the deck"}}]}"""));
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, "key", null, null));
        var http = new HttpClient(handler);
        var provider = new XaiSummaryProvider(
            new XaiAuthSession(store, new XaiOAuthClient(http)),
            new XaiApiClient(http),
            "grok-4-fast");

        var result = await provider.CompletePromptAsync("Write a checklist from evidence.");

        Assert.Equal("## What you need to do\n\n- [ ] Send the deck", result);
        Assert.Equal("Write a checklist from evidence.", ChatPrompt(handler.LastRequestBody));
    }

    [Fact]
    public async Task StreamPromptAsync_StreamsChunksFromChatCompletions()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """
                data: {"choices":[{"delta":{"content":"## What"}}]}

                data: {"choices":[{"delta":{"content":" you need"}}]}

                data: [DONE]

                """,
                System.Text.Encoding.UTF8,
                "text/event-stream"),
        });
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, "key", null, null));
        var http = new HttpClient(handler);
        ISummaryProvider provider = new XaiSummaryProvider(
            new XaiAuthSession(store, new XaiOAuthClient(http)),
            new XaiApiClient(http),
            "grok-4-fast");

        var chunks = new List<string>();
        await foreach (var chunk in provider.StreamPromptAsync("Write a checklist from evidence."))
            chunks.Add(chunk);

        Assert.Equal(["## What", " you need"], chunks);
        Assert.Equal("Write a checklist from evidence.", ChatPrompt(handler.LastRequestBody));
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        Assert.True(document.RootElement.GetProperty("stream").GetBoolean());
    }

    private static string ChatPrompt(string? requestBody)
    {
        using var document = JsonDocument.Parse(requestBody!);
        return document.RootElement.GetProperty("messages")[0].GetProperty("content").GetString() ?? string.Empty;
    }
}
