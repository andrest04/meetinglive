namespace MeetingLive.Core.Models;

/// <summary>Small local settings blob — currently just the user's chosen local GGUF summary model.</summary>
public sealed class AppSettings
{
    /// <summary>The <see cref="SummaryModelInfo.FileName"/> of the selected local summary model.</summary>
    public string? SelectedSummaryModelId { get; set; }

    /// <summary>The <see cref="SummaryProviderKind"/> the user picked in Settings, stored as its
    /// enum name (e.g. "Local", "ClaudeCode", "Codex", "Xai"). Null means the default (Local).</summary>
    public string? SelectedSummaryProvider { get; set; }

    /// <summary>The xAI chat model id to use when <see cref="SelectedSummaryProvider"/> is Xai
    /// (e.g. "grok-4.6"). Not a secret. Null/empty means the default.</summary>
    public string? SelectedXaiModelId { get; set; }

    /// <summary>xAI <c>reasoning_effort</c> (none/low/medium/high/xhigh). Null means low.</summary>
    public string? SelectedXaiEffort { get; set; }

    /// <summary>Claude Code <c>--model</c> alias (sonnet/opus/haiku/fable). Null means sonnet.</summary>
    public string? SelectedClaudeModelId { get; set; }

    /// <summary>Claude Code <c>--effort</c> (low/medium/high/xhigh/max). Null means low.</summary>
    public string? SelectedClaudeEffort { get; set; }

    /// <summary>Codex <c>-m</c> model id. Null means gpt-5.6.</summary>
    public string? SelectedCodexModelId { get; set; }

    /// <summary>Codex <c>model_reasoning_effort</c> (low/medium/high/xhigh). Null means low.</summary>
    public string? SelectedCodexEffort { get; set; }

    public string ResolveClaudeModelId() =>
        string.IsNullOrWhiteSpace(SelectedClaudeModelId) ? InferenceCatalog.DefaultClaudeModel : SelectedClaudeModelId;

    public string ResolveClaudeEffort() =>
        string.IsNullOrWhiteSpace(SelectedClaudeEffort) ? InferenceCatalog.DefaultEffort : SelectedClaudeEffort;

    public string ResolveCodexModelId() =>
        string.IsNullOrWhiteSpace(SelectedCodexModelId) ? InferenceCatalog.DefaultCodexModel : SelectedCodexModelId;

    public string ResolveCodexEffort() =>
        string.IsNullOrWhiteSpace(SelectedCodexEffort) ? InferenceCatalog.DefaultEffort : SelectedCodexEffort;

    public string ResolveXaiEffort() =>
        string.IsNullOrWhiteSpace(SelectedXaiEffort) ? InferenceCatalog.DefaultEffort : SelectedXaiEffort;

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
    /// Defaults to <see langword="true"/>. The live draft is saved at Stop; Nemotron
    /// then re-reads the WAV and replaces that transcript when it produces text.</summary>
    public bool LiveTranscriptionEnabled { get; set; } = true;

    /// <summary>Whether Sortformer speaker labels (Speaker 1–4) run during live and WAV
    /// transcription. Defaults to <see langword="false"/> (opt-in). A missing JSON field
    /// deserializes as false. The GGUF is downloaded separately and is not required for Record.</summary>
    public bool SpeakerDiarizationEnabled { get; set; }

    /// <summary>
    /// When true, Jev may run after a summary if a TypeSafe API key is saved.
    /// Key presence is the real gate; this toggle lets the user keep the key
    /// without sending transcripts. Defaults to <see langword="true"/>.
    /// </summary>
    public bool TypeSafeEnabled { get; set; } = true;

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
