namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a transcript via the Claude Code CLI (<c>claude -p</c>), same 5-minute
/// timeout pattern as <see cref="ClaudeCodeCliSummaryProvider"/>.
/// </summary>
    public sealed class ClaudeCodeCliTranscriptPolisher(
        ICliProcessRunner processRunner,
        string? modelId = null,
        string? effort = null) : CliToolProviderBase(processRunner), ITranscriptPolisher
    {
        protected override string ExecutableName => "claude";
        protected override TimeSpan Timeout { get; } = TimeSpan.FromMinutes(5);
        protected override string Arguments { get; } = CliInvocation.ClaudePrint(modelId, effort);
        protected override string ProviderDisplayName => CliFailureMapper.ClaudeCodeDisplayName;

    public Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        var prompt = TranscriptPolishPromptBuilder.Build(transcript, meetingLanguage);
        return RunAsync(prompt, cancellationToken);
    }
}
