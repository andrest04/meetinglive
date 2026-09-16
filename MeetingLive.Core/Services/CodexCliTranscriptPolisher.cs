namespace MeetingLive.Core.Services;

/// <summary>
/// Polishes a transcript via the Codex CLI (<c>codex exec -</c>), same 5-minute
/// timeout pattern as <see cref="CodexCliSummaryProvider"/>.
/// </summary>
    public sealed class CodexCliTranscriptPolisher(
        ICliProcessRunner processRunner,
        string? modelId = null,
        string? effort = null) : CliToolProviderBase(processRunner), ITranscriptPolisher
    {
        protected override string ExecutableName => "codex";
        protected override TimeSpan Timeout { get; } = TimeSpan.FromMinutes(5);
        protected override string Arguments { get; } = CliInvocation.CodexExec(modelId, effort);
        protected override string ProviderDisplayName => CliFailureMapper.CodexDisplayName;

    public Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        var prompt = TranscriptPolishPromptBuilder.Build(transcript, meetingLanguage);
        return RunAsync(prompt, cancellationToken);
    }
}
