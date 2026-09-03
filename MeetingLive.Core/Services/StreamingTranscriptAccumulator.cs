using System.Text.RegularExpressions;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure streaming-ASR transcript builder: FINAL results are appended as committed timestamped
/// lines; INTERIM results replace the current partial suffix instead of being appended.
/// Long finals are split on word boundaries into ~30-second windows.
/// </summary>
public sealed class StreamingTranscriptAccumulator
{
    private static readonly TimeSpan WindowLength = TimeSpan.FromSeconds(30);
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
                foreach (var line in FormatFinalWindows(result, text))
                    _committedLines.Add(line);
            }

            _interim = string.Empty;
        }
        else
        {
            _interim = text;
        }
    }

    /// <summary>Committed timestamped lines plus the current interim suffix (if any).</summary>
    public string DisplayText
    {
        get
        {
            if (_committedLines.Count == 0)
                return _interim;

            var committed = string.Join(Environment.NewLine, _committedLines);
            return string.IsNullOrEmpty(_interim)
                ? committed
                : committed + Environment.NewLine + _interim;
        }
    }

    /// <summary>Finals only — the authoritative transcript after the stream is finished.</summary>
    public string CommittedText => string.Join(Environment.NewLine, _committedLines);

    /// <summary>If the engine never promoted the last partial to FINAL, keep it as a committed line.</summary>
    public void CommitRemainingInterim()
    {
        if (string.IsNullOrWhiteSpace(_interim))
            return;

        _committedLines.Add(_interim.Trim());
        _interim = string.Empty;
    }

    private void EnsureHeader()
    {
        if (_wroteHeader || _recordedAt == default)
            return;

        _committedLines.Add(TranscriptStampFormatter.FormatHeader(_recordedAt));
        _wroteHeader = true;
    }

    private IEnumerable<string> FormatFinalWindows(NemoSpeechAsrResult result, string text)
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
        }

        _lastEnd = end;

        var duration = end - start;
        if (result.Words.Count == 0 || duration <= WindowLength)
        {
            yield return FormatLine(start, text);
            yield break;
        }

        var tokens = Whitespace.Split(text).Where(token => token.Length > 0).ToArray();
        if (tokens.Length == 0)
        {
            yield return FormatLine(start, text);
            yield break;
        }

        var pairCount = Math.Min(tokens.Length, result.Words.Count);
        var windows = new List<(TimeSpan Start, List<string> Tokens)>();
        var windowStart = result.Words[0].Start;
        var current = new List<string>();

        for (var i = 0; i < pairCount; i++)
        {
            var word = result.Words[i];
            if (current.Count > 0 && word.End - windowStart >= WindowLength)
            {
                windows.Add((windowStart, current));
                current = [];
                windowStart = word.Start;
            }

            current.Add(tokens[i]);
        }

        if (current.Count > 0)
            windows.Add((windowStart, current));

        if (tokens.Length > pairCount)
        {
            var extra = tokens[pairCount..];
            if (windows.Count == 0)
                windows.Add((start, extra.ToList()));
            else
                windows[^1].Tokens.AddRange(extra);
        }

        foreach (var window in windows)
        {
            var windowText = string.Join(" ", window.Tokens);
            if (windowText.Length == 0)
                continue;

            yield return FormatLine(window.Start, windowText);
        }
    }

    private string FormatLine(TimeSpan start, string text) =>
        TranscriptStampFormatter.FormatLine(start, text, _recordedAt, ClockSkew);
}
