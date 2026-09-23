using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure BCP-47 language tag -&gt; <see cref="CultureInfo"/> resolution for the app's UI language
/// override. Kept UI-framework-agnostic (no WinUI/WinRT dependency) so it is unit-testable
/// without a UI thread. <c>MeetingLive.App</c> calls this at startup to sync
/// <see cref="CultureInfo.CurrentUICulture"/>/<see cref="CultureInfo.CurrentCulture"/> (which
/// <see cref="MeetingLive.Core.Strings.CoreStrings"/> and date/time formatting follow) with
/// whatever language <c>Windows.Globalization.ApplicationLanguages.PrimaryLanguageOverride</c>
/// makes the WinUI <c>.resw</c> resource system resolve — the two systems are independent and do
/// not sync themselves.
/// </summary>
public static class UiLanguageResolver
{
    /// <summary>BCP-47 tag for English (United States) — the app's neutral/default resource language.</summary>
    public const string English = "en-US";

    /// <summary>BCP-47 tag for Spanish.</summary>
    public const string Spanish = "es";

    /// <summary>
    /// Resolves a persisted/override language tag to a <see cref="CultureInfo"/>. Null, empty,
    /// whitespace, or a tag .NET does not recognize resolves to <see langword="null"/>, meaning
    /// "follow the system default" — the caller should leave the current thread culture alone
    /// rather than force one.
    /// </summary>
    public static CultureInfo? ResolveCulture(string? languageTag)
    {
        if (string.IsNullOrWhiteSpace(languageTag))
            return null;

        try
        {
            return CultureInfo.GetCultureInfo(languageTag);
        }
        catch (CultureNotFoundException)
        {
            return null;
        }
    }

    /// <summary>
    /// Picks whichever of <paramref name="availableTags"/> shares the same primary BCP-47 subtag as
    /// <paramref name="candidateTag"/> (e.g. "es-ES" matches "es", "en-GB" matches "en-US"), case-insensitively.
    /// Returns null when <paramref name="candidateTag"/> is null/empty or nothing matches.
    /// </summary>
    public static string? MatchPrimarySubtag(string? candidateTag, IEnumerable<string> availableTags)
    {
        if (string.IsNullOrWhiteSpace(candidateTag))
            return null;

        string candidatePrimary = candidateTag.Split('-')[0];

        foreach (string availableTag in availableTags)
        {
            string availablePrimary = availableTag.Split('-')[0];
            if (string.Equals(candidatePrimary, availablePrimary, StringComparison.OrdinalIgnoreCase))
                return availableTag;
        }

        return null;
    }
}
