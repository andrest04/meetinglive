using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using Windows.Globalization;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: the app's own UI language (English/Spanish) — independent of the meeting
/// and summary content languages owned by <see cref="LanguageSectionViewModel"/>. Picking a
/// language updates the live <c>ApplicationLanguages.PrimaryLanguageOverride</c> (what the WinUI
/// <c>.resw</c> resource system follows) and persists the choice via <see cref="AppSettings.UiLanguage"/>
/// so <c>App.xaml.cs</c> can re-apply it and sync <see cref="System.Globalization.CultureInfo"/> the
/// next time the process starts — the resw system does not do that on its own.
/// </summary>
public sealed partial class UiLanguageSectionViewModel : SettingsSectionViewModelBase
{
    public IReadOnlyList<UiLanguageOption> Options { get; } =
    [
        new UiLanguageOption(UiLanguageResolver.English, AppStrings.Get("Settings_LanguageEnglish")),
        new UiLanguageOption(UiLanguageResolver.Spanish, AppStrings.Get("Settings_LanguageSpanish")),
    ];

    [ObservableProperty]
    private UiLanguageOption _selectedOption;

    public UiLanguageSectionViewModel()
    {
        _selectedOption = Options[0];
    }

    /// <summary>Selects whichever option matches <see cref="AppSettings.UiLanguage"/>, defaulting
    /// to English (the neutral resource language) when unset or unrecognized.</summary>
    public void ApplyLoadedSettings(AppSettings settings)
    {
        SelectedOption = Options.FirstOrDefault(
            o => string.Equals(o.LanguageTag, settings.UiLanguage, StringComparison.OrdinalIgnoreCase))
            ?? Options[0];
    }

    /// <summary>
    /// Applies <paramref name="option"/> as the new UI language: updates the live WinRT override
    /// so the resw system follows it, and persists it via the settings load-mutate-save pattern.
    /// Returns <see langword="true"/> when the language actually changed, so the caller knows
    /// whether a restart-required notice is warranted.
    /// </summary>
    public async Task<bool> ApplyLanguageAsync(UiLanguageOption option)
    {
        if (option.LanguageTag == SelectedOption.LanguageTag)
            return false;

        SelectedOption = option;
        ApplicationLanguages.PrimaryLanguageOverride = option.LanguageTag;
        await SaveSettingsAsync(settings => settings.UiLanguage = option.LanguageTag);
        return true;
    }
}
