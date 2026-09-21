using System.Net;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevAnalyzerTests
{
    private const string CannedAnswers = """
        {
          "model": "jev-1.13.0",
          "answers": {
            "meeting_type": { "type": "choice", "choice": "standup", "probabilities": { "standup": 0.9 }, "confidence": 0.85 },
            "spoken_language": { "type": "choice", "choice": "en", "probabilities": { "en": 1.0 }, "confidence": 0.99 },
            "urgency": {
              "type": "score",
              "score": 1.0,
              "legend": { "0": "routine", "1": "time_sensitive", "2": "blocking" },
              "probabilities": { "0": 0.0, "1": 1.0, "2": 0.0 },
              "confidence": 0.9
            },
            "contains_decisions": { "type": "noul", "noul": 0.8 },
            "contains_commitments": { "type": "noul", "noul": 0.2 },
            "pii_present": { "type": "noul", "noul": 0.01 },
            "summary_faithful": { "type": "noul", "noul": 0.7 },
            "folder": { "type": "choice", "choice": "inbox", "probabilities": { "inbox": 0.7, "none": 0.3 }, "confidence": 0.5 },
            "item_0_relation": {
              "type": "choice",
              "choice": "supports",
              "probabilities": { "supports": 0.9, "contradicts": 0.05, "says_nothing": 0.05 },
              "confidence": 0.88
            }
          },
          "usage": { "input_tokens": 1, "output_tokens": 1 }
        }
        """;

    [Fact]
    public async Task AnalyzeAsync_BuildsFanOutRequest_ContainsExpectedQuestionIdsAndState()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, CannedAnswers));
        var analyzer = CreateAnalyzer(handler);
        var folderId = Guid.NewGuid();
        var request = new MeetingJevRequest
        {
            Title = "Monday standup",
            Transcript = "We decided to ship the patch today. Ana will file the bug.",
            Summary = "Ship the patch. Ana files the bug.",
            ActionItems = ["Ana files the bug"],
            FolderPathItems =
            [
                new FolderPathItem(null, "Inbox"),
                new FolderPathItem(folderId, "Engineering/Standups"),
            ],
        };

        var analysis = await analyzer.AnalyzeAsync(request);

        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var root = document.RootElement;
        Assert.Equal("jev-latest", root.GetProperty("model").GetString());
        Assert.Equal("Monday standup", root.GetProperty("state").GetProperty("meeting").GetProperty("title").GetString());
        Assert.Contains("ship the patch", root.GetProperty("state").GetProperty("transcript").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Ship the patch. Ana files the bug.", root.GetProperty("state").GetProperty("summary").GetString());
        Assert.Equal(0, root.GetProperty("state").GetProperty("action_items")[0].GetProperty("index").GetInt32());
        Assert.Equal("Ana files the bug", root.GetProperty("state").GetProperty("action_items")[0].GetProperty("text").GetString());
        var questions = root.GetProperty("questions");
        foreach (var id in new[]
                 {
                     "meeting_type", "spoken_language", "urgency", "contains_decisions",
                     "contains_commitments", "pii_present", "summary_faithful", "folder", "item_0_relation",
                 })
        {
            Assert.True(questions.TryGetProperty(id, out _), $"Missing question '{id}'.");
        }

        Assert.Equal("standup", analysis.MeetingType);
        Assert.Equal(0.85, analysis.MeetingTypeConfidence);
        Assert.Equal("en", analysis.SpokenLanguage);
        Assert.Equal(1.0, analysis.UrgencyScore);
        Assert.Equal(0.8, analysis.ContainsDecisions);
        Assert.Equal(0.7, analysis.SummaryFaithful);
        Assert.Equal("inbox", analysis.SuggestedFolderId);
        Assert.Equal("jev-1.13.0", analysis.Model);
        Assert.Equal(0.8, MeetingJevAnalyzer.AutoAcceptConfidence);
        Assert.DoesNotContain("secret-key", handler.LastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeAsync_WhenSummaryEmpty_OmitsSummaryFaithfulAndMapsVerdicts()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, CannedAnswers));
        var analyzer = CreateAnalyzer(handler);
        var request = new MeetingJevRequest
        {
            Title = "Monday standup",
            Transcript = "Ana will file the bug.",
            Summary = "   ",
            ActionItems = ["Ana files the bug"],
            FolderPathItems = [new FolderPathItem(null, "Inbox")],
        };

        var analysis = await analyzer.AnalyzeAsync(request);

        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var questions = document.RootElement.GetProperty("questions");
        Assert.False(questions.TryGetProperty("summary_faithful", out _));
        Assert.True(questions.TryGetProperty("folder", out _));
        Assert.Null(analysis.SummaryFaithful);
        Assert.Equal("inbox", analysis.SuggestedFolderId);
        Assert.Equal(0.5, analysis.FolderConfidence);
        var verdict = Assert.Single(analysis.ActionItems);
        Assert.Equal("Ana files the bug", verdict.Text);
        Assert.Equal("supports", verdict.Relation);
        Assert.Equal(0.88, verdict.Confidence);
    }

    [Fact]
    public async Task AnalyzeAsync_WhenMoreThan20ActionItems_CapsRelationQuestionsAt20()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, CannedAnswers));
        var analyzer = CreateAnalyzer(handler);
        var items = Enumerable.Range(0, 21).Select(i => $"Do task {i}").ToArray();
        var request = new MeetingJevRequest
        {
            Title = "Planning",
            Transcript = "Many tasks were assigned.",
            ActionItems = items,
        };

        await analyzer.AnalyzeAsync(request);

        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var questions = document.RootElement.GetProperty("questions");
        var actionItems = document.RootElement.GetProperty("state").GetProperty("action_items");
        Assert.Equal(20, actionItems.GetArrayLength());
        Assert.True(questions.TryGetProperty("item_19_relation", out _));
        Assert.False(questions.TryGetProperty("item_20_relation", out _));
        Assert.False(questions.TryGetProperty("folder", out _));
        Assert.False(questions.TryGetProperty("summary_faithful", out _));
    }

    private static MeetingJevAnalyzer CreateAnalyzer(FakeHttpMessageHandler handler)
    {
        var api = new TypeSafeApiClient(new HttpClient(handler), (_, _) => Task.CompletedTask);
        return new MeetingJevAnalyzer(api, "secret-key");
    }
}
