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
    /// pinned in Settings, e.g. "en". Null means the default (auto-detect).</summary>
    public string? TranscriptionLanguage { get; set; }

    /// <summary>Resolves <see cref="TranscriptionLanguage"/>, defaulting to "auto" when unset
    /// (e.g. an older settings file from before this field existed).</summary>
    public string ResolveTranscriptionLanguage() =>
        string.IsNullOrWhiteSpace(TranscriptionLanguage) ? "auto" : TranscriptionLanguage;

    /// <summary>The <see cref="NAudio.CoreAudioApi.MMDevice.ID"/> of the microphone the user picked
    /// in Settings to record from. Null/empty means "use the OS default input device" — also the
    /// safe fallback if the previously selected device has been unplugged or no longer exists.</summary>
    public string? SelectedMicrophoneDeviceId { get; set; }

    /// <summary>Whether live Nemotron streaming transcription runs during recording.
    /// Defaults to <see langword="true"/>. Turning it off only defers transcription until Stop
    /// (still Nemotron, over the WAV) — it does not switch engines.</summary>
    public bool LiveTranscriptionEnabled { get; set; } = true;
}
