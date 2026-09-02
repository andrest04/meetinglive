using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure streaming-ASR transcript builder: FINAL results are appended as committed timestamped
/// lines; INTERIM results replace the current partial suffix instead of being appended.
/// </summary>
public sealed class StreamingTranscriptAccumulator
{
    private readonly List<string> _committedLines = [];
    private string _interim = string.Empty;
    private TimeSpan _lastEnd;

    public void Apply(NemoSpeechAsrResult result)
    {
        var text = (result.Transcript ?? string.Empty).Trim();
        if (result.IsFinal)
        {
            if (text.Length > 0)
                _committedLines.Add(FormatFinal(result, text));
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

    private string FormatFinal(NemoSpeechAsrResult result, string text)
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
        return $"[{FormatTimestamp(start)} -> {FormatTimestamp(end)}] {text}";
    }

    private static string FormatTimestamp(TimeSpan time)
    {
        if (time < TimeSpan.Zero)
            time = TimeSpan.Zero;
        return time.ToString(@"hh\:mm\:ss");
    }
}
