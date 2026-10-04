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

    /// <summary>Last microphone the user picked on the Record page: <c>None</c>, <c>SystemDefault</c> or <c>Device</c>.
    /// Null means the user never changed it there, so the Settings microphone applies. Written only by
    /// <see cref="Services.RecordAudioSourceMemory"/>.</summary>
    public string? RecordMicrophoneKind { get; set; }

    /// <summary>Device id for <see cref="RecordMicrophoneKind"/> <c>Device</c>.</summary>
    public string? RecordMicrophoneDeviceId { get; set; }

    /// <summary>Last meeting-audio choice on the Record page: <c>System</c> or <c>App</c>. Null means never changed.</summary>
    public string? RecordOutputKind { get; set; }

    /// <summary>Executable path of the remembered app when <see cref="RecordOutputKind"/> is <c>App</c>.
    /// An app is only reselected when one with this executable is playing audio right now.</summary>
    public string? RecordAppExePath { get; set; }

    /// <summary>Display name of the remembered app. Informational; matching uses <see cref="RecordAppExePath"/>.</summary>
    public string? RecordAppName { get; set; }

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

    /// <summary>
    /// One-minute calendar reminder. Defaults to <see langword="true"/>.
    /// A missing JSON field deserializes as true so older settings files stay on.
    /// </summary>
    public bool CalendarNotificationsEnabled { get; set; } = true;

    /// <summary>
    /// Floating "Start recording" popup when a Zoom/Teams/Meet call is detected. Defaults to
    /// <see langword="true"/>. A missing JSON field deserializes as true so older settings files stay on.
    /// </summary>
    public bool MeetingPopupEnabled { get; set; } = true;

    /// <summary>
    /// Calendar ids hidden from Coming up and the reminder. Empty means every calendar is visible.
    /// A missing JSON field stays empty. The serializer writes this list like the other fields,
    /// including when it is empty — optional strings in this type are written even when null.
    /// </summary>
    public List<string> DisabledCalendarIds { get; set; } = [];

    /// <summary>Empty set passed to <see cref="Services.ICalendarStore"/> when no calendar is hidden.</summary>
    public static IReadOnlySet<string> NoDisabledCalendars { get; } = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>
    /// Ids to skip, compared with <see cref="StringComparer.Ordinal"/> — the same comparer the store uses.
    /// Null or blank entries are dropped. An empty result keeps every calendar.
    /// </summary>
    public IReadOnlySet<string> DisabledCalendarIdsAsSet()
    {
        if (DisabledCalendarIds is not { Count: > 0 })
            return NoDisabledCalendars;

        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in DisabledCalendarIds)
        {
            if (!string.IsNullOrWhiteSpace(id))
                set.Add(id);
        }

        return set.Count == 0 ? NoDisabledCalendars : set;
    }

    /// <summary>The BCP-47 UI language tag the user chose in Settings for the app's own display
    /// language (e.g. "en-US", "es") — independent of <see cref="TranscriptionLanguage"/> and
    /// <see cref="SummaryLanguage"/>, which control the meeting/summary content language, not the
    /// app chrome. Null means follow the system default (no override).</summary>
    public string? UiLanguage { get; set; }

    /// <summary>User-resized NavigationView pane width in DIPs. Null uses the default.</summary>
    public double? NavigationPaneLength { get; set; }

    /// <summary>Left edge, in physical screen pixels, where the user last left the floating live copilot pill.
    /// Null means never moved: the pill opens at the bottom-right of the work area.</summary>
    public int? LiveCopilotPillX { get; set; }

    /// <summary>Top edge counterpart of <see cref="LiveCopilotPillX"/>.</summary>
    public int? LiveCopilotPillY { get; set; }

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
