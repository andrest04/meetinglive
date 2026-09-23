using MeetingLive.Core.Strings;

namespace MeetingLive.Core.Models;

/// <summary>One entry in the curated meeting-language catalog. <see cref="Code"/> doubles as the
/// stable identifier persisted in <see cref="AppSettings.TranscriptionLanguage"/> and is mapped
/// to a Nemotron locale by <c>NemotronLanguageMapper</c> for live preview and the
/// saved transcript.</summary>
public sealed record TranscriptionLanguageOption(string Code, string DisplayName);

/// <summary>
/// Curated shortlist of meeting-language codes the user can pin instead of auto-detect.
/// Not an exhaustive locale list — just the languages this app's users are most likely to need.
/// </summary>
public static class TranscriptionLanguageCatalog
{
    public static readonly IReadOnlyList<TranscriptionLanguageOption> Languages =
    [
        new TranscriptionLanguageOption("auto", CoreStrings.Get("LanguageAutoDetect")),
        new TranscriptionLanguageOption("en", CoreStrings.Get("LanguageEnglish")),
        new TranscriptionLanguageOption("es", CoreStrings.Get("LanguageSpanish")),
        new TranscriptionLanguageOption("pt", CoreStrings.Get("LanguagePortuguese")),
        new TranscriptionLanguageOption("fr", CoreStrings.Get("LanguageFrench")),
        new TranscriptionLanguageOption("de", CoreStrings.Get("LanguageGerman")),
        new TranscriptionLanguageOption("it", CoreStrings.Get("LanguageItalian")),
        new TranscriptionLanguageOption("nl", CoreStrings.Get("LanguageDutch")),
        new TranscriptionLanguageOption("ja", CoreStrings.Get("LanguageJapanese")),
        new TranscriptionLanguageOption("zh", CoreStrings.Get("LanguageChinese")),
    ];
}

/// <summary>Output language for the written summary and action items. Separate from
/// transcription so a Spanish meeting can still be summarized in English if the user wants.</summary>
public static class SummaryLanguageCatalog
{
    public static readonly IReadOnlyList<TranscriptionLanguageOption> Languages =
    [
        new TranscriptionLanguageOption("es", CoreStrings.Get("LanguageSpanish")),
        new TranscriptionLanguageOption("en", CoreStrings.Get("LanguageEnglish")),
    ];
}
