using System.Text.Json.Serialization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Asks Jev whether each newly committed live-transcript line is a direct question.
/// Code copies the line body. Jev does not write the question text or the answer.
/// </summary>
public static class LiveQuestionJevJudge
{
    /// <summary>
    /// Starting code threshold for arming a line. Not a measured accuracy number.
    /// A Noul is the probability that the answer is yes. It is not a separate confidence score.
    /// </summary>
    public const double ArmThreshold = 0.7;

    internal const string DirectQuestionInstructions =
        "Is this line a direct question that expects a factual or explanatory answer from someone in the room right now?";

    internal const string TrueCriteria =
        "Asks for a fact, definition, rule, procedure, or explanation, even if the transcript dropped the question mark. Includes a question asked to the room, not only to one person.";

    internal const string FalseCriteria =
        "A statement, acknowledgment, greeting, or a rhetorical check that people are following, such as \"does that make sense\", \"¿se entiende?\", \"right?\", or \"ok?\". It does not expect a factual answer.";

    /// <summary>
    /// Judges lines that are new since <paramref name="previousCommitted"/>.
    /// Returns the body of the last new line whose Noul is at least <see cref="ArmThreshold"/>, or null.
    /// </summary>
    public static async Task<string?> JudgeAsync(
        TypeSafeApiClient api,
        string apiKey,
        string? previousCommitted,
        string? currentCommitted,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(api);

        var bodies = CollectNewBodies(previousCommitted, currentCommitted);
        if (bodies.Count == 0)
            return null;

        cancellationToken.ThrowIfCancellationRequested();

        // One request, one Noul per new line. Questions run in parallel on the same small state.
        var questions = new Dictionary<string, TypeSafeQuestion>(bodies.Count);
        for (var i = 0; i < bodies.Count; i++)
            questions[QuestionId(i)] = DirectQuestion(bodies[i]);

        var result = await api.EvaluateAsync(
            apiKey,
            new JudgmentState
            {
                RecentTranscript = LiveAnswerWindow.TakeRecent(currentCommitted, LiveAnswerWindow.Default),
                NewLines = bodies,
            },
            questions,
            cancellationToken);

        string? armed = null;
        for (var i = 0; i < bodies.Count; i++)
        {
            var noul = ReadNoul(result.Answers, QuestionId(i));
            // ArmThreshold is a starting code policy, not a measured accuracy number.
            // A missing answer does not arm. Do not read Noul as a confidence score.
            if (noul is not double value || value < ArmThreshold)
                continue;

            armed = bodies[i];
        }

        return armed;
    }

    private static List<string> CollectNewBodies(string? previousCommitted, string? currentCommitted)
    {
        var bodies = new List<string>();
        if (string.IsNullOrEmpty(currentCommitted))
            return bodies;
        if (string.Equals(previousCommitted, currentCommitted, StringComparison.Ordinal))
            return bodies;

        var previousLines = new HashSet<string>(
            CommittedTranscriptLine.Split(previousCommitted),
            StringComparer.Ordinal);

        foreach (var line in CommittedTranscriptLine.Split(currentCommitted))
        {
            if (line.Length == 0 || previousLines.Contains(line) || CommittedTranscriptLine.IsHeader(line))
                continue;

            var body = CommittedTranscriptLine.ExtractBody(line);
            if (string.IsNullOrWhiteSpace(body))
                continue;

            bodies.Add(body);
        }

        return bodies;
    }

    private static TypeSafeQuestion DirectQuestion(string body) =>
        new()
        {
            Type = "noul",
            Instructions = new Dictionary<string, string>
            {
                ["line"] = body,
                ["question"] = DirectQuestionInstructions,
            },
            Criteria = new Dictionary<string, string>
            {
                ["true"] = TrueCriteria,
                ["false"] = FalseCriteria,
            },
        };

    private static string QuestionId(int index) => $"line_{index}";

    private static double? ReadNoul(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "noul", StringComparison.OrdinalIgnoreCase)
            ? answer.Noul
            : null;

    /// <summary>
    /// Small judgment state: the new line texts plus the 90-second window, not the whole meeting.
    /// </summary>
    private sealed class JudgmentState
    {
        [JsonPropertyName("recent_transcript")]
        public required string RecentTranscript { get; init; }

        [JsonPropertyName("new_lines")]
        public required IReadOnlyList<string> NewLines { get; init; }
    }
}
