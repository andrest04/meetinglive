using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Guided setup wizard shown when no local summary model has been picked yet:
/// detects hardware, offers the curated GGUF catalog with fit-rating badges,
/// and downloads the chosen model to disk.
/// </summary>
public sealed partial class SummaryModelSetupDialog : ContentDialog
{
    public SummaryModelSetupDialogViewModel ViewModel { get; } = new();

    public SummaryModelSetupDialog()
    {
        InitializeComponent();
        ViewModel.Completed += (_, _) => Hide();
        Loaded += async (_, _) => await ViewModel.InitializeAsync();
    }

    /// <summary>Shows the wizard modally and returns the chosen model's file path, or null if the user cancelled.</summary>
    public static async Task<string?> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new SummaryModelSetupDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.ResultModelPath;
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static bool IsNotNull(object? value) => value is not null;
}
