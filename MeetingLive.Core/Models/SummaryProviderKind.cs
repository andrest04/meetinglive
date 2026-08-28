namespace MeetingLive.Core.Models;

/// <summary>Which summary engine the user has selected in Settings. Backs
/// <see cref="AppSettings.SelectedSummaryProvider"/> and drives
/// <c>AppServices.CreateSummaryProvider</c>.</summary>
public enum SummaryProviderKind
{
    /// <summary>In-process LLamaSharp inference against a local GGUF file — no external process.</summary>
    Local,

    /// <summary>Shells out to the already-installed, already-authenticated Claude Code CLI.</summary>
    ClaudeCode,

    /// <summary>Shells out to the already-installed, already-authenticated Codex CLI.</summary>
    Codex,
}
