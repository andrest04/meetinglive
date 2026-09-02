using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace MeetingLive_App;

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// </summary>
public partial class App : Application
{
    /// <summary>
    /// The main application window. Use <c>App.Window</c> from any class that needs
    /// the window reference (for dialogs, pickers, interop, etc.).
    /// </summary>
    public static Window Window { get; private set; } = null!;

    /// <summary>
    /// The UI thread dispatcher. Use <c>App.DispatcherQueue</c> to marshal calls
    /// to the UI thread. Fully qualified to avoid CS0104 ambiguity with
    /// <see cref="Windows.System.DispatcherQueue"/>.
    /// </summary>
    public static Microsoft.UI.Dispatching.DispatcherQueue DispatcherQueue { get; private set; } = null!;

    /// <summary>
    /// The native window handle (HWND). Use for file pickers,
    /// <c>DataTransferManager</c>, and any WinRT interop that requires
    /// <c>InitializeWithWindow</c>.
    /// </summary>
    public static nint WindowHandle =>
        WinRT.Interop.WindowNative.GetWindowHandle(Window);

    /// <summary>
    /// Initializes the singleton application object.
    /// </summary>
    public App()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Invoked when the application is launched.
    /// </summary>
    /// <param name="args">Details about the launch request and process.</param>
    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        Window = new MainWindow();
        DispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        // Meeting history is the app's only source of persisted data, so a failed
        // migration must surface visibly instead of silently losing it.
        Exception? migrationError = null;
        try
        {
            await new MeetingsMigrationService(AppServices.Meetings).MigrateIfNeededAsync();
        }
        catch (Exception ex)
        {
            migrationError = ex;
        }

        Window.Activate();

        if (migrationError is not null)
            await ShowMigrationFailureDialogAsync(migrationError);
    }

    private static async Task ShowMigrationFailureDialogAsync(Exception ex)
    {
        var dialog = new ContentDialog
        {
            Title = AppStrings.Get("MigrationFailed_Title"),
            Content = AppStrings.Format("MigrationFailed_Content", ex.Message),
            CloseButtonText = AppStrings.Get("Dialog_OK"),
            XamlRoot = Window.Content.XamlRoot,
        };
        await dialog.ShowAsync();
    }
}
