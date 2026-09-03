namespace MeetingLive.Core.Models;

/// <summary>Small local settings blob — currently just the user's chosen local GGUF summary model.</summary>
public sealed class AppSettings
{
    /// <summary>The <see cref="SummaryModelInfo.FileName"/> of the selected local summary model.</summary>
    public string? SelectedSummaryModelId { get; set; }

    /// <summary>The <see cref="SummaryProviderKind"/> the user picked in Settings, stored as its
    /// enum name (e.g. "Local", "ClaudeCode", "Codex"). Null means the default (Local).</summary>
    public string? SelectedSummaryProvider { get; set; }

    /// <summary>Parses <see cref="SelectedSummaryProvider"/>, defaulting to <see cref="SummaryProviderKind.Local"/>
    /// when unset or unrecognized (e.g. an older settings file from before this field existed).</summary>
    public SummaryProviderKind ResolveSummaryProviderKind() =>
        Enum.TryParse<SummaryProviderKind>(SelectedSummaryProvider, out var kind) ? kind : SummaryProviderKind.Local;

    /// <summary>The meeting-language code (<see cref="TranscriptionLanguageOption.Code"/>) the user
    /// pinned in Settings, e.g. "en". Null means the default (Spanish — NVIDIA LangID beats auto).</summary>
    public string? TranscriptionLanguage { get; set; }

    /// <summary>Resolves <see cref="TranscriptionLanguage"/>, defaulting to "es" when unset.
    /// Nemotron 3.5 ASR WER on Spanish is lower with an explicit locale than with <c>auto</c>.</summary>
    public string ResolveTranscriptionLanguage() =>
        string.IsNullOrWhiteSpace(TranscriptionLanguage) ? "es" : TranscriptionLanguage;

    /// <summary>Language of the written summary body and action items (<c>es</c>, <c>en</c>).
    /// Null means Spanish.</summary>
    public string? SummaryLanguage { get; set; }

    public string ResolveSummaryLanguage() =>
        string.IsNullOrWhiteSpace(SummaryLanguage) ? "es" : SummaryLanguage;

    /// <summary>The <see cref="NAudio.CoreAudioApi.MMDevice.ID"/> of the microphone the user picked
    /// in Settings to record from. Null/empty means "use the OS default input device" — also the
    /// safe fallback if the previously selected device has been unplugged or no longer exists.</summary>
    public string? SelectedMicrophoneDeviceId { get; set; }

    /// <summary>Whether live Nemotron streaming transcription runs during recording.
    /// Defaults to <see langword="true"/>. The saved transcript always comes from Nemotron
    /// over the WAV; this only controls the on-screen preview.</summary>
    public bool LiveTranscriptionEnabled { get; set; } = true;

    /// <summary>User-resized NavigationView pane width in DIPs. Null uses the default.</summary>
    public double? NavigationPaneLength { get; set; }

    public const double DefaultNavigationPaneLength = 280;
    public const double MinNavigationPaneLength = 200;
    public const double MaxNavigationPaneLength = 480;

    public double ResolveNavigationPaneLength()
    {
        if (NavigationPaneLength is not { } length)
            return DefaultNavigationPaneLength;

        return Math.Clamp(length, MinNavigationPaneLength, MaxNavigationPaneLength);
    }
}
