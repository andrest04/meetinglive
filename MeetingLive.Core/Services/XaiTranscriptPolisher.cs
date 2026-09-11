namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a transcript via the xAI chat API, same engine as <see cref="XaiSummaryProvider"/>.
/// </summary>
    public sealed class XaiTranscriptPolisher(
        XaiAuthSession session,
        XaiApiClient api,
        string? modelId,
        string? reasoningEffort = null) : ITranscriptPolisher
{
    public async Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        var prompt = TranscriptPolishPromptBuilder.Build(transcript, meetingLanguage);
        var token = await session.GetAccessTokenAsync(cancellationToken);
        return await api.CompleteChatAsync(
            token,
            XaiApiClient.ResolveModelId(modelId, []),
            prompt,
            cancellationToken,
            reasoningEffort);
    }
}
