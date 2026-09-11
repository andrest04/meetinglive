using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class XaiApiClientTests
{
    [Fact]
    public async Task CompleteChatAsync_SendsBearerAndJsonBody_ReturnsContent()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"choices":[{"message":{"role":"assistant","content":"Hello from Grok"}}]}"""));
        var api = new XaiApiClient(new HttpClient(handler));

        var content = await api.CompleteChatAsync("secret-token", "grok-4-fast", "Summarize this", reasoningEffort: "low");

        Assert.Equal("Hello from Grok", content);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://api.x.ai/v1/chat/completions", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "secret-token"), handler.LastRequest.Headers.Authorization);
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        Assert.Equal("grok-4-fast", document.RootElement.GetProperty("model").GetString());
        Assert.Equal(0.3, document.RootElement.GetProperty("temperature").GetDouble());
        Assert.Equal("low", document.RootElement.GetProperty("reasoning_effort").GetString());
        Assert.Equal("user", document.RootElement.GetProperty("messages")[0].GetProperty("role").GetString());
        Assert.Equal("Summarize this", document.RootElement.GetProperty("messages")[0].GetProperty("content").GetString());
        Assert.DoesNotContain("secret-token", handler.LastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CompleteChatAsync_WhenUnauthorized_ThrowsFriendlyNotSignedIn()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.Unauthorized,
            """{"error":"invalid_api_key","access_token":"should-not-leak"}"""));
        var api = new XaiApiClient(new HttpClient(handler));

        var exception = await Assert.ThrowsAsync<XaiException>(
            () => api.CompleteChatAsync("secret-token", "grok-4-fast", "hi"));

        Assert.Equal(XaiFailureKind.NotSignedIn, exception.Kind);
        Assert.Contains("not signed in", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret-token", exception.Message);
        Assert.DoesNotContain("should-not-leak", exception.Message);
        Assert.DoesNotContain("invalid_api_key", exception.Message);
    }

    [Fact]
    public async Task ListModelsAsync_ReturnsSummaryChatIds_ExcludesImagineAgentsAndReasoning()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """
            {"data":[
              {"id":"grok-4.20-0309-reasoning"},
              {"id":"grok-imagine-image"},
              {"id":"grok-4.3"},
              {"id":"grok-build-0.1"},
              {"id":"grok-4.6"},
              {"id":"grok-4.20-multi-agent-0309"},
              {"id":"grok-4.20-0309-non-reasoning"},
              {"id":"gpt-dummy"}
            ]}
            """));
        var api = new XaiApiClient(new HttpClient(handler));

        var models = await api.ListModelsAsync("token");

        Assert.Equal(["grok-4.6", "grok-4.3", "grok-4.20-0309-non-reasoning"], models);
    }

    [Theory]
    [InlineData("grok-4.6", true)]
    [InlineData("grok-4.20-0309-non-reasoning", true)]
    [InlineData("grok-4.20-0309-reasoning", false)]
    [InlineData("grok-4.20-multi-agent-0309", false)]
    [InlineData("grok-imagine-video", false)]
    [InlineData("grok-build-0.1", false)]
    public void IsSummaryChatModel_KeepsTextChat_DropsMediaAgentsAndReasoning(string id, bool expected)
    {
        Assert.Equal(expected, XaiApiClient.IsSummaryChatModel(id));
    }

    [Theory]
    [InlineData(null, new[] { "grok-4.3", "grok-4.6" }, "grok-4.6")]
    [InlineData("", new[] { "grok-4.3" }, "grok-4.3")]
    [InlineData("grok-4.3", new[] { "grok-4.3", "grok-4.6" }, "grok-4.3")]
    [InlineData("grok-imagine-image", new[] { "grok-4.6" }, "grok-4.6")]
    [InlineData(null, new string[0], "grok-4.6")]
    public void ResolveModelId_PicksSavedThenPreferredThenFirst(
        string? selected, string[] listed, string expected)
    {
        Assert.Equal(expected, XaiApiClient.ResolveModelId(selected, listed));
    }
}
