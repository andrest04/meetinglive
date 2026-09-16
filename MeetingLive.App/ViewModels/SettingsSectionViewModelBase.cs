using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Common plumbing shared by every Settings-page section view model.
/// </summary>
public abstract partial class SettingsSectionViewModelBase : ObservableObject
{
    /// <summary>Loads the current settings, applies <paramref name="mutate"/>, and saves the whole
    /// blob back — <see cref="IAppSettingsService.SaveAsync"/> overwrites the file wholesale, so
    /// every call site must round-trip the fields it isn't touching (model id vs. provider kind)
    /// rather than construct a fresh <see cref="AppSettings"/>.</summary>
    protected static async Task SaveSettingsAsync(Action<AppSettings> mutate)
    {
        var settings = await AppServices.Settings.LoadAsync();
        mutate(settings);
        await AppServices.Settings.SaveAsync(settings);
    }
}
