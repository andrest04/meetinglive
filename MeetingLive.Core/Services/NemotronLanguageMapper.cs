namespace MeetingLive.Core.Services;

/// <summary>
/// Maps the app's short language codes (Settings / <c>TranscriptionLanguageCatalog</c>)
/// to Nemotron locale tags expected by <c>nemo_speech_asr_recognition_options.language_code</c>.
/// </summary>
public static class NemotronLanguageMapper
{
    public static string ToNemotronLocale(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return "auto";

        return code.Trim().ToLowerInvariant() switch
        {
            "auto" => "auto",
            "en" => "en-US",
            "es" => "es-US",
            "pt" => "pt-BR",
            "fr" => "fr-FR",
            "de" => "de-DE",
            "it" => "it-IT",
            "nl" => "nl-NL",
            "ja" => "ja-JP",
            "zh" => "zh-CN",
            _ => "auto",
        };
    }
}
