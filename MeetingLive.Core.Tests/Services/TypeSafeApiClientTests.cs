using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class TypeSafeApiClientTests
{
    private const string SuccessBody = """
        {
          "model": "jev-1.13.0",
          "answers": {
            "is_urgent": { "type": "noul", "noul": 0.95 },
            "department": {
              "type": "choice",
              "choice": "billing",
              "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 },
              "confidence": 0.81
            },
            "frustration": {
              "type": "score",
              "score": 1.05,
              "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
              "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
              "confidence": 0.92
            }
          },
          "usage": { "input_tokens": 10, "output_tokens": 5 }
        }
        """;

    [Fact]
    public async Task EvaluateAsync_SendsBearerAndJsonBody_ReturnsNoulChoiceAndScore()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, SuccessBody));
        var api = new TypeSafeApiClient(new HttpClient(handler));
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["is_urgent"] = TypeSafeQuestion.Noul("Does this convey urgency?", "Explicitly time-sensitive", "No urgency expressed"),
            ["department"] = TypeSafeQuestion.Choice(
                "Which team should handle this?",
                new Dictionary<string, string?>
                {
                    ["billing"] = "Payments, invoicing, refunds",
                    ["technical"] = "Bugs, outages, integrations",
                    ["sales"] = "Pricing, upgrades, new accounts",
                }),
            ["frustration"] = TypeSafeQuestion.Score(
                "How frustrated is the customer?",
                ["Calm", "Frustrated", "Very angry"]),
        };

        var result = await api.EvaluateAsync("secret-key", new { ticket = "Help! My payouts have been failing." }, questions);

        Assert.Equal("jev-1.13.0", result.Model);
        Assert.Equal(0.95, result.Answers["is_urgent"].Noul);
        Assert.Equal("billing", result.Answers["department"].Choice);
        Assert.Equal(0.81, result.Answers["department"].Confidence);
        Assert.Equal(1.05, result.Answers["frustration"].Score);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://api.typesafe.ai/v1/systemone", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "secret-key"), handler.LastRequest.Headers.Authorization);
        Assert.True(handler.LastRequest.Headers.TryGetValues("User-Agent", out var userAgent));
        Assert.Contains(userAgent, value => value.Contains("MeetingLive", StringComparison.Ordinal));
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        Assert.Equal("jev-latest", document.RootElement.GetProperty("model").GetString());
        Assert.Equal("Help! My payouts have been failing.", document.RootElement.GetProperty("state").GetProperty("ticket").GetString());
        Assert.Equal("noul", document.RootElement.GetProperty("questions").GetProperty("is_urgent").GetProperty("type").GetString());
        Assert.Equal("choice", document.RootElement.GetProperty("questions").GetProperty("department").GetProperty("type").GetString());
        Assert.Equal("score", document.RootElement.GetProperty("questions").GetProperty("frustration").GetProperty("type").GetString());
        Assert.DoesNotContain("secret-key", handler.LastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EvaluateAsync_WhenUnauthorized_ThrowsUnauthorizedWithoutLeakingBodyOrKey()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.Unauthorized,
            """{"error":"invalid_api_key","api_key":"should-not-leak"}"""));
        var api = new TypeSafeApiClient(new HttpClient(handler));
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["is_urgent"] = TypeSafeQuestion.Noul("Does this convey urgency?"),
        };

        var exception = await Assert.ThrowsAsync<TypeSafeException>(
            () => api.EvaluateAsync("secret-key", "hello", questions));

        Assert.Equal(TypeSafeFailureKind.Unauthorized, exception.Kind);
        Assert.DoesNotContain("secret-key", exception.Message);
        Assert.DoesNotContain("should-not-leak", exception.Message);
        Assert.DoesNotContain("invalid_api_key", exception.Message);
    }

    [Fact]
    public async Task EvaluateAsync_WhenRateLimitedThenOk_RetriesAndSucceeds()
    {
        var handler = new FakeHttpMessageHandler((_, index) => index == 0
            ? FakeHttpMessageHandler.JsonResponse(
                HttpStatusCode.TooManyRequests,
                """{"error":"slow down","api_key":"should-not-leak"}""")
            : FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, SuccessBody));
        var api = new TypeSafeApiClient(new HttpClient(handler), (_, _) => Task.CompletedTask);
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["is_urgent"] = TypeSafeQuestion.Noul("Does this convey urgency?"),
        };

        var result = await api.EvaluateAsync("secret-key", "hello", questions);

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(0.95, result.Answers["is_urgent"].Noul);
        Assert.DoesNotContain("should-not-leak", result.Model);
    }

    [Fact]
    public async Task ListModelsAsync_ReturnsModelNames()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"models":[{"name":"jev-latest","description":"flagship","release_date":"2026-01-01"},{"name":"jev-preview","description":"preview","release_date":"2026-01-02"}]}"""));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var models = await api.ListModelsAsync("secret-key");

        Assert.Equal(["jev-latest", "jev-preview"], models);
        Assert.Equal(HttpMethod.Get, handler.LastRequest!.Method);
        Assert.Equal("https://api.typesafe.ai/v1/models", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "secret-key"), handler.LastRequest.Headers.Authorization);
    }
}
