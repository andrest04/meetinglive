using System.Net;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevAskTests
{
    private const string Transcript = """
        Who will send the doc?
        Ana will send the doc tomorrow.
        Thanks everyone.
        """;

    [Fact]
    public async Task AskAsync_SendsExistsAndWhere_MapsTopHitsToOriginalText()
    {
        var body = AnswersJson(exists: 0.98, probabilities: """
            "L000": 0.03, "L001": 0.95, "L002": 0.01
            """);
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, body));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", Transcript, "Who committed to send the doc?");

        Assert.Equal(MeetingJevAskVerdict.Answered, result.Verdict);
        Assert.Equal(0.98, result.Exists);
        Assert.Equal(2, result.Hits.Count);
        Assert.Equal("L001", result.Hits[0].LineId);
        Assert.Equal(1, result.Hits[0].Index);
        Assert.Equal("Ana will send the doc tomorrow.", result.Hits[0].Text);
        Assert.Equal(0.95, result.Hits[0].Score);
        Assert.Equal("L000", result.Hits[1].LineId);
        Assert.Equal("Who will send the doc?", result.Hits[1].Text);
        Assert.Single(handler.Requests);

        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var root = document.RootElement;
        Assert.Equal("L000| Who will send the doc?\nL001| Ana will send the doc tomorrow.\nL002| Thanks everyone.", root.GetProperty("state").GetString());
        var questions = root.GetProperty("questions");
        Assert.Equal("noul", questions.GetProperty("exists").GetProperty("type").GetString());
        Assert.Contains("Who committed to send the doc?", questions.GetProperty("exists").GetProperty("instructions").GetString(), StringComparison.Ordinal);
        Assert.Equal("choice", questions.GetProperty("where").GetProperty("type").GetString());
        var criteria = questions.GetProperty("where").GetProperty("criteria");
        Assert.Equal(JsonValueKind.Null, criteria.GetProperty("L000").ValueKind);
        Assert.True(criteria.TryGetProperty("L001", out _));
        Assert.True(criteria.TryGetProperty("L002", out _));
        Assert.DoesNotContain("secret-key", handler.LastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AskAsync_WhenExistsIs014_ReturnsAbsentEvenIfWherePickedALine()
    {
        var body = AnswersJson(exists: 0.14, probabilities: """
            "L000": 0.86, "L001": 0.10, "L002": 0.04
            """);
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, body));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", Transcript, "do we have to go to arbitration?");

        Assert.Equal(MeetingJevAskVerdict.Absent, result.Verdict);
        Assert.Equal(0.14, result.Exists);
        Assert.Equal("L000", result.Hits[0].LineId);
        Assert.Equal(0.86, result.Hits[0].Score);
    }

    [Fact]
    public async Task AskAsync_WhenExistsIs098_ReturnsAnswered()
    {
        var body = AnswersJson(exists: 0.98, probabilities: """
            "L001": 0.97, "L000": 0.03
            """);
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, body));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", Transcript, "Who will send the doc?");

        Assert.Equal(MeetingJevAskVerdict.Answered, result.Verdict);
        Assert.Equal(0.98, result.Exists);
        Assert.Equal("L001", result.Hits[0].LineId);
        Assert.Equal("Ana will send the doc tomorrow.", result.Hits[0].Text);
    }

    [Fact]
    public async Task AskAsync_WhenQueryEmpty_DoesNotSendHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run."));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", Transcript, "   ");

        Assert.Equal(MeetingJevAskVerdict.Absent, result.Verdict);
        Assert.Empty(result.Hits);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task AskAsync_WhenTranscriptEmpty_DoesNotSendHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run."));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", " \n  \n", "Who committed?");

        Assert.Equal(MeetingJevAskVerdict.Absent, result.Verdict);
        Assert.Empty(result.Hits);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task AskAsync_WhenMoreThan255Lines_SendsWindowThenLineRequests()
    {
        var transcript = string.Join('\n', Enumerable.Range(0, 256).Select(i => $"line {i}"));
        var pass1 = """
            {
              "model": "jev-1.13.0",
              "answers": {
                "exists": { "type": "noul", "noul": 0.81 },
                "where": {
                  "type": "choice",
                  "choice": "W01",
                  "probabilities": { "W00": 0.10, "W01": 0.90 },
                  "confidence": 0.8
                }
              }
            }
            """;
        var pass2 = """
            {
              "model": "jev-1.13.0",
              "answers": {
                "where": {
                  "type": "choice",
                  "choice": "L200",
                  "probabilities": { "L200": 0.70, "L201": 0.20, "L202": 0.10 },
                  "confidence": 0.7
                }
              }
            }
            """;
        var handler = new FakeHttpMessageHandler((_, index) => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            index == 0 ? pass1 : pass2));
        var api = CreateApi(handler);

        var result = await MeetingJevAsk.AskAsync(api, "secret-key", transcript, "Which line is 200?");

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(MeetingJevAskVerdict.Answered, result.Verdict);
        Assert.Equal(0.81, result.Exists);
        Assert.Equal("L200", result.Hits[0].LineId);
        Assert.Equal("line 200", result.Hits[0].Text);
        Assert.Equal(0.70, result.Hits[0].Score);

        using var first = JsonDocument.Parse(handler.RequestBodies[0]!);
        var firstWhere = first.RootElement.GetProperty("questions").GetProperty("where").GetProperty("criteria");
        Assert.True(first.RootElement.GetProperty("questions").TryGetProperty("exists", out _));
        Assert.True(firstWhere.TryGetProperty("W00", out _));
        Assert.True(firstWhere.TryGetProperty("W01", out _));
        Assert.False(firstWhere.TryGetProperty("L000", out _));
        Assert.Equal("line 0", firstWhere.GetProperty("W00").GetString());
        Assert.Equal("line 200", firstWhere.GetProperty("W01").GetString());

        using var second = JsonDocument.Parse(handler.RequestBodies[1]!);
        var secondQuestions = second.RootElement.GetProperty("questions");
        Assert.False(secondQuestions.TryGetProperty("exists", out _));
        var secondWhere = secondQuestions.GetProperty("where").GetProperty("criteria");
        Assert.True(secondWhere.TryGetProperty("L200", out _));
        Assert.False(secondWhere.TryGetProperty("L000", out _));
        Assert.False(secondWhere.TryGetProperty("W01", out _));
        Assert.StartsWith("L200| line 200", second.RootElement.GetProperty("state").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain("secret-key", handler.RequestBodies[0], StringComparison.Ordinal);
        Assert.DoesNotContain("secret-key", handler.RequestBodies[1], StringComparison.Ordinal);
    }

    private static string AnswersJson(double exists, string probabilities) => $$"""
        {
          "model": "jev-1.13.0",
          "answers": {
            "exists": { "type": "noul", "noul": {{exists.ToString(System.Globalization.CultureInfo.InvariantCulture)}} },
            "where": {
              "type": "choice",
              "choice": "L001",
              "probabilities": { {{probabilities}} },
              "confidence": 0.9
            }
          }
        }
        """;

    private static TypeSafeApiClient CreateApi(FakeHttpMessageHandler handler) =>
        new(new HttpClient(handler), (_, _) => Task.CompletedTask);
}
