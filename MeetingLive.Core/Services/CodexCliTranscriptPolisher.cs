namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a transcript via the Codex CLI (<c>codex exec -</c>), same 5-minute
/// timeout pattern as <see cref="CodexCliSummaryProvider"/>.
/// </summary>
    public sealed class CodexCliTranscriptPolisher(
        ICliProcessRunner processRunner,
        string? modelId = null,
        string? effort = null) : ITranscriptPolisher
    {
        private const string ExecutableName = "codex";
        private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);
        private readonly string _arguments = CliInvocation.CodexExec(modelId, effort);

    public async Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        var prompt = TranscriptPolishPromptBuilder.Build(transcript, meetingLanguage);
        return await CliFailureMapper.RunRequiredStdoutAsync(
            processRunner,
            ExecutableName,
            _arguments,
            prompt,
            Timeout,
            CliFailureMapper.CodexDisplayName,
            cancellationToken);
    }
}
