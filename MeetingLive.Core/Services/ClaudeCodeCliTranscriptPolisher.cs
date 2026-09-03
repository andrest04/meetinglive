namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a transcript via the Claude Code CLI (<c>claude -p</c>), same 5-minute
/// timeout pattern as <see cref="ClaudeCodeCliSummaryProvider"/>.
/// </summary>
public sealed class ClaudeCodeCliTranscriptPolisher(ICliProcessRunner processRunner) : ITranscriptPolisher
{
    private const string ExecutableName = "claude";
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
            "-p",
            prompt,
            Timeout,
            CliFailureMapper.ClaudeCodeDisplayName,
            cancellationToken);
    }
}
