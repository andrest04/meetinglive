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

    /// <summary>
    /// Selects whichever option matches <see cref="AppSettings.UiLanguage"/>. When that setting is
    /// unset (no override has ever been persisted), reflects the language the WinUI <c>.resw</c>
    /// resource system is <em>actually</em> resolving right now — the first entry of
    /// <c>ApplicationLanguages.Languages</c>, which already accounts for the OS's ranked preferred
    /// languages against what this app supports — instead of assuming English, so the picker never
    /// shows a selection that lies about the effective UI language. Falls back to
    /// <c>Options[0]</c> only when nothing matches (e.g. the OS reports no effective language, or it
    /// reports one this app doesn't offer as a picker option).
    /// </summary>
    public void ApplyLoadedSettings(AppSettings settings)
    {
        string? effectiveTag = string.IsNullOrWhiteSpace(settings.UiLanguage)
            ? ApplicationLanguages.Languages.FirstOrDefault()
            : settings.UiLanguage;

        string? matchedTag = UiLanguageResolver.MatchPrimarySubtag(effectiveTag, Options.Select(o => o.LanguageTag));

        SelectedOption = Options.FirstOrDefault(o => o.LanguageTag == matchedTag) ?? Options[0];
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
