namespace MeetingLive.Core.Models;

/// <summary>One entry in the curated meeting-language catalog. <see cref="Code"/> doubles as the
/// stable identifier persisted in <see cref="AppSettings.TranscriptionLanguage"/> and is mapped
/// to a Nemotron locale by <c>NemotronLanguageMapper</c> before recognition.</summary>
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
