namespace MeetingLive.Core.Models;

/// <summary>Word timing from Nemotron (Riva-style milliseconds converted to <see cref="TimeSpan"/>).</summary>
public sealed record NemoSpeechWordTiming(TimeSpan Start, TimeSpan End);

/// <summary>One streaming or offline recognition hypothesis from the Nemotron engine.</summary>
public sealed record NemoSpeechAsrResult(
    bool IsFinal,
    string Transcript,
    float AudioProcessedSeconds,
    IReadOnlyList<NemoSpeechWordTiming> Words);
