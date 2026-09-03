namespace MeetingLive.Core.Services;

/// <summary>
/// A classified Claude Code / Codex CLI failure. <see cref="Exception.Message"/> is a short
/// English sentence already suitable to show; it never includes a raw exit-code dump.
/// </summary>
public sealed class CliToolException : InvalidOperationException
{
    public CliToolException(
        CliFailureKind kind,
        string providerDisplayName,
        string message,
        string? detail = null,
        Exception? innerException = null)
        : base(Combine(message, detail), innerException)
    {
        Kind = kind;
        ProviderDisplayName = providerDisplayName;
        Detail = string.IsNullOrWhiteSpace(detail) ? null : detail;
    }

    public CliFailureKind Kind { get; }

    public string ProviderDisplayName { get; }

    /// <summary>Optional sanitized snippet for <see cref="CliFailureKind.Unknown"/> only.</summary>
    public string? Detail { get; }

    private static string Combine(string message, string? detail) =>
        string.IsNullOrWhiteSpace(detail) ? message : $"{message} {detail}";
}
