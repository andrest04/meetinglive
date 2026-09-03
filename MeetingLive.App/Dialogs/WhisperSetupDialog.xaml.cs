using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// First-time (or missing-file) download of the Whisper GGML used after Stop.
/// Cancel means the caller must not start recording.
/// </summary>
public sealed partial class WhisperSetupDialog : ContentDialog
{
    public WhisperSetupDialogViewModel ViewModel { get; } = new();

    public WhisperSetupDialog()
    {
        InitializeComponent();
        ViewModel.Completed += (_, _) => Hide();
        Opened += async (_, _) => await ViewModel.StartDownloadAsync();
        CloseButtonClick += (_, _) => ViewModel.Cancel();
    }

    /// <summary>Shows the dialog modally. Returns true once Whisper is on disk, false if cancelled or failed.</summary>
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new WhisperSetupDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.IsReady;
    }
}
