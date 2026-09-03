namespace MeetingLive.Core.Services;

/// <summary>
/// Maps the app's short language codes (Settings / <c>TranscriptionLanguageCatalog</c>)
/// to Whisper.cpp <c>WithLanguage</c> values. App codes are already ISO 639-1;
/// <c>auto</c> stays <c>auto</c>.
/// </summary>
public static class WhisperLanguageMapper
{
    public static string ToWhisperLanguage(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return "auto";

        return code.Trim().ToLowerInvariant() switch
        {
            "auto" => "auto",
            "en" => "en",
            "es" => "es",
            "pt" => "pt",
            "fr" => "fr",
            "de" => "de",
            "it" => "it",
            "nl" => "nl",
            "ja" => "ja",
            "zh" => "zh",
            _ => "auto",
        };
    }
}
