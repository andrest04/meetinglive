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
        new TranscriptionLanguageOption("auto", "Auto (detect)"),
        new TranscriptionLanguageOption("en", "English"),
        new TranscriptionLanguageOption("es", "Spanish"),
        new TranscriptionLanguageOption("pt", "Portuguese"),
        new TranscriptionLanguageOption("fr", "French"),
        new TranscriptionLanguageOption("de", "German"),
        new TranscriptionLanguageOption("it", "Italian"),
        new TranscriptionLanguageOption("nl", "Dutch"),
        new TranscriptionLanguageOption("ja", "Japanese"),
        new TranscriptionLanguageOption("zh", "Chinese"),
    ];
}

/// <summary>Output language for the written summary and action items. Separate from
/// transcription so a Spanish meeting can still be summarized in English if the user wants.</summary>
public static class SummaryLanguageCatalog
{
    public static readonly IReadOnlyList<TranscriptionLanguageOption> Languages =
    [
        new TranscriptionLanguageOption("es", "Spanish"),
        new TranscriptionLanguageOption("en", "English"),
    ];
}
