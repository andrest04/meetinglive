namespace MeetingLive.Core.Services;

/// <summary>
    /// Punctuation/capitalization/acronym polish of a transcript before it is persisted
    /// and summarized. Failure is non-fatal: the caller keeps the raw transcript.
/// </summary>
public interface ITranscriptPolisher
{
    Task<string> PolishAsync(string transcript, string? meetingLanguage = null, CancellationToken cancellationToken = default);
}
