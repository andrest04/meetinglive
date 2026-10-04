using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;
using Windows.Globalization;

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
    /// Window id for Windows App SDK storage pickers
    /// (<c>Microsoft.Windows.Storage.Pickers</c>). Do not use the legacy
    /// <c>Windows.Storage.Pickers</c> + <c>InitializeWithWindow</c> path.
    /// </summary>
    public static Microsoft.UI.WindowId WindowId =>
        Microsoft.UI.Win32Interop.GetWindowIdFromWindow(WindowHandle);

    private MeetingCallWatcher? _callWatcher;
    private CalendarReminderWatcher? _calendarReminderWatcher;
    private LiveCopilotWindow? _liveCopilotPill;
    private bool _mainWindowActive = true;
    private bool _wasRecording;
    private bool _handingOff;

    /// <summary>
    /// Initializes the singleton application object.
    /// </summary>
    public App()
    {
        UnhandledException += OnUnhandledException;
        InitializeComponent();
    }

    private static void OnUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.RootDirectory);
            File.AppendAllText(
                Path.Combine(AppPaths.RootDirectory, "crash.log"),
                $"{DateTimeOffset.Now:o}{Environment.NewLine}{e.Exception}{Environment.NewLine}{Environment.NewLine}");
        }
        catch
        {
            // Never throw from the crash logger.
        }
    }

    /// <summary>
    /// Invoked when the application is launched.
    /// </summary>
    /// <param name="args">Details about the launch request and process.</param>
    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        await ApplyPersistedUiLanguageAsync();

        Window = new MainWindow();
        DispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        // Meeting history is the app's only source of persisted data, so a failed
        // migration must surface visibly instead of silently losing it.
        Exception? migrationError = null;
        try
        {
            new UserDataLocationMigrationService().MigrateIfNeeded();
            await new MeetingLibraryLayoutMigrationService().MigrateIfNeededAsync();
            await new MeetingsMigrationService(AppServices.Meetings).MigrateIfNeededAsync();
        }
        catch (Exception ex)
        {
            migrationError = ex;
        }

        Window.Activate();
        Window.Activated += OnMainWindowActivated;
        AppServices.Recording.PropertyChanged += OnRecordingPropertyChanged;
        Window.Closed += (_, _) =>
        {
            Window.Activated -= OnMainWindowActivated;
            AppServices.Recording.PropertyChanged -= OnRecordingPropertyChanged;
            // Closing the pill with the main window lets the process exit.
            _liveCopilotPill?.Close();
            _liveCopilotPill = null;
            _callWatcher?.Dispose();
            _callWatcher = null;
            _calendarReminderWatcher?.Dispose();
            _calendarReminderWatcher = null;
        };

        _callWatcher = new MeetingCallWatcher();
        _callWatcher.Start();
        _calendarReminderWatcher = new CalendarReminderWatcher();
        _calendarReminderWatcher.Start();

        if (migrationError is not null)
            await ShowMigrationFailureDialogAsync(migrationError);
    }

    private void OnMainWindowActivated(object sender, WindowActivatedEventArgs args)
    {
        _mainWindowActive = args.WindowActivationState != WindowActivationState.Deactivated;
        UpdateLiveCopilotPill();
    }

    private void OnRecordingPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(RecordingPageViewModel.IsRecording))
            return;

        if (DispatcherQueue.HasThreadAccess)
            ApplyRecordingHandoff();
        else
            DispatcherQueue.TryEnqueue(ApplyRecordingHandoff);
    }

    /// <summary>
    /// Minimizes and shows the started hint only on the false→true recording transition. Pause,
    /// resume, import, discard, and stop do not take this path. The main window is not restored.
    /// </summary>
    private void ApplyRecordingHandoff()
    {
        var isRecording = AppServices.Recording.IsRecording;
        var decision = LiveCopilotRecordingHandoff.Decide(_wasRecording, isRecording);
        _wasRecording = isRecording;

        if (decision.MinimizeMainWindow && Window.AppWindow.Presenter is OverlappedPresenter presenter)
            presenter.Minimize();

        // After Minimize, so a reentrant activation event cannot leave the window marked active
        // and hide the pill before the handoff show.
        if (decision.MinimizeMainWindow)
            _mainWindowActive = false;

        _handingOff = decision.ShowStartedHint;
        UpdateLiveCopilotPill();
        if (decision.ShowStartedHint)
            _liveCopilotPill?.ShowStartedHint();
        _handingOff = false;
    }

    /// <summary>
    /// The floating pill is visible while a recording runs and the main window is not the active
    /// window, and also immediately on the start handoff before deactivation is observed. It is
    /// created on first need, and shown without activation so it never takes focus from the meeting
    /// app in front.
    /// </summary>
    private void UpdateLiveCopilotPill()
    {
        var recording = AppServices.Recording.IsRecording;
        var show = LiveCopilotRecordingHandoff.ShouldShowPill(recording, _mainWindowActive, _handingOff);
        if (!show && _liveCopilotPill is null)
            return;

        if (_liveCopilotPill is null)
        {
            var pill = new LiveCopilotWindow();
            pill.Closed += (_, _) =>
            {
                if (ReferenceEquals(_liveCopilotPill, pill))
                    _liveCopilotPill = null;
            };
            _liveCopilotPill = pill;
        }

        _ = _liveCopilotPill.SetVisibleAsync(show, collapse: !recording);
    }

    /// <summary>
    /// Re-applies the persisted Settings-page language choice (<see cref="AppSettings.UiLanguage"/>)
    /// before the first window or resource use, and syncs <see cref="CultureInfo.CurrentUICulture"/>/
    /// <see cref="CultureInfo.CurrentCulture"/> to match. <c>Windows.Globalization.ApplicationLanguages</c>
    /// (which the WinUI <c>.resw</c> resource system follows) and <see cref="CultureInfo"/> (which
    /// <see cref="MeetingLive.Core.Strings.CoreStrings"/> and <c>AppStrings.Format</c>'s date
    /// formatting follow) are independent systems that do not sync each other. The persisted
    /// setting — not whatever <c>PrimaryLanguageOverride</c> already holds — is treated as the
    /// source of truth, matching how every other user preference in this app round-trips through
    /// <see cref="AppSettingsService"/> rather than relying solely on a platform API's own state.
    /// </summary>
    private static async Task ApplyPersistedUiLanguageAsync()
    {
        AppSettings settings;
        try
        {
            settings = await AppServices.Settings.LoadAsync();
        }
        catch (Exception)
        {
            // Best effort — fall back to whatever the OS/ApplicationLanguages already resolved.
            return;
        }

        if (string.IsNullOrWhiteSpace(settings.UiLanguage))
            return;

        // Re-assert the WinRT override every launch: cheap and idempotent, and guards against the
        // package-scoped override state ever drifting from our own persisted settings.json.
        ApplicationLanguages.PrimaryLanguageOverride = settings.UiLanguage;

        if (UiLanguageResolver.ResolveCulture(settings.UiLanguage) is not { } culture)
            return;

        CultureInfo.CurrentUICulture = culture;
        CultureInfo.CurrentCulture = culture;
        // New threads (thread-pool tasks that call CoreStrings/AppStrings off the UI thread)
        // inherit these, not just the thread OnLaunched happens to run on.
        CultureInfo.DefaultThreadCurrentUICulture = culture;
        CultureInfo.DefaultThreadCurrentCulture = culture;
    }

    private static async Task ShowMigrationFailureDialogAsync(Exception ex)
    {
        var dialog = AppDialogFactory.CreateError(
            Window.Content.XamlRoot,
            AppStrings.Get("MigrationFailed_Title"),
            AppStrings.Format("MigrationFailed_Content", ex.Message),
            AppStrings.Get("Dialog_OK"));
        await dialog.ShowAsync();
    }
}
