using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// First-time (or missing-files) download of the Nemotron GGUF and NeMo-Speech.cpp runtime.
/// Cancel means the caller must not start recording.
/// </summary>
public sealed partial class TranscriptionEngineSetupDialog : ContentDialog
{
    public TranscriptionEngineSetupDialogViewModel ViewModel { get; } = new();

    public TranscriptionEngineSetupDialog()
    {
        InitializeComponent();
        ViewModel.Completed += (_, _) => Hide();
        Opened += async (_, _) => await ViewModel.StartDownloadAsync();
        CloseButtonClick += (_, _) => ViewModel.Cancel();
    }

    /// <summary>Shows the dialog modally. Returns true once the engine is on disk, false if cancelled or failed.</summary>
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new TranscriptionEngineSetupDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.IsReady;
    }
}
