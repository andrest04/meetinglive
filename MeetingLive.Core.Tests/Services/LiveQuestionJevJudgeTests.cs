using System.Net;
using System.Text.Json;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class LiveQuestionJevJudgeTests
{
    private const string ApiKey = "secret-key";

    [Fact]
    public async Task JudgeAsync_WhenNewLine_SendsOneNoulRequestAndSkipsAlreadyCommittedLine()
    {
        var alreadyCommitted = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(5),
            "We shipped the release yesterday.");
        var newLine = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromMinutes(2),
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(8),
            "What is the rollback plan?");
        var header = TranscriptStampFormatter.FormatHeader(new DateTimeOffset(2026, 9, 21, 15, 0, 0, TimeSpan.Zero));
        var current = string.Join("\n", header, alreadyCommitted, newLine);
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.5)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, alreadyCommitted, current);

        Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://api.typesafe.ai/v1/systemone", handler.LastRequest.RequestUri!.ToString());
        Assert.DoesNotContain(ApiKey, handler.LastRequestBody, StringComparison.Ordinal);
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        Assert.Equal("jev-latest", document.RootElement.GetProperty("model").GetString());
        var state = document.RootElement.GetProperty("state");
        Assert.Equal("What is the rollback plan?", state.GetProperty("new_lines").EnumerateArray().Single().GetString());
        Assert.Contains("What is the rollback plan?", state.GetProperty("recent_transcript").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain("We shipped the release yesterday.", state.GetRawText(), StringComparison.Ordinal);
        var questions = document.RootElement.GetProperty("questions");
        Assert.Single(questions.EnumerateObject());
        var question = questions.GetProperty("line_0");
        Assert.Equal("noul", question.GetProperty("type").GetString());
        Assert.Equal("What is the rollback plan?", question.GetProperty("instructions").GetProperty("line").GetString());
        Assert.Equal(
            LiveQuestionJevJudge.DirectQuestionInstructions,
            question.GetProperty("instructions").GetProperty("question").GetString());
        Assert.Equal(LiveQuestionJevJudge.TrueCriteria, question.GetProperty("criteria").GetProperty("true").GetString());
        Assert.Equal(LiveQuestionJevJudge.FalseCriteria, question.GetProperty("criteria").GetProperty("false").GetString());
        Assert.DoesNotContain("We shipped the release yesterday.", question.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("Recorded ", question.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task JudgeAsync_WhenNoulIsHigh_ReturnsStrippedLineBody()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(4),
            TimeSpan.FromSeconds(9),
            "What is the rollback plan?",
            speakerTag: 3);
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.91)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, line);

        Assert.Equal("What is the rollback plan?", armed);
        Assert.DoesNotContain("Speaker-", armed, StringComparison.Ordinal);
        Assert.DoesNotContain("[", armed, StringComparison.Ordinal);
    }

    [Fact]
    public async Task JudgeAsync_WhenNoulEqualsArmThreshold_ReturnsLineBody()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(6),
            "What is the rollback plan?");
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.7)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, line);

        Assert.Equal("What is the rollback plan?", armed);
    }

    [Fact]
    public async Task JudgeAsync_WhenNoulIsLow_ReturnsNull()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(4),
            "What is the rollback plan?");
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.2)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, line);

        Assert.Null(armed);
        Assert.Single(handler.Requests);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    public async Task JudgeAsync_WhenTranscriptHasNoLines_DoesNotCallHttp(string? previous, string? current)
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not be called."));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previous, current);

        Assert.Null(armed);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task JudgeAsync_WhenCommittedTextUnchanged_DoesNotCallHttp()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(8),
            "What is the rollback plan?");
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not be called."));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, line, line);

        Assert.Null(armed);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task JudgeAsync_WhenOnlyHeadersAreNew_DoesNotCallHttp()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(8),
            "What is the rollback plan?");
        var current = string.Join(
            "\n",
            TranscriptStampFormatter.FormatHeader(new DateTimeOffset(2026, 9, 21, 15, 0, 0, TimeSpan.Zero)),
            TranscriptStampFormatter.FormatEnded(new DateTimeOffset(2026, 9, 21, 16, 0, 0, TimeSpan.Zero)),
            line);
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not be called."));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, line, current);

        Assert.Null(armed);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task JudgeAsync_WhenSeveralNewLines_ReturnsLastLineAtOrAboveThreshold()
    {
        var first = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromMinutes(2),
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(6),
            "What is the rollback plan?");
        var second = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(6),
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(10),
            "and the third one?");
        var third = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(10),
            TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(16),
            "Who owns the migration?");
        var current = string.Join("\n", first, second, third);
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(
            ("line_0", 0.91),
            ("line_1", 0.2),
            ("line_2", 0.85)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, current);

        Assert.Equal("Who owns the migration?", armed);
        Assert.Single(handler.Requests);
        Assert.Equal("https://api.typesafe.ai/v1/systemone", handler.LastRequest!.RequestUri!.ToString());
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var questions = document.RootElement.GetProperty("questions");
        Assert.Equal(3, questions.EnumerateObject().Count());
        Assert.Equal("noul", questions.GetProperty("line_0").GetProperty("type").GetString());
        Assert.Equal("noul", questions.GetProperty("line_1").GetProperty("type").GetString());
        Assert.Equal("noul", questions.GetProperty("line_2").GetProperty("type").GetString());
        Assert.Equal("What is the rollback plan?", questions.GetProperty("line_0").GetProperty("instructions").GetProperty("line").GetString());
        Assert.Equal("and the third one?", questions.GetProperty("line_1").GetProperty("instructions").GetProperty("line").GetString());
        Assert.Equal("Who owns the migration?", questions.GetProperty("line_2").GetProperty("instructions").GetProperty("line").GetString());
        var newLines = document.RootElement.GetProperty("state").GetProperty("new_lines");
        Assert.Equal(3, newLines.GetArrayLength());
    }

    [Fact]
    public async Task JudgeAsync_WhenLastLineIsBelowThreshold_ReturnsPreviousLineAtOrAboveThreshold()
    {
        var first = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(6),
            "What is the rollback plan?");
        var second = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(6),
            TimeSpan.FromSeconds(9),
            "does that make sense");
        var current = string.Join("\n", first, second);
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(
            ("line_0", 0.91),
            ("line_1", 0.2)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, current);

        Assert.Equal("What is the rollback plan?", armed);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task JudgeAsync_WhenRhetoricalCheck_StillSendsNoul()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(3),
            "does that make sense");
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.2)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, line);

        Assert.Null(armed);
        Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(handler.LastRequestBody!);
        var question = document.RootElement.GetProperty("questions").GetProperty("line_0");
        Assert.Equal("noul", question.GetProperty("type").GetString());
        Assert.Equal("does that make sense", question.GetProperty("instructions").GetProperty("line").GetString());
    }

    [Fact]
    public async Task JudgeAsync_WhenLaterAnswerMissing_DoesNotArmThatLine()
    {
        var first = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(6),
            "What is the rollback plan?");
        var second = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(6),
            TimeSpan.FromSeconds(12),
            "Who owns the migration?");
        var current = string.Join("\n", first, second);
        var handler = new FakeHttpMessageHandler(_ => NoulResponse(("line_0", 0.91)));
        var api = new TypeSafeApiClient(new HttpClient(handler));

        var armed = await LiveQuestionJevJudge.JudgeAsync(api, ApiKey, previousCommitted: null, current);

        Assert.Equal("What is the rollback plan?", armed);
        Assert.NotEqual("Who owns the migration?", armed);
    }

    private static HttpResponseMessage NoulResponse(params (string Id, double Noul)[] answers)
    {
        var payload = new Dictionary<string, object>(answers.Length);
        foreach (var (id, noul) in answers)
        {
            payload[id] = new Dictionary<string, object>
            {
                ["type"] = "noul",
                ["noul"] = noul,
            };
        }

        var json = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["model"] = "jev-1.13.0",
            ["answers"] = payload,
        });
        return FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, json);
    }
}
