using System.Text.Json.Serialization;

namespace MeetingLive.Core.Services;

/// <summary>One TypeSafe System One question. Factory helpers produce noul, choice, and score payloads.</summary>
public sealed class TypeSafeQuestion
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    [JsonPropertyName("instructions")]
    public required object Instructions { get; init; }

    [JsonPropertyName("criteria")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Criteria { get; init; }

    public static TypeSafeQuestion Noul(string instructions, string? trueCriteria = null, string? falseCriteria = null)
    {
        Dictionary<string, string>? criteria = null;
        if (trueCriteria is not null || falseCriteria is not null)
        {
            criteria = [];
            if (trueCriteria is not null)
                criteria["true"] = trueCriteria;
            if (falseCriteria is not null)
                criteria["false"] = falseCriteria;
        }

        return new TypeSafeQuestion
        {
            Type = "noul",
            Instructions = instructions,
            Criteria = criteria,
        };
    }

    public static TypeSafeQuestion Choice(string instructions, IReadOnlyDictionary<string, string?> criteria)
    {
        ArgumentNullException.ThrowIfNull(criteria);
        return new TypeSafeQuestion
        {
            Type = "choice",
            Instructions = instructions,
            Criteria = criteria,
        };
    }

    public static TypeSafeQuestion Score(string instructions, IReadOnlyList<string> criteria)
    {
        ArgumentNullException.ThrowIfNull(criteria);
        return new TypeSafeQuestion
        {
            Type = "score",
            Instructions = instructions,
            Criteria = criteria,
        };
    }
}

/// <summary>One TypeSafe answer. Fields that do not apply to the answer type stay default.</summary>
public sealed class TypeSafeAnswer
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = "";

    [JsonPropertyName("noul")]
    public double Noul { get; init; }

    [JsonPropertyName("choice")]
    public string? Choice { get; init; }

    [JsonPropertyName("score")]
    public double Score { get; init; }

    [JsonPropertyName("confidence")]
    public double Confidence { get; init; }

    [JsonPropertyName("probabilities")]
    public Dictionary<string, double>? Probabilities { get; init; }

    [JsonPropertyName("legend")]
    public Dictionary<string, string>? Legend { get; init; }
}

public sealed class TypeSafeEvaluationResult
{
    public required string Model { get; init; }

    public required IReadOnlyDictionary<string, TypeSafeAnswer> Answers { get; init; }
}
