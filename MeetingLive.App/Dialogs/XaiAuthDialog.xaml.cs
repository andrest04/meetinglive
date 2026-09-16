using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Blocking SuperGrok device-code login or pasted API key. Used from Settings,
/// <see cref="Services.XaiProviderResolver"/>, and the first-run summary wizard.
/// </summary>
public sealed partial class XaiAuthDialog : ContentDialog
{
    public XaiAuthDialogViewModel ViewModel { get; } = new();

    public XaiAuthDialog()
    {
        InitializeComponent();
        ViewModel.Completed += (_, _) => Hide();
        Closed += OnClosed;
    }

    /// <summary>Shows the dialog. Returns true when SuperGrok or an API key was saved.</summary>
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new XaiAuthDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog.ViewModel.Succeeded;
    }

    private void ApiKeyBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox box)
            ViewModel.ApiKeyDraft = box.Password ?? string.Empty;
    }

    private void OnClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        ViewModel.CancelPolling();
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static bool Negate(bool value) => !value;
}
