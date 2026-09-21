namespace MeetingLive.Core.Services;

public enum MeetingJevAskVerdict
{
    Absent,
    Partial,
    Answered,
}

public sealed class MeetingJevAskResult
{
    public required double Exists { get; init; }

    public required MeetingJevAskVerdict Verdict { get; init; }

    public required IReadOnlyList<MeetingJevAskHit> Hits { get; init; }
}

public sealed class MeetingJevAskHit
{
    public required string LineId { get; init; }

    public required int Index { get; init; }

    public required string Text { get; init; }

    public required double Score { get; init; }
}

/// <summary>
/// TypeSafe semantic-find over a meeting transcript: Jev points at lines; it does not write an answer.
/// </summary>
public static class MeetingJevAsk
{
    internal const int MaxStateCharacters = 48_000;
    internal const int WindowSize = 200;
    internal const int MaxHits = 5;
    internal const double MinHitScore = 0.02;
    internal const double AnsweredExists = 0.7;
    internal const double AbsentExists = 0.35;
    internal const int WindowPreviewChars = 80;

    public static async Task<MeetingJevAskResult> AskAsync(
        TypeSafeApiClient api,
        string apiKey,
        string transcript,
        string query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(api);

        if (string.IsNullOrWhiteSpace(query) || string.IsNullOrWhiteSpace(transcript))
            return AbsentNone();

        var trimmedQuery = query.Trim();
        var lines = TranscriptLineIndex.TruncateToCompleteLines(
            TranscriptLineIndex.Parse(transcript),
            MaxStateCharacters);
        if (lines.Count == 0)
            return AbsentNone();

        var tagged = TranscriptLineIndex.BuildTaggedDocument(lines);
        if (lines.Count <= TranscriptLineIndex.MaxChoiceOptions)
            return await AskOnePassAsync(api, apiKey, tagged, lines, trimmedQuery, cancellationToken);

        return await AskTwoPassAsync(api, apiKey, tagged, lines, trimmedQuery, cancellationToken);
    }

    private static async Task<MeetingJevAskResult> AskOnePassAsync(
        TypeSafeApiClient api,
        string apiKey,
        string tagged,
        IReadOnlyList<TranscriptLine> lines,
        string query,
        CancellationToken cancellationToken)
    {
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["exists"] = ExistsQuestion(query),
            ["where"] = WhereQuestion(query, LineCriteria(lines)),
        };

        var result = await api.EvaluateAsync(apiKey, tagged, questions, cancellationToken);
        return Compose(result, lines, existsOverride: null);
    }

    private static async Task<MeetingJevAskResult> AskTwoPassAsync(
        TypeSafeApiClient api,
        string apiKey,
        string tagged,
        IReadOnlyList<TranscriptLine> lines,
        string query,
        CancellationToken cancellationToken)
    {
        var windows = BuildWindows(lines);
        var pass1Questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["exists"] = ExistsQuestion(query),
            ["where"] = TypeSafeQuestion.Choice(
                $"Which window contains the answer to \"{query}\"?",
                WindowCriteria(windows)),
        };

        var pass1 = await api.EvaluateAsync(apiKey, tagged, pass1Questions, cancellationToken);
        var exists = ReadNoul(pass1.Answers, "exists") ?? 0;
        var windowLines = SelectWindow(windows, pass1.Answers);

        var pass2Questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["where"] = WhereQuestion(query, LineCriteria(windowLines)),
        };
        var windowTagged = TranscriptLineIndex.BuildTaggedDocument(
            TranscriptLineIndex.TruncateToCompleteLines(windowLines, MaxStateCharacters));
        var pass2 = await api.EvaluateAsync(apiKey, windowTagged, pass2Questions, cancellationToken);
        return Compose(pass2, windowLines, exists);
    }

    private static MeetingJevAskResult Compose(
        TypeSafeEvaluationResult result,
        IReadOnlyList<TranscriptLine> candidates,
        double? existsOverride)
    {
        var exists = existsOverride ?? ReadNoul(result.Answers, "exists") ?? 0;
        var probabilities = ReadChoice(result.Answers, "where")?.Probabilities;
        return new MeetingJevAskResult
        {
            Exists = exists,
            Verdict = VerdictFor(exists),
            Hits = RankHits(candidates, probabilities),
        };
    }

    internal static MeetingJevAskVerdict VerdictFor(double exists)
    {
        if (exists >= AnsweredExists)
            return MeetingJevAskVerdict.Answered;
        if (exists < AbsentExists)
            return MeetingJevAskVerdict.Absent;
        return MeetingJevAskVerdict.Partial;
    }

    private static IReadOnlyList<MeetingJevAskHit> RankHits(
        IReadOnlyList<TranscriptLine> candidates,
        IReadOnlyDictionary<string, double>? probabilities)
    {
        if (probabilities is null || probabilities.Count == 0)
            return [];

        return candidates
            .Select(line =>
            {
                var score = probabilities.TryGetValue(line.Id, out var value) ? value : 0;
                return new MeetingJevAskHit
                {
                    LineId = line.Id,
                    Index = line.Index,
                    Text = line.Text,
                    Score = score,
                };
            })
            .Where(hit => hit.Score > MinHitScore)
            .OrderByDescending(hit => hit.Score)
            .Take(MaxHits)
            .ToArray();
    }

    private static IReadOnlyList<IReadOnlyList<TranscriptLine>> BuildWindows(IReadOnlyList<TranscriptLine> lines)
    {
        var windows = new List<IReadOnlyList<TranscriptLine>>();
        for (var start = 0;
             start < lines.Count && windows.Count < TranscriptLineIndex.MaxChoiceOptions;
             start += WindowSize)
        {
            var length = Math.Min(WindowSize, lines.Count - start);
            windows.Add(lines.Skip(start).Take(length).ToArray());
        }

        return windows;
    }

    private static Dictionary<string, string?> LineCriteria(IReadOnlyList<TranscriptLine> lines)
    {
        var criteria = new Dictionary<string, string?>(lines.Count);
        foreach (var line in lines)
            criteria[line.Id] = null;
        return criteria;
    }

    private static Dictionary<string, string?> WindowCriteria(IReadOnlyList<IReadOnlyList<TranscriptLine>> windows)
    {
        var criteria = new Dictionary<string, string?>(windows.Count);
        for (var i = 0; i < windows.Count; i++)
        {
            var first = windows[i][0].Text;
            var preview = first.Length <= WindowPreviewChars ? first : first[..WindowPreviewChars];
            criteria[WindowId(i)] = preview;
        }

        return criteria;
    }

    private static IReadOnlyList<TranscriptLine> SelectWindow(
        IReadOnlyList<IReadOnlyList<TranscriptLine>> windows,
        IReadOnlyDictionary<string, TypeSafeAnswer> answers)
    {
        var probabilities = ReadChoice(answers, "where")?.Probabilities;
        var bestIndex = 0;
        var bestScore = double.NegativeInfinity;
        for (var i = 0; i < windows.Count; i++)
        {
            var score = 0d;
            if (probabilities is not null && probabilities.TryGetValue(WindowId(i), out var value))
                score = value;

            if (score > bestScore)
            {
                bestScore = score;
                bestIndex = i;
            }
        }

        return windows[bestIndex];
    }

    private static string WindowId(int index) => $"W{index:00}";

    private static TypeSafeQuestion ExistsQuestion(string query) =>
        TypeSafeQuestion.Noul(
            $"Does any line address or answer \"{query}\"?",
            trueCriteria: "At least one line of the document states or directly implies the answer",
            falseCriteria: "No line of the document addresses this");

    private static TypeSafeQuestion WhereQuestion(string query, IReadOnlyDictionary<string, string?> criteria) =>
        TypeSafeQuestion.Choice(
            $"Which line contains the answer to \"{query}\"?",
            criteria);

    private static TypeSafeAnswer? ReadChoice(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "choice", StringComparison.OrdinalIgnoreCase)
            ? answer
            : null;

    private static double? ReadNoul(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "noul", StringComparison.OrdinalIgnoreCase)
            ? answer.Noul
            : null;

    private static MeetingJevAskResult AbsentNone() => new()
    {
        Exists = 0,
        Verdict = MeetingJevAskVerdict.Absent,
        Hits = [],
    };
}
