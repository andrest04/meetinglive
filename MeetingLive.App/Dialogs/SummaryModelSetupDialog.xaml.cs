using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive.Core.Models;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Guided setup wizard shown when no summary engine has been picked yet: first asks the user to
/// choose between Claude Code, Codex, or a local model, then — for Local — detects hardware,
/// offers the curated GGUF catalog with fit-rating badges, and downloads the chosen model.
/// </summary>
public sealed partial class SummaryModelSetupDialog : ContentDialog
{
    private readonly bool _skipToLocalModelSelection;

    public SummaryModelSetupDialogViewModel ViewModel { get; } = new();

    public SummaryModelSetupDialog(bool skipToLocalModelSelection = false)
    {
        InitializeComponent();
        _skipToLocalModelSelection = skipToLocalModelSelection;
        ViewModel.Completed += (_, _) => Hide();

        if (_skipToLocalModelSelection)
            Loaded += async (_, _) => await ViewModel.InitializeForLocalOnlyAsync();
    }

    /// <summary>Shows the wizard modally. Returns the chosen engine and (for Local) the model's
    /// file path, or null if the user cancelled without resolving one.</summary>
    public static async Task<(SummaryProviderKind Kind, string? ModelPath)?> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new SummaryModelSetupDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.IsResolved
            ? (dialog.ViewModel.ResultProviderKind, dialog.ViewModel.ResultModelPath)
            : null;
    }

    /// <summary>Shows the wizard modally, skipping straight to local model selection (no engine
    /// chooser) — used when the caller already knows the engine is Local. Returns the model's
    /// file path, or null if the user cancelled.</summary>
    public static async Task<string?> ShowForLocalModelAsync(XamlRoot xamlRoot)
    {
        var dialog = new SummaryModelSetupDialog(skipToLocalModelSelection: true) { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.IsResolved ? dialog.ViewModel.ResultModelPath : null;
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static bool IsNotNull(object? value) => value is not null;
}
