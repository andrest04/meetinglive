using Microsoft.UI.Xaml;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Dialogs;

namespace MeetingLive_App.Services;

/// <summary>
/// Resolves whether the CLI backing a CLI-based <see cref="SummaryProviderKind"/> (Claude Code
/// or Codex) is available on PATH, walking the user through <see cref="CliToolSetupDialog"/> when
/// it isn't. Mirrors <see cref="SummaryModelResolver"/>'s "resolve or show wizard" pattern.
/// </summary>
public static class CliProviderResolver
{
    private static readonly ICliProcessRunner ProcessRunner = new CliProcessRunner();

    /// <summary>True if <paramref name="kind"/>'s CLI is available, walking the user through
    /// <see cref="CliToolSetupDialog"/> first when it isn't. Returns false only if the user
    /// cancels the dialog.</summary>
    public static async Task<bool> EnsureAvailableAsync(SummaryProviderKind kind, XamlRoot xamlRoot)
    {
        if (IsOnPath(kind))
            return true;

        return await CliToolSetupDialog.ShowAsync(kind, xamlRoot);
    }

    public static bool IsOnPath(SummaryProviderKind kind) => ProcessRunner.IsOnPath(ExecutableNameFor(kind));

    public static string ExecutableNameFor(SummaryProviderKind kind) => kind switch
    {
        SummaryProviderKind.ClaudeCode => "claude",
        SummaryProviderKind.Codex => "codex",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Only ClaudeCode and Codex are CLI-backed providers."),
    };
}
