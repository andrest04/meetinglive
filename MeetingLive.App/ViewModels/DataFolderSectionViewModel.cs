using System.Diagnostics;
using System.Reflection;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: where app data lives on disk, and the app version.
/// </summary>
public sealed partial class DataFolderSectionViewModel : SettingsSectionViewModelBase
{
    public string MeetingsFolderPath { get; } = AppPaths.UserDataDirectory;

    public string AppDataDirectoryPath { get; } = AppPaths.RootDirectory;

    public string AppVersion { get; } = ResolveAppVersion();

    private static string ResolveAppVersion()
    {
        try
        {
            var version = Windows.ApplicationModel.Package.Current.Id.Version;
            return $"{version.Major}.{version.Minor}.{version.Build}.{version.Revision}";
        }
        catch (Exception)
        {
            var informational = typeof(DataFolderSectionViewModel).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion;
            return string.IsNullOrWhiteSpace(informational) ? "1.0.0.0" : informational;
        }
    }

    [RelayCommand]
    private void OpenDataFolder()
    {
        AppPaths.EnsureDirectoriesExist();
        // explorer.exe "C:\path" is ignored and opens Documents. Open the directory itself.
        Process.Start(new ProcessStartInfo
        {
            FileName = MeetingsFolderPath,
            UseShellExecute = true,
        });
    }
}
