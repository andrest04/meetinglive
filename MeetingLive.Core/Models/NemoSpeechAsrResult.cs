namespace MeetingLive.Core.Models;

/// <summary>
/// Word timing from Nemotron (Riva-style milliseconds converted to <see cref="TimeSpan"/>).
/// <see cref="SpeakerTag"/> is 1-based (Sortformer max 4); 0 means untagged.
/// <see cref="Text"/> is the engine word when present; otherwise the accumulator
/// whitespace-splits <see cref="NemoSpeechAsrResult.Transcript"/>.
/// </summary>
public sealed record NemoSpeechWordTiming(
    TimeSpan Start,
    TimeSpan End,
    int SpeakerTag = 0,
    string? Text = null);

/// <summary>One streaming or offline recognition hypothesis from the Nemotron engine.</summary>
public sealed record NemoSpeechAsrResult(
    bool IsFinal,
    string Transcript,
    float AudioProcessedSeconds,
    IReadOnlyList<NemoSpeechWordTiming> Words);
