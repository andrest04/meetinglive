namespace MeetingLive.Core.Models;

/// <summary>Curated CLI aliases and effort levels for Settings. Not live-benchmarked.</summary>
public static class InferenceCatalog
{
    public const string DefaultEffort = "low";

    public static IReadOnlyList<string> ClaudeModels { get; } = ["sonnet", "opus", "haiku", "fable"];

    public static IReadOnlyList<string> ClaudeEfforts { get; } = ["low", "medium", "high", "xhigh", "max"];

    public const string DefaultClaudeModel = "sonnet";

    public static IReadOnlyList<string> CodexModels { get; } = ["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol"];

    public static IReadOnlyList<string> CodexEfforts { get; } = ["low", "medium", "high", "xhigh"];

    public const string DefaultCodexModel = "gpt-5.6";

    public static IReadOnlyList<string> XaiEfforts { get; } = ["none", "low", "medium", "high", "xhigh"];
}
