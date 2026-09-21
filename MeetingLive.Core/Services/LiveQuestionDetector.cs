using System.Text;

namespace MeetingLive.Core.Services;

/// <summary>
/// Finds a newly committed direct question. Rhetorical checks and short bodies are ignored.
/// </summary>
public static class LiveQuestionDetector
{
    private const int MinimumNormalizedLength = 12;

    private static readonly HashSet<string> InterrogativeWords = new(StringComparer.Ordinal)
    {
        "qué", "cómo", "como", "cuál", "cual", "cuáles", "cuales",
        "cuándo", "cuando", "dónde", "donde",
        "quién", "quien", "quiénes", "quienes",
        "what", "how", "why", "when", "where", "who", "which",
    };

    private static readonly HashSet<string> RhetoricalBodies = new(StringComparer.Ordinal)
    {
        "se entiende", "ok", "okay", "verdad", "no", "claro",
        "me explico", "me seguis", "me seguís", "me siguen",
        "right", "does that make sense", "make sense", "got it",
        "entendido", "si", "sí", "dale", "todo bien", "listo", "estan", "están",
    };

    private static readonly char[] EdgePunctuation =
    [
        '¿', '?', '!', '¡', '.', ',', ';', ':', '"', '\'',
        '“', '”', '‘', '’', '(', ')', '[', ']', '{', '}',
        '…', '—', '–', '-', '«', '»',
    ];

    public static string? TryDetectNew(string? previousCommitted, string? currentCommitted)
    {
        if (string.IsNullOrEmpty(currentCommitted))
            return null;
        if (string.Equals(previousCommitted, currentCommitted, StringComparison.Ordinal))
            return null;

        var previousLines = new HashSet<string>(
            CommittedTranscriptLine.Split(previousCommitted),
            StringComparer.Ordinal);

        string? detected = null;
        foreach (var line in CommittedTranscriptLine.Split(currentCommitted))
        {
            if (line.Length == 0 || previousLines.Contains(line) || CommittedTranscriptLine.IsHeader(line))
                continue;

            var body = CommittedTranscriptLine.ExtractBody(line);
            if (!IsDirectQuestion(body))
                continue;

            detected = body;
        }

        return detected;
    }

    private static bool IsDirectQuestion(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return false;

        var trimmed = body.Trim();
        if (!HasQuestionSignal(trimmed))
            return false;

        var normalized = Normalize(trimmed);
        if (normalized.Length < MinimumNormalizedLength)
            return false;

        // Whole-body membership only. A longer question that merely contains "right" or "no" still counts.
        return !RhetoricalBodies.Contains(normalized);
    }

    private static bool HasQuestionSignal(string trimmed)
    {
        return trimmed.Contains('¿')
            || trimmed.EndsWith('?')
            || StartsWithInterrogative(trimmed);
    }

    private static bool StartsWithInterrogative(string body)
    {
        var normalized = Normalize(body);
        if (normalized.Length == 0)
            return false;

        if (StartsWithPhrase(normalized, "por qué"))
            return true;

        var space = normalized.IndexOf(' ');
        var first = space < 0 ? normalized : normalized[..space];
        first = first.Trim(EdgePunctuation);
        return InterrogativeWords.Contains(first);
    }

    private static bool StartsWithPhrase(string normalized, string phrase)
    {
        if (!normalized.StartsWith(phrase, StringComparison.Ordinal))
            return false;
        if (normalized.Length == phrase.Length)
            return true;

        var next = normalized[phrase.Length];
        return char.IsWhiteSpace(next) || EdgePunctuation.Contains(next);
    }

    private static string Normalize(string body)
    {
        var value = body.Trim().Trim(EdgePunctuation).Trim().ToLowerInvariant();
        return CollapseWhitespace(value);
    }

    private static string CollapseWhitespace(string value)
    {
        var builder = new StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var character in value)
        {
            if (char.IsWhiteSpace(character))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(character);
        }

        return builder.ToString();
    }
}
