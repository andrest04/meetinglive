namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a Whisper transcript via the Codex CLI (<c>codex exec -</c>), same 5-minute
/// timeout pattern as <see cref="CodexCliSummaryProvider"/>.
/// </summary>
public sealed class CodexCliTranscriptPolisher(ICliProcessRunner processRunner) : ITranscriptPolisher
{
    private const string ExecutableName = "codex";
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);

    public async Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        var prompt = TranscriptPolishPromptBuilder.Build(transcript, meetingLanguage);
        return await CliFailureMapper.RunRequiredStdoutAsync(
            processRunner,
            ExecutableName,
            "exec -",
            prompt,
            Timeout,
            CliFailureMapper.CodexDisplayName,
            cancellationToken);
    }
}
