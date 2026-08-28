namespace MeetingLive.Core.Models;

/// <summary>One entry in the curated meeting-language catalog. <see cref="Code"/> doubles as the
/// stable identifier persisted in <see cref="AppSettings.TranscriptionLanguage"/> and as the
/// Whisper language code passed to <c>ITranscriptionService.TranscribeAsync</c>.</summary>
public sealed record TranscriptionLanguageOption(string Code, string DisplayName);

/// <summary>
/// Curated shortlist of common Whisper language codes the user can pin the meeting language
/// to, instead of relying on Whisper's auto-detection (which only samples the first ~30s of
/// audio and can misdetect on silence/noise/filler words at the start). Not the full ~99
/// Whisper language list — just the languages this app's users are most likely to need.
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
