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
        Title = AppStrings.Format("Cli_SetupTitle", name);
        InstructionsText.Text = AppStrings.Format(
            "Cli_NotFound",
            CliProviderResolver.ExecutableNameFor(kind),
            installHint);

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
        StatusInfoBar.Message = AppStrings.Format(
            "Cli_StillMissing",
            CliProviderResolver.ExecutableNameFor(_kind));
    }

    private static (string Name, string InstallHint) DescribeFor(SummaryProviderKind kind) => kind switch
    {
        SummaryProviderKind.ClaudeCode => (
            AppStrings.Get("Cli_ClaudeName"),
            AppStrings.Get("Cli_ClaudeHint")),
        SummaryProviderKind.Codex => (
            AppStrings.Get("Cli_CodexName"),
            AppStrings.Get("Cli_CodexHint")),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Only ClaudeCode and Codex are CLI-backed providers."),
    };
}
