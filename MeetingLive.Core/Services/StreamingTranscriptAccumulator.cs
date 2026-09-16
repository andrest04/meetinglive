using System.Text.RegularExpressions;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure streaming-ASR transcript builder: FINAL results are appended as committed timestamped
/// lines; INTERIM results replace the current partial suffix instead of being appended.
/// Live display uses the same NVIDIA line format as committed text when word timings exist.
/// Long windows are split on word boundaries into ~30-second spans, on
/// speaker-tag changes when Sortformer tags are present, and on silences of
/// <see cref="IdeaPause"/> or more so one speaker is not one giant block.
/// </summary>
public sealed class StreamingTranscriptAccumulator
{
    private static readonly TimeSpan WindowLength = TimeSpan.FromSeconds(30);
    /// <summary>Silence between words that starts a new idea line for the same speaker.</summary>
    internal static readonly TimeSpan IdeaPause = TimeSpan.FromMilliseconds(500);
    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);

    private readonly DateTimeOffset _recordedAt;
    private readonly List<string> _committedLines = [];

    /// <summary>Wall-clock shift for pauses (elapsed stamps stay WAV time).</summary>
    public TimeSpan ClockSkew { get; set; }
    private string _interim = string.Empty;
    private TimeSpan _lastEnd;
    private bool _wroteHeader;

    public StreamingTranscriptAccumulator(DateTimeOffset recordedAt)
    {
        _recordedAt = recordedAt;
    }

    public void Apply(NemoSpeechAsrResult result)
    {
        var text = (result.Transcript ?? string.Empty).Trim();
        if (result.IsFinal)
        {
            if (text.Length > 0)
            {
                EnsureHeader();
                foreach (var line in FormatWindows(result, text, commitTiming: true))
                    _committedLines.Add(line);
            }

            _interim = string.Empty;
        }
        else
        {
            _interim = text.Length == 0
                ? string.Empty
                : string.Join(Environment.NewLine, FormatWindows(result, text, commitTiming: false));
        }
    }

    /// <summary>Committed timestamped lines plus the current interim suffix (if any).</summary>
    public string DisplayText
    {
        get
        {
            if (_committedLines.Count == 0)
            {
                if (string.IsNullOrEmpty(_interim))
                    return string.Empty;

                return _recordedAt == default
                    ? _interim
                    : TranscriptStampFormatter.FormatHeader(_recordedAt) + Environment.NewLine + _interim;
            }

            var committed = string.Join(Environment.NewLine, _committedLines);
            return string.IsNullOrEmpty(_interim)
                ? committed
                : committed + Environment.NewLine + _interim;
        }
    }

    /// <summary>Finals only — the authoritative transcript after the stream is finished.</summary>
    public string CommittedText => string.Join(Environment.NewLine, _committedLines);

    /// <summary>If the engine never promoted the last partial to FINAL, keep it as committed lines.</summary>
    public void CommitRemainingInterim()
    {
        if (string.IsNullOrWhiteSpace(_interim))
            return;

        EnsureHeader();
        foreach (var line in _interim.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries))
            _committedLines.Add(line);
        _interim = string.Empty;
    }

    private void EnsureHeader()
    {
        if (_wroteHeader || _recordedAt == default)
            return;

        _committedLines.Add(TranscriptStampFormatter.FormatHeader(_recordedAt));
        _wroteHeader = true;
    }

    private IEnumerable<string> FormatWindows(NemoSpeechAsrResult result, string text, bool commitTiming)
    {
        TimeSpan start;
        TimeSpan end;
        if (result.Words.Count > 0)
        {
            start = result.Words[0].Start;
            end = result.Words[^1].End;
        }
        else
        {
            start = _lastEnd;
            end = TimeSpan.FromSeconds(result.AudioProcessedSeconds);
            if (end < start)
                end = start;

            if (!commitTiming && end == start)
            {
                yield return text;
                yield break;
            }
        }

        if (commitTiming)
            _lastEnd = end;

        if (result.Words.Count == 0)
        {
            yield return FormatLine(start, end, text);
            yield break;
        }

        var duration = end - start;
        var uniqueSpeakers = result.Words.Select(word => word.SpeakerTag).Distinct().Count();
        if (duration <= WindowLength && uniqueSpeakers == 1 && !HasIdeaPause(result.Words))
        {
            yield return FormatLine(start, end, text, result.Words[0].SpeakerTag);
            yield break;
        }

        var tokens = ResolveTokens(result, text);
        if (tokens.Length == 0)
        {
            yield return FormatLine(start, end, text, result.Words[0].SpeakerTag);
            yield break;
        }

        var pairCount = Math.Min(tokens.Length, result.Words.Count);
        var windows = new List<(TimeSpan Start, TimeSpan End, List<string> Tokens, int SpeakerTag)>();
        var windowStart = result.Words[0].Start;
        var windowSpeaker = result.Words[0].SpeakerTag;
        var current = new List<string>();
        var previousWordEnd = result.Words[0].End;

        for (var i = 0; i < pairCount; i++)
        {
            var word = result.Words[i];
            var speakerChanged = current.Count > 0 && word.SpeakerTag != windowSpeaker;
            var windowElapsed = current.Count > 0 && word.End - windowStart >= WindowLength;
            var ideaPaused = current.Count > 0 && word.Start - previousWordEnd >= IdeaPause;
            if (speakerChanged || windowElapsed || ideaPaused)
            {
                windows.Add((windowStart, previousWordEnd, current, windowSpeaker));
                current = [];
                windowStart = word.Start;
                windowSpeaker = word.SpeakerTag;
            }

            current.Add(tokens[i]);
            previousWordEnd = word.End;
        }

        if (current.Count > 0)
            windows.Add((windowStart, previousWordEnd, current, windowSpeaker));

        if (tokens.Length > pairCount)
        {
            var extra = tokens[pairCount..];
            if (windows.Count == 0)
                windows.Add((start, end, extra.ToList(), 0));
            else
                windows[^1].Tokens.AddRange(extra);
        }

        foreach (var window in windows)
        {
            var windowText = string.Join(" ", window.Tokens);
            if (windowText.Length == 0)
                continue;

            yield return FormatLine(window.Start, window.End, windowText, window.SpeakerTag);
        }
    }

    private static bool HasIdeaPause(IReadOnlyList<NemoSpeechWordTiming> words)
    {
        for (var i = 1; i < words.Count; i++)
        {
            if (words[i].Start - words[i - 1].End >= IdeaPause)
                return true;
        }

        return false;
    }

    private static string[] ResolveTokens(NemoSpeechAsrResult result, string text)
    {
        var split = Whitespace.Split(text).Where(token => token.Length > 0).ToArray();
        if (result.Words.Count == split.Length && result.Words.All(word => word.Text is not null))
            return result.Words.Select(word => word.Text!).ToArray();

        return split;
    }

    private static string FormatLine(TimeSpan start, TimeSpan end, string text, int speakerTag = 0) =>
        TranscriptStampFormatter.FormatLine(start, end, text, speakerTag);
}
