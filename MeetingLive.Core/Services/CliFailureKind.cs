namespace MeetingLive.Core.Services;

/// <summary>Why a Claude Code / Codex CLI invocation failed, for user-facing copy.</summary>
public enum CliFailureKind
{
    NotInstalled,
    NotSignedIn,
    SubscriptionInactive,
    TimedOut,
    EmptyOutput,
    Unknown,
}
