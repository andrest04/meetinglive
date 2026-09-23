namespace MeetingLive_App.ViewModels;

/// <summary>
/// One selectable UI language in Settings. <see cref="LanguageTag"/> is the BCP-47 tag passed to
/// <c>Windows.Globalization.ApplicationLanguages.PrimaryLanguageOverride</c> and to
/// <see cref="MeetingLive.Core.Services.UiLanguageResolver"/>. <see cref="DisplayName"/> is shown
/// in that language's own script regardless of the app's current UI language — matching how OS
/// language pickers list "Español" even while running in English — so it is intentionally not
/// re-translated per current culture.
/// </summary>
public sealed class UiLanguageOption(string languageTag, string displayName)
{
    public string LanguageTag { get; } = languageTag;

    public string DisplayName { get; } = displayName;

    public override string ToString() => DisplayName;
}
