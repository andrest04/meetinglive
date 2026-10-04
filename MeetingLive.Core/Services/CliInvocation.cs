namespace MeetingLive.Core.Services;

/// <summary>
/// Builds non-interactive Claude Code / Codex argument strings, including optional
/// model and effort flags confirmed against <c>claude --help</c> and <c>codex exec --help</c>.
/// </summary>
public static class CliInvocation
{
    public static string ClaudePrint(string? modelId, string? effort, bool webSearch = false)
    {
        var arguments = "-p";
        if (!string.IsNullOrWhiteSpace(modelId))
            arguments += " --model " + Quote(modelId.Trim());
        if (!string.IsNullOrWhiteSpace(effort))
            arguments += " --effort " + effort.Trim();
        if (webSearch)
            arguments += " --tools WebSearch --allowedTools WebSearch";
        return arguments;
    }

    public static string CodexExec(string? modelId, string? effort, bool webSearch = false)
    {
        // --search is a top-level codex flag (absent from `codex exec --help`), so it must precede `exec`.
        var arguments = webSearch ? "--search exec -" : "exec -";
        if (!string.IsNullOrWhiteSpace(modelId))
            arguments += " -m " + Quote(modelId.Trim());
        if (!string.IsNullOrWhiteSpace(effort))
            arguments += " -c model_reasoning_effort=\"" + effort.Trim() + "\"";
        return arguments;
    }

    private static string Quote(string value) =>
        value.Contains(' ', StringComparison.Ordinal) ? "\"" + value + "\"" : value;
}
