namespace MeetingLive.Core.Services;

public sealed class MeetingJevPersonalTaskEvidence
{
    public required TranscriptLine Line { get; init; }

    public required double Score { get; init; }
}

public sealed class MeetingJevPersonalTasksResult
{
    public required double Exists { get; init; }

    public required MeetingJevAskVerdict Verdict { get; init; }

    public required IReadOnlyList<MeetingJevPersonalTaskEvidence> Evidence { get; init; }
}

/// <summary>
/// Jev finds transcript lines that are requests or commitments the listener should act on.
/// Optional topic filter is two Nouls composed in code (task AND topic).
/// </summary>
public static class MeetingJevPersonalTasks
{
    internal const int MaxStateCharacters = 48_000;
    internal const int BatchNouls = 40;
    internal const int MaxEvidence = 15;
    internal const double MinKeepScore = 0.65;

    public static async Task<MeetingJevPersonalTasksResult> FindAsync(
        TypeSafeApiClient api,
        string apiKey,
        string transcript,
        string? topic,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(api);

        var trimmedTopic = string.IsNullOrWhiteSpace(topic) ? null : topic.Trim();
        if (string.IsNullOrWhiteSpace(transcript))
            return AbsentNone();

        var lines = TranscriptLineIndex.TruncateToCompleteLines(
            TranscriptLineIndex.Parse(transcript),
            MaxStateCharacters);
        if (lines.Count == 0)
            return AbsentNone();

        var tagged = TranscriptLineIndex.BuildTaggedDocument(lines);
        var exists = await EvaluateExistsAsync(api, apiKey, tagged, trimmedTopic, cancellationToken);
        var scores = await ScoreLinesAsync(api, apiKey, tagged, lines, trimmedTopic, cancellationToken);

        return new MeetingJevPersonalTasksResult
        {
            Exists = exists,
            Verdict = MeetingJevAsk.VerdictFor(exists),
            Evidence = RankEvidence(lines, scores, requireTopic: trimmedTopic is not null),
        };
    }

    private static async Task<double> EvaluateExistsAsync(
        TypeSafeApiClient api,
        string apiKey,
        string tagged,
        string? topic,
        CancellationToken cancellationToken)
    {
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["exists"] = ExistsQuestion(topic),
        };
        var result = await api.EvaluateAsync(apiKey, new { transcript = tagged }, questions, cancellationToken);
        return ReadNoul(result.Answers, "exists") ?? 0;
    }

    private static async Task<Dictionary<string, LineScores>> ScoreLinesAsync(
        TypeSafeApiClient api,
        string apiKey,
        string tagged,
        IReadOnlyList<TranscriptLine> lines,
        string? topic,
        CancellationToken cancellationToken)
    {
        var scores = new Dictionary<string, LineScores>(lines.Count);
        var noulsPerLine = topic is null ? 1 : 2;
        var linesPerBatch = BatchNouls / noulsPerLine;

        for (var start = 0; start < lines.Count; start += linesPerBatch)
        {
            var batch = lines.Skip(start).Take(linesPerBatch).ToArray();
            var questions = new Dictionary<string, TypeSafeQuestion>(batch.Length * noulsPerLine);
            foreach (var line in batch)
            {
                questions[TaskId(line.Id)] = TaskQuestion(line);
                if (topic is not null)
                    questions[TopicId(line.Id)] = TopicQuestion(line, topic);
            }

            var result = await api.EvaluateAsync(
                apiKey,
                new { transcript = tagged },
                questions,
                cancellationToken);

            foreach (var line in batch)
            {
                scores[line.Id] = new LineScores(
                    ReadNoul(result.Answers, TaskId(line.Id)) ?? 0,
                    topic is null ? 1 : ReadNoul(result.Answers, TopicId(line.Id)) ?? 0);
            }
        }

        return scores;
    }

    private static IReadOnlyList<MeetingJevPersonalTaskEvidence> RankEvidence(
        IReadOnlyList<TranscriptLine> lines,
        IReadOnlyDictionary<string, LineScores> scores,
        bool requireTopic)
    {
        return lines
            .Select(line =>
            {
                scores.TryGetValue(line.Id, out var value);
                return new MeetingJevPersonalTaskEvidence { Line = line, Score = value.Task };
            })
            .Where(item =>
            {
                if (item.Score < MinKeepScore)
                    return false;
                if (!requireTopic)
                    return true;
                return scores.TryGetValue(item.Line.Id, out var value) && value.Topic >= MinKeepScore;
            })
            .OrderByDescending(item => item.Score)
            .Take(MaxEvidence)
            .ToArray();
    }

    private static TypeSafeQuestion ExistsQuestion(string? topic)
    {
        var instructions = topic is null
            ? "Does `transcript` contain work the listener should do?"
            : $"Does `transcript` contain work the listener should do about `{topic}`?";
        return TypeSafeQuestion.Noul(
            instructions,
            trueCriteria: topic is null
                ? "The transcript records a request or commitment the listener should act on"
                : $"The transcript records a request or commitment the listener should act on about {topic}",
            falseCriteria: topic is null
                ? "Nothing in the transcript asks the listener to do work"
                : $"The transcript does not cover work for the listener about {topic}");
    }

    private static TypeSafeQuestion TaskQuestion(TranscriptLine line) =>
        new()
        {
            Type = "noul",
            Instructions = new Dictionary<string, string>
            {
                ["line"] = line.Text,
                ["question"] = "Is this line a request or commitment the listener should act on?",
            },
            Criteria = new Dictionary<string, string>
            {
                ["true"] = "The line asks the listener to do something or records a commitment they should act on",
                ["false"] = "The line is not a request or commitment for the listener",
            },
        };

    private static TypeSafeQuestion TopicQuestion(TranscriptLine line, string topic) =>
        new()
        {
            Type = "noul",
            Instructions = new Dictionary<string, string>
            {
                ["line"] = line.Text,
                ["topic"] = topic,
                ["question"] = $"Is this line about `{topic}`?",
            },
            Criteria = new Dictionary<string, string>
            {
                ["true"] = $"The line is about {topic}",
                ["false"] = $"The line is not about {topic}",
            },
        };

    private static string TaskId(string lineId) => $"line_{lineId}_task";

    private static string TopicId(string lineId) => $"line_{lineId}_topic";

    private static double? ReadNoul(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "noul", StringComparison.OrdinalIgnoreCase)
            ? answer.Noul
            : null;

    private static MeetingJevPersonalTasksResult AbsentNone() => new()
    {
        Exists = 0,
        Verdict = MeetingJevAskVerdict.Absent,
        Evidence = [],
    };

    private readonly record struct LineScores(double Task, double Topic);
}
