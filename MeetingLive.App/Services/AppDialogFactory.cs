using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace MeetingLive_App.Services;

/// <summary>
/// Centralizes <see cref="ContentDialog"/> construction. Before this factory, every page built
/// its own dialog imperatively (RecordingPage, SummaryPage, SessionPage, HistoryPage, App), and
/// two of them (<c>SessionPage.CreateDialog</c> and <c>HistoryPage.CreateDialog</c>) had
/// converged on byte-for-byte identical private helpers without either page knowing about the
/// other. This gives every call site one shared construction point per dialog shape, so only the
/// parts that actually vary (XamlRoot, title, content, button text) are passed in.
/// </summary>
public static class AppDialogFactory
{
    /// <summary>
    /// A dialog with a Primary and Close button — for confirmations and prompts. <paramref name="content"/>
    /// can be plain text or an interactive control (e.g. a <see cref="TextBox"/> for renaming, a
    /// <see cref="ListView"/> for picking a destination).
    /// </summary>
    public static ContentDialog CreateConfirm(
        XamlRoot xamlRoot,
        string title,
        object content,
        string primaryButtonText,
        string closeButtonText,
        ContentDialogButton defaultButton) => new()
    {
        XamlRoot = xamlRoot,
        Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
        Title = title,
        Content = content,
        PrimaryButtonText = primaryButtonText,
        CloseButtonText = closeButtonText,
        DefaultButton = defaultButton,
    };

    /// <summary>
    /// A dialog with only a Close button — for surfacing an error or another terminal, one-button
    /// message where there is nothing to confirm.
    /// </summary>
    public static ContentDialog CreateError(
        XamlRoot xamlRoot,
        string title,
        object content,
        string closeButtonText) => new()
    {
        XamlRoot = xamlRoot,
        Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
        Title = title,
        Content = content,
        CloseButtonText = closeButtonText,
        DefaultButton = ContentDialogButton.Close,
    };
}
