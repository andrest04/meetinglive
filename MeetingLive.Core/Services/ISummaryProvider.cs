namespace MeetingLive.Core.Services;

/// <summary>
/// Abstraction over whatever generates the meeting summary from a transcript.
/// The only implementation today is <see cref="LocalLlmSummaryProvider"/> (local, free,
/// in-process via LLamaSharp), but this seam is what lets a future cloud provider
/// (user's own API key) be added without touching the rest of the pipeline.
/// </summary>
public interface ISummaryProvider
{
    Task<string> SummarizeAsync(string transcript, CancellationToken cancellationToken = default);
}
