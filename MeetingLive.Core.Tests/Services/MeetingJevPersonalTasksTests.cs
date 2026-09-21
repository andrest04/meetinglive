using System.Net;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevPersonalTasksTests
{
    private const string Transcript = """
        Status update on the API.
        Please send the TV1 deck tomorrow.
        Thanks everyone.
        """;

    [Fact]
    public async Task FindAsync_WhenTranscriptEmpty_DoesNotSendHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run."));
        var api = CreateApi(handler);

        var result = await MeetingJevPersonalTasks.FindAsync(api, "secret-key", " \n  \n", topic: null);

        Assert.Equal(MeetingJevAskVerdict.Absent, result.Verdict);
        Assert.Empty(result.Evidence);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task FindAsync_KeepsOnlyHighTaskNouls()
    {
        var existsBody = ExistsJson(0.92);
        var linesBody = LinesJson(
            ("line_L000_task", 0.20),
            ("line_L001_task", 0.91),
            ("line_L002_task", 0.40));
        var handler = new FakeHttpMessageHandler((_, index) => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            index == 0 ? existsBody : linesBody));
        var api = CreateApi(handler);

        var result = await MeetingJevPersonalTasks.FindAsync(api, "secret-key", Transcript, topic: null);

        Assert.Equal(MeetingJevAskVerdict.Answered, result.Verdict);
        Assert.Equal(0.92, result.Exists);
        Assert.Single(result.Evidence);
        Assert.Equal("L001", result.Evidence[0].Line.Id);
        Assert.Equal("Please send the TV1 deck tomorrow.", result.Evidence[0].Line.Text);
        Assert.Equal(0.91, result.Evidence[0].Score);
        Assert.Equal(2, handler.Requests.Count);

        using var existsRequest = JsonDocument.Parse(handler.RequestBodies[0]!);
        Assert.Equal("noul", existsRequest.RootElement.GetProperty("questions").GetProperty("exists").GetProperty("type").GetString());
        Assert.Contains("work the listener should do", existsRequest.RootElement.GetProperty("questions").GetProperty("exists").GetProperty("instructions").GetString(), StringComparison.Ordinal);
        Assert.False(existsRequest.RootElement.GetProperty("questions").TryGetProperty("line_L001_task", out _));

        using var linesRequest = JsonDocument.Parse(handler.RequestBodies[1]!);
        var questions = linesRequest.RootElement.GetProperty("questions");
        Assert.False(questions.TryGetProperty("exists", out _));
        Assert.Equal(
            "Is this line a request or commitment the listener should act on?",
            questions.GetProperty("line_L001_task").GetProperty("instructions").GetProperty("question").GetString());
        Assert.Equal("Please send the TV1 deck tomorrow.", questions.GetProperty("line_L001_task").GetProperty("instructions").GetProperty("line").GetString());
        Assert.DoesNotContain("secret-key", handler.LastRequestBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FindAsync_WhenTopicSet_RequiresBothTaskAndTopic()
    {
        var existsBody = ExistsJson(0.88);
        var linesBody = LinesJson(
            ("line_L000_task", 0.90),
            ("line_L000_topic", 0.20),
            ("line_L001_task", 0.90),
            ("line_L001_topic", 0.93),
            ("line_L002_task", 0.40),
            ("line_L002_topic", 0.91));
        var handler = new FakeHttpMessageHandler((_, index) => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            index == 0 ? existsBody : linesBody));
        var api = CreateApi(handler);

        var result = await MeetingJevPersonalTasks.FindAsync(api, "secret-key", Transcript, "TV1");

        Assert.Equal(MeetingJevAskVerdict.Answered, result.Verdict);
        Assert.Single(result.Evidence);
        Assert.Equal("L001", result.Evidence[0].Line.Id);
        Assert.Equal(0.90, result.Evidence[0].Score);

        using var existsRequest = JsonDocument.Parse(handler.RequestBodies[0]!);
        Assert.Contains("about `TV1`", existsRequest.RootElement.GetProperty("questions").GetProperty("exists").GetProperty("instructions").GetString(), StringComparison.Ordinal);

        using var linesRequest = JsonDocument.Parse(handler.RequestBodies[1]!);
        var questions = linesRequest.RootElement.GetProperty("questions");
        Assert.True(questions.TryGetProperty("line_L001_task", out _));
        Assert.True(questions.TryGetProperty("line_L001_topic", out _));
        Assert.Equal("Is this line about `TV1`?", questions.GetProperty("line_L001_topic").GetProperty("instructions").GetProperty("question").GetString());
    }

    [Fact]
    public async Task FindAsync_WhenExistsIs01_ReturnsAbsentEvenIfLineScored()
    {
        var existsBody = ExistsJson(0.10);
        var linesBody = LinesJson(("line_L000_task", 0.99), ("line_L001_task", 0.98), ("line_L002_task", 0.10));
        var handler = new FakeHttpMessageHandler((_, index) => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            index == 0 ? existsBody : linesBody));
        var api = CreateApi(handler);

        var result = await MeetingJevPersonalTasks.FindAsync(api, "secret-key", Transcript, topic: null);

        Assert.Equal(MeetingJevAskVerdict.Absent, result.Verdict);
        Assert.Equal(0.10, result.Exists);
        Assert.Equal(2, result.Evidence.Count);
        Assert.Equal("L000", result.Evidence[0].Line.Id);
        Assert.Equal(0.99, result.Evidence[0].Score);
    }

    [Fact]
    public async Task FindAsync_WhenMoreThan40Lines_BatchesNoulsPerRequest()
    {
        var transcript = string.Join('\n', Enumerable.Range(0, 41).Select(i => $"line {i}"));
        var handler = new FakeHttpMessageHandler((_, index) => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            index == 0 ? ExistsJson(0.80) : LinesJsonForRange(index == 1 ? 0 : 40, index == 1 ? 40 : 41, 0.70)));
        var api = CreateApi(handler);

        var result = await MeetingJevPersonalTasks.FindAsync(api, "secret-key", transcript, topic: null);

        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal(15, result.Evidence.Count);

        using var firstBatch = JsonDocument.Parse(handler.RequestBodies[1]!);
        Assert.Equal(40, firstBatch.RootElement.GetProperty("questions").EnumerateObject().Count());
        using var secondBatch = JsonDocument.Parse(handler.RequestBodies[2]!);
        var secondQuestions = secondBatch.RootElement.GetProperty("questions").EnumerateObject().ToArray();
        Assert.Single(secondQuestions);
        Assert.Equal("line_L040_task", secondQuestions[0].Name);
    }

    private static string ExistsJson(double exists) => $$"""
        {
          "model": "jev-1.13.0",
          "answers": {
            "exists": { "type": "noul", "noul": {{exists.ToString(System.Globalization.CultureInfo.InvariantCulture)}} }
          }
        }
        """;

    private static string LinesJson(params (string Id, double Noul)[] answers)
    {
        var items = string.Join(",\n", answers.Select(item =>
            $"\"{item.Id}\": {{ \"type\": \"noul\", \"noul\": {item.Noul.ToString(System.Globalization.CultureInfo.InvariantCulture)} }}"));
        return $$"""
            {
              "model": "jev-1.13.0",
              "answers": {
                {{items}}
              }
            }
            """;
    }

    private static string LinesJsonForRange(int start, int endExclusive, double noul)
    {
        var answers = Enumerable.Range(start, endExclusive - start)
            .Select(i => ($"line_L{i:000}_task", noul))
            .ToArray();
        return LinesJson(answers);
    }

    private static TypeSafeApiClient CreateApi(FakeHttpMessageHandler handler) =>
        new(new HttpClient(handler), (_, _) => Task.CompletedTask);
}
