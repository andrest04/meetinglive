using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive.Core.Models;
using MeetingLive_App.Services;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Simple "install this CLI, then retry" wizard shown when the user picks Claude Code or Codex
/// as their summary provider but the corresponding CLI isn't on PATH yet. No download involved
/// (unlike <see cref="SummaryModelSetupDialog"/>) — just instructions and a Retry button.
/// </summary>
public sealed partial class CliToolSetupDialog : ContentDialog
{
    private readonly SummaryProviderKind _kind;

    public CliToolSetupDialog(SummaryProviderKind kind, XamlRoot xamlRoot)
    {
        InitializeComponent();
        _kind = kind;
        XamlRoot = xamlRoot;

        var (name, installHint) = DescribeFor(kind);
        Title = $"Set up the {name} CLI";
        InstructionsText.Text =
            $"MeetingLive couldn't find \"{CliProviderResolver.ExecutableNameFor(kind)}\" on your PATH. {installHint} " +
            "Once it's installed and signed in, select Retry.";

        PrimaryButtonClick += OnPrimaryButtonClick;
    }

    /// <summary>Shows the wizard modally. Returns true once the CLI is confirmed on PATH, false if the user cancels.</summary>
    public static async Task<bool> ShowAsync(SummaryProviderKind kind, XamlRoot xamlRoot)
    {
        var dialog = new CliToolSetupDialog(kind, xamlRoot);
        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (CliProviderResolver.IsOnPath(_kind))
            return;

        args.Cancel = true;
        StatusInfoBar.Message = $"Still not found on PATH as \"{CliProviderResolver.ExecutableNameFor(_kind)}\". Install it, then try again.";
    }

    private static (string Name, string InstallHint) DescribeFor(SummaryProviderKind kind) => kind switch
    {
        SummaryProviderKind.ClaudeCode => (
            "Claude Code",
            "Install it from https://claude.com/claude-code, then run \"claude\" once from a terminal to sign in."),
        SummaryProviderKind.Codex => (
            "Codex",
            "Install it with \"npm install -g @openai/codex\" (see https://github.com/openai/codex), then run \"codex\" once from a terminal to sign in."),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Only ClaudeCode and Codex are CLI-backed providers."),
    };
}
