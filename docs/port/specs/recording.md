# Recording module: behavior spec

Source of truth: the WinUI3/.NET implementation in `MeetingLive.App` and `MeetingLive.Core` on branch `feat/electron-port` (base commit 53438c5). This document describes what the code does today, not what it should do. Where the code has a defect, section 7 lists it and section 8 states the behavior the port must have (the corrected one is marked "FIX"). String keys refer to `MeetingLive.App/Strings/en-us/Resources.resw` (a Spanish twin exists at `Strings/es/Resources.resw`; the default language of the app settings is Spanish, `es`). English values are quoted so a porter can reproduce them without the resw file.

Conventions: "UI thread" means the single thread that owns view state. `{0}` is a positional format argument. Durations are exact. "Take" is one recording or one import from pressing Record (or choosing a file) to the saved meeting.

Assigned sources covered: `RecordingPage(.xaml/.xaml.cs)`, `RecordingPageViewModel` (+ `.PipelineRun`), `RecordingAudioSourcesViewModel`, `RecordingCaptureChoices`, `AudioSourceCard`, `RecordingSetupDialog(+ViewModel)`, `RecordingPipelineOrchestrator`, `RecordingSetupResolver`, `AudioBarsControl`, `MicrophoneSectionViewModel`, `AppIconCache`, `RecordingPipelineRules`, `RecordingReadiness`, `RecordingSessionGate`, `RecordingPipelineRequest`. Followed into: `RecordingCaptureSources`, `IAudioCaptureService`/`AudioCaptureService`, `ProcessLoopbackCapture` (summary only), `AudioImportService`, `MicrophoneLevelMeterService`, `ActiveAudioAppService`, `ActiveAppEntries`, `MeetingAppSuggestion`, `RecordAudioSourceMemory`, `AudioLevelMeter`, `LiveAnswer*`, `LiveCopilotRecordingHandoff`, `SuggestedMeetingTitle`, `TranscriptStampFormatter`, `TranscriptHighlightApplicator`, `CommittedTranscriptLine`, `MeetingLibraryLayout`, `FolderPathList`, `MarkdownMeetingRepository`, `MeetingMarkdownFormatter`, `MeetingRetranscription`, `MeetingBriefPromptBuilder`, `CalendarEventTiming`, `WavHeaderRepair`.

---

## 1. Purpose

The recording module turns a live meeting (or an imported audio file) into a saved meeting: a Markdown file with a transcript, an AI summary, action items and the user's own notes, plus the sibling WAV. It owns:

1. Choosing what to capture: one microphone (or none) and exactly one of "all system audio" or "one app's audio".
2. Gating Record on readiness (transcription engine installed, a summary engine chosen and usable).
3. Capturing audio into a 16 kHz mono PCM16 WAV, with pause, discard, highlight marks, level meters and a live transcript preview.
4. A live "ask" box and automatic question detection during recording (the answer flow shares code with the floating Live Copilot pill, which is another module and drives this module's commands).
5. A notepad (session notes) that stays editable during recording and processing and is saved with the meeting.
6. After Stop: saving the take as a meeting at once, re-transcribing the WAV offline, summarizing, naming the meeting, and reporting status, with cancel, with graceful handling of every failure so the audio is never lost.
7. Importing an existing audio file through the same pipeline.
8. Starting a take from a calendar event ("Coming up"), including a pre-meeting brief.
9. Protecting an in-flight take when the app closes.

The same pipeline (`RecordingPipelineOrchestrator`) is reused by "re-transcribe" on the Session page (`MeetingRetranscriptionRunner`), so it must be a UI-free service in the port with a callback interface.

---

## 2. User-facing features

### 2.1 Record page: regions and states

The page is cached (`NavigationCacheMode=Required`); state survives navigation. The page has three vertical zones: header zone (row 0), content zone (row 1: transcript column plus side panel), result zone (row 2).

View states (derived, not stored):

| State | Condition | Header zone shows |
|---|---|---|
| Idle, ready | not recording, not processing, `IsReadyToRecord` | idle column (title, destination, brief, Sources card, Record hero, idle error bar, Coming up) |
| Idle, needs setup | not recording, not processing, not ready | same, but the Record hero is replaced by the setup checklist (`ShowSetupPanel`) |
| Recording | `IsRecording` | recording bar (see 2.6) |
| Processing | `IsProcessing` | processing bar (see 2.10) |
| Result | idle and `LastMeeting` not null | result card in row 2 |

Derived flags (exact formulas):

- `IsSessionActive = IsRecording || IsProcessing`.
- `ShowSetupPanel = !IsRecording && !IsProcessing && !IsReadyToRecord`; `ShowRecordHero = !ShowSetupPanel`; `ShowImportAudio = ShowRecordHero && !IsRecording && !IsProcessing`; `ShowComingUp = !IsRecording && !IsProcessing`.
- `ShowSessionNotes = IsRecording || IsProcessing || comingUpNoteOpen`.
- `ShowMeetingBrief = comingUpNoteOpen && !IsProcessing && MeetingBrief is not blank`.
- `ShowTranscriptCanvas = IsSessionActive || HasCanvasTranscript`; `HasCanvasTranscript = CanvasTranscriptText not empty`.
- `CanvasTranscriptText = IsSessionActive ? TranscriptHighlightApplicator.Apply(LiveTranscriptText, highlights) : (LastMeeting.Transcript ?? "")`.
- `CanvasHeading = IsSessionActive ? "Live transcript" (RecordPage_LiveTranscript.Text) : "Transcript" (RecordPage_SavedTranscript)`.
- `ShowMicPreview = capturesSelectedMicrophone && ((IsRecording && !IsPaused) || !IsProcessing)` where `capturesSelectedMicrophone = SelectedRecordingMicrophone is not null-kind-None` (a null selection counts as capturing only when non-null and kind != None; a null selection returns false).
- `IsStatusError = StatusText starts with ErrorPrefix` (case-insensitive; `ErrorPrefix = "Error"` in both languages). See bug B-12.
- `HasSummary = LastMeeting?.Summary != null`. `LastMeetingTitle = LastMeeting?.Title ?? ""`.
- Idle scroll: the page-level scroll is `Auto` when idle and `Disabled` during a session so the transcript row fills the window.
- Layout breakpoint: at window width >= 1100 the side panel (answer card + notes) is a right column 320 px wide with 16 px left margin, notes on the first row and the answer card on the second row with 8 px top margin; below 1100 it stacks under the transcript and the notes box gets `MaxHeight = 200`. Idle column is capped at `MaxWidth = 960`. Page padding 24, row spacing 16.

### 2.2 Title and destination (idle only)

- Title text box. Header "Title" (`RecordPage_MeetingTitle.Header`). Bound two-way, updates on every keystroke. Disabled while recording (`IsEnabled = !IsRecording`); still editable while processing (the take's title was already captured at Stop, so later edits do not affect that take; they are used for the next take unless reset).
- Default title: `AppStrings.MeetingTitle(now)` = format `MeetingTitleFormat` ("Meeting {0}") with `now` formatted by `MeetingTitleDateFormat` ("d MMM, HH:mm", current culture). English example: `Meeting 2 Nov, 14:05`. Spanish: `Reunión 2 nov, 14:05`. The initial value is computed once when the view model is constructed. It is recomputed whenever a run resets for the next take (2.10).
- Destination combo box. Header "Save to" (`RecordPage_Destination.Header`). Items are produced by `FolderPathList.Flatten(folders, "Inbox" (Library_Inbox))`: Inbox first (folder id null), then the folder tree depth-first, siblings sorted case-insensitively by name using the current culture, each path shown as `Parent / Child`. Item text trimmed with ellipsis at max width 260 with the full path as tooltip. Disabled while recording. The list reloads on every navigation to the page; the previously selected folder id is kept if it still exists, else Inbox (index 0). Selecting stores the item.
- Destination decides the directory the WAV is created in at Start and the folder id saved on the meeting (resolved again at Stop; if the folder no longer exists the take lands in Inbox, folder id null).

### 2.3 Sources card (idle only; collapses to a one-line summary while recording)

Heading "Sources" (`RecordPage_SourcesHeading.Text`).

**Microphone** (combo, header "Microphone", name "Microphone"). Items in this order:

1. `None` ("None", `RecordPage_MicrophoneNone`) kind `None`.
2. `System default` (`Microphone_SystemDefault`) kind `SystemDefault`, device id null.
3. One item per capture device, kind `Device`, display name = device name, device id = OS device id. Devices with empty ids are skipped.

Under the combo a level bar (0..100, name "Microphone level") is visible per `ShowMicPreview`. While idle on the page with a microphone selected, the app opens that microphone and meters it (see 3.5).

Selection rules:
- On navigation to the page and on dropdown open the list is rebuilt from the OS. If the page was never touched by the user (`recordingMicrophoneTouched` false), the preselection comes from `RecordAudioSourceMemory.RestoreMicrophone(settings, availableIds)`; if touched, the current choice is preserved (matched by kind and, for devices, by id; a vanished device falls back to `System default`, never to `None`).
- When the rebuilt list equals the current one (same count, kinds, device ids, display names) and a selection exists and `preserveCurrent` is true, the collection is left untouched (rewriting it while the dropdown is open closes the popup). In that case, if the preview is not running, it is started.
- While the list is rebuilt, selection-change events are ignored (`suppressRecordingSourceCommit`), released on the next UI tick.
- User selection: ignored while suppressed or if it is the same object; otherwise sets `touched = true`, selects, and persists (fire-and-forget) via `RememberMicrophone` (load settings, mutate, save whole file; swallow all errors).
- Selecting `None` stops the preview; any other selection restarts it on the new device.
- Load errors (settings or device enumeration) yield an empty device list and `SystemDefault` remembered. A load is discarded if the page was hidden or a newer load started (generation counter `microphoneLoadGeneration`, incremented also on navigate-away).

**Meeting audio** (heading "Meeting audio"): a wrapping grid of selectable cards (single selection, 176 px wide, min height 76, padding 12). Card contents: 24x24 icon (shell icon of the exe if loaded, else a glyph), name in strong text with ellipsis, a level bar (apps only), and a caption row.

- Card 0 is always the fixed system card: name "All system audio" (`RecordPage_AllSystemAudio.Text`), tooltip `RecordPage_SystemCardTooltip` ("Records everything playing on this PC, including other apps."), glyph U+E7F4 style "system" glyph, no meter (no system-wide peak is read; a made-up one would mislead).
- One card per app currently playing audio, tooltip `RecordPage_AppCardTooltip` ("Records this app and the helper processes it starts. Audio from other apps is left out."), fallback glyph an "app" glyph.
- Caption row (first true wins stacking; all can show): "Detected" (`RecordPage_AppDetectedTag.Text`, accent color) when the app is a known meeting app and available; "Records all tabs" (`RecordPage_BrowserHint.Text`, secondary color, wrapping) when the app is a browser and available; "Not playing" (`RecordPage_AppNotPlaying.Text`) when the app is no longer playing but kept because selected.
- Card opacity 1.0 when available, 0.55 when not.
- Empty hint "Play audio in your meeting app to pick it here" (`RecordPage_NoAppsPlaying.Text`) shows when no non-system card is available (a dimmed selected app does not count).
- Card instances are reused across refreshes (keyed by process id) so the selection never resets; the list is reconciled with minimal remove, insert, move operations.
- Selecting a card: sets `userTouched = true`, closes the fallback bar, selects, persists the choice (`RememberSystemAudio` or `RememberApp(exePath, name)`), swallowing errors. Programmatic selection changes (restore, fallback) are not persisted. A null selected item from the list control (rebuild) is ignored.
- Selection change raises `IsAppSelected`, `SelectedName` and re-evaluates the suggestion; `SourcesSummary` (below) depends on `SelectedName`.

**Meeting-app suggestion** (InfoBar, closable, informational, name "Meeting app suggestion"): title `RecordPage_SuggestionTitle` ("{0} is in a call"), action button `RecordPage_SuggestionAction` ("Use {0}"). Shown only while the system card is selected (or none selected) and a known meeting app is playing that the user has not dismissed. Never switches the source by itself. The action selects that app's card (as a user selection). Closing the bar (the user's X) adds the suggested process id to the dismissed set for the rest of the app session (not persisted); programmatic changes to the open flag do not dismiss. While the remembered-app restore is pending (`restoring`) the suggestion is not evaluated, so it does not flash up and vanish.

**Source fallback bar** (InfoBar, warning, closable, title/name "Audio source changed"): message `RecordPage_SourceFallbackMessage` ("{0} is no longer running. Recording all system audio instead."), shown when Record was pressed with an app selected that no longer exists. It lives outside the idle column, so it stays visible once recording starts. Selecting any card closes it.

**One-line summary while recording**: `RecordPage_SourcesSummary` = "Mic: {0} · Audio: {1}" with `{0}` = selected microphone display name (or "System default" if none selected) and `{1}` = `AudioSources.SelectedName` (selected app's name or "All system audio"). It is shown in the recording bar below the title.

### 2.4 Setup checklist (readiness gate UI)

Two presentations of the same snapshot:

(a) Inline panel on the page, shown when idle and not ready: headline `RecordingSetup_Headline.Text` ("Install what is needed before you record. Nothing downloads during Record or Stop."), then three read-only cards and an accent button "Set up to record" (`RecordingSetup_SetUpToRecord.Content`, aligned right, command `SetUpToRecord`).

(b) Modal dialog `RecordingSetupDialog` ("Set up recording" title, `RecordingSetup.Title`; primary "Set up", close "Cancel") with the same headline and cards, shown by `EnsureReadyAsync` when Record or Import is pressed and something is missing.

The three cards (header, status text, detail text):

| Card header (key) | Status text | Detail text |
|---|---|---|
| "Live preview (Nemo)" (`RecordingSetup_Live.Header`) | `LiveStatusLabel`: if live not required "Not needed" (`RecordingSetup_NotNeeded`); else "Ready" (`RecordingSetup_Ready`) if live ready else "Needs setup" (`RecordingSetup_NeedsSetup`) | live required: "On-screen captions while you record." (`RecordingSetup_LiveDetail`); else "Live preview is off. The saved transcript still uses Nemotron after you stop." (`RecordingSetup_LiveNotNeededDetail`) |
| "Transcript (Nemotron)" (`RecordingSetup_Engine.Header`) | "Ready" if engine ready else "Needs setup" | "Required. Transcribes the recording after you stop." (`RecordingSetup_EngineDetail`) |
| "Summary" (`RecordingSetup_Summary.Header`) | "Ready" if summary ready else "Needs setup" | summary caption (see below) |

Summary caption (`SummaryCaption(provider, modelId)`): provider null -> "Not chosen" (`RecordingSetup_SummaryNotChosen`); Local -> `LocalSummaryCaption`: model id blank or unknown in the catalog -> "Local" (`RecordingSetup_SummaryLocal`); known -> "Local — {0}" with the model display name (`RecordingSetup_SummaryLocalModel`); ClaudeCode -> `Cli_ClaudeName`; Codex -> `Cli_CodexName`; Xai -> `Xai_ProviderName`; any other enum value -> "Not chosen".

Dialog buttons (`Apply(snapshot)`): primary enabled only if `!CanRecord`; primary text "Done" (`RecordingSetup_Done`) when can record else "Set up" (`RecordingSetup_SetUp`); default button Close when can record else Primary.

Flow of `EnsureReadyAsync(root)`: evaluate; if `CanRecord` return true without showing anything. Otherwise loop: show the dialog with the snapshot; if the result is not Primary return false; if `dialog.ViewModel.CanRecord` return true (unreachable in practice, see B-17); else `RunMissingStepsAsync`, re-evaluate; if `CanRecord` return true; else loop again.

`RunMissingStepsAsync`: evaluate; if the engine is not ready show the transcription engine setup dialog (`TranscriptionEngineSetupDialog`, owned by another module); if it returns false stop this step (the outer loop re-shows the checklist); re-evaluate. If the summary is not ready show the summary model chooser (`SummaryModelSetupDialog`); if it returns null stop; the chosen `(kind, model)` is persisted by that dialog. If kind is ClaudeCode or Codex run `CliProviderResolver.EnsureAvailableAsync(kind)`; if Xai run `XaiProviderResolver.EnsureAvailableAsync`. Local model download happens inside the chooser dialog.

Page-level readiness state: `RefreshReadinessAsync` evaluates the snapshot and applies it (`IsReadyToRecord`, the six text fields); if idle it sets `StatusText = "Ready to record." (Status_ReadyToRecord)` when ready else `"Set up recording before you start." (Status_NeedsSetup)`. It is refreshed on every navigation to the page, after `SetUpToRecord`, and before every Start and Import.

### 2.5 Start recording

Trigger: Record button (accent, "Record", glyph record dot), keyboard Ctrl+R (also Stop while recording), the Live Copilot pill's toggle, the "take notes" request (2.15), or a calendar open on an event that is now (2.14). Enabled when the session gate allows toggling (`Idle` or `Recording`).

Exact sequence (`StartRecordingAsync` / `StartRecordingCoreAsync`):

1. `gate.TryBeginPreparing()` (Idle -> Preparing); if refused, do nothing. Notify command states.
2. If a setup resolver is wired, `EnsureRecordingReadyAsync()`; if it returns false: refresh readiness and return (no error shown).
3. Refresh readiness; if still not ready return.
4. If no microphone choice exists yet (page never loaded the list) load the list without preserving.
5. Build `RecordingCaptureSources`: `captureMicrophone = selection is not kind None` (a null selection means capture default); `deviceId` = the chosen device's id when kind is Device and id non-empty, else null; output = process tree of the selected app (`AudioSources.ResolveRecordingTarget()` returns the root pid) or system loopback.
6. Load settings. Reset the live-answer session (cancel running answer and question judgment, clear armed question, typed ask, answer, errors, dismissed set, committed transcript state). `CanUseWebSearch = SupportsWebSearch(settings.ResolveSummaryProviderKind())`.
7. `currentMeetingId = linkedMeetingId ?? new Guid`; `recordedAt = now (local offset)`; `endedAt = default`; ensure data directories exist; allocate the WAV path (2.2 / 3.14) using the current title; `currentAudioPath = path`.
8. Clear live transcript text, `liveDraft = null`, `liveSessionActive = false`. If no coming-up note is open: clear session notes, then `RestoreLinkedNotesAsync` (if linked to an existing meeting that has notes, load them). Clear highlight feedback and highlight list. `pausedDuration = 0`, pause clock reset, `IsPaused = false`.
9. If `settings.LiveTranscriptionEnabled`: status "Loading transcription model..." (`Status_LoadingModel`); off the UI thread call `liveTranscription.Start(language, recordedAt, speakerDiarizationEnabled)`; mark live session active.
10. Stop the idle mic preview. Reset `captureFailureNotified = 0`, `captureWarningKey = null`, `captureFailureMessage = null`. Subscribe the four capture events (output failed, faulted, source lost, PCM frame). Off the UI thread call `audioCapture.Start(path, sources)`.
11. `gate.MarkRecording()`; `IsRecording = true` (this starts the elapsed timer and hides the idle column).
12. If a capture failure was notified between steps 10 and 11, call `StopRecordingAsync()` (the earlier failure found nothing to stop). Otherwise set the status (3.6 `RecordingStatusText`).
13. Any exception in steps 9-12: unsubscribe capture events; if a live session was started stop it; `StatusText = "Error: could not start recording ({0})." (Error_StartRecording)` with the exception message; restart the idle mic preview.
14. Any exception escaping steps 2-8: same status text, restart preview. `finally`: `gate.CancelPreparing()` (a no-op once recording started) and notify commands.

### 2.6 Recording bar (while `IsRecording`)

One fixed row in a card (padding 16,12): left status block, middle meter, right actions. Tab order: Stop, Pause, Highlight, Copy, Discard.

- Status block: a red dot (10 px) with a pulsing halo (18 px ellipse, opacity animates 0.15 <-> 0.45 over 1.2 s, auto-reverse, forever) shown only when recording and not paused; if the OS animation setting is off the halo is static at opacity 0.3; when paused or not recording the halo is stopped at opacity 0. Then three lines: elapsed `mm:ss` (strong, name "Elapsed recording time"), the meeting title (caption, ellipsis; tooltip = selected destination path), and the sources summary (caption, ellipsis).
- Mic level bar: width 96, 0..100, visible per `ShowMicPreview`.
- Buttons (min height 40): Stop (accent, label "Stop", Ctrl+R); Pause/Resume (min width 112, glyphs pause U+E769 / play U+E768, labels "Pause" / "Resume", Ctrl+P); Highlight (icon star U+E734, tooltip "Star this moment in the transcript", name "Highlight"); Copy (icon, enabled only when there is canvas text, tooltip "Copy"); Discard (icon trash U+E74D, critical foreground, extra 8 px left margin, tooltip "Discard", Ctrl+Shift+D, opens a confirmation first).
- Keyboard accelerators are scoped to the page buttons. Each handler marks the event handled before checking `CanExecute`.

Pause and Resume (`TogglePause`, enabled only when the gate says capture is controllable, i.e. phase Recording):
- Pause: `audioCapture.Pause()`, stop elapsed stopwatch and timer, restart the pause clock, `IsPaused = true`, `StatusText = "Paused. The break is not recorded." (Status_Paused)`.
- Resume: stop the pause clock, `pausedDuration += pause clock elapsed`, reset the pause clock, `audioCapture.Resume()`, if a live session is active `liveTranscription.SetClockSkew(pausedDuration)`, restart stopwatch and timer, `IsPaused = false`, status = recording status text (3.6).
- The WAV contains no audio for paused time and the live ASR receives no frames while paused. The elapsed counter does not count pauses.

Highlight (enabled while recording, including paused): `elapsed = stopwatch.Elapsed` (clamped to >= 0); append to the highlight list; `HighlightFeedback = "Highlighted {0}" (RecordPage_Highlighted)` with `{0}` = `mm:ss.ff` of elapsed (`TranscriptStampFormatter.FormatElapsed`); the feedback clears after 2 s (single reusable timer, restarted on every press); canvas text and flags are re-notified (stars appear on the live text).

Copy: copies `CanvasTranscriptText` (the live text with highlight stars during a session, the saved transcript otherwise) to the clipboard as plain text; shows a success InfoBar "Copied" / "Transcript copied to the clipboard." (`RecordPage_CopyConfirmation.Title/.Message`), overlaid top-right (max width 320, margin 0,12,12,0) for 2.5 s (timer restarted on repeat). Enabled only if the text is non-empty. While not recording, a text "Copy" button (visible only when there is text) sits in the canvas heading row.

Discard (`DiscardRecording`): the page shows a confirm dialog first: title "Discard this recording?", content "The audio is deleted. Nothing is saved.", primary "Discard", close "Keep recording" (default button Close). Only on Primary and if the command is still executable does it run:
1. `gate.TryBeginStopping()` (Recording -> Stopping); refused -> nothing.
2. Cancel running live answer and question judgment, unsubscribe capture events.
3. `audioCapture.StopAsync()`; on exception, if no capture failure was already notified, show "Error stopping the recording: {0}" (`Error_StopRecording`).
4. If a live session is active, stop it (errors ignored), mark inactive.
5. Delete the WAV file at `currentAudioPath` (errors ignored), set it to null.
6. `gate.MarkIdle()` (Stopping -> Idle), `IsPaused = false`, `IsRecording = false`, clear live transcript, `liveDraft = null`, clear notes only if no coming-up note is open, clear highlight feedback and list, stop elapsed timer (text back to "00:00"), `StatusText = "Recording discarded." (Status_RecordingDiscarded)`, restart the idle mic preview.
Nothing is saved: no meeting file, no folder entry. A linked existing meeting is untouched.

### 2.7 Live transcript canvas

Shown when `ShowTranscriptCanvas`. Row heading: canvas heading text, then a "LIVE" badge (red dot + "Live" `RecordPage_LiveBadge.Text`, rounded border) visible only while recording and not paused. On the right while recording: highlight feedback (accent, ellipsis, max width 360, polite live region) and the status text (secondary, ellipsis, max 360, hidden when it is an error).

The transcript surface: a bordered scroll area (padding 24,20, content max width 760), text 16 px, line height 26, selectable. When there is no text a centered hint (microphone-ish glyph U+E720) shows `RecordPage_LiveTranscriptHint.Text`: "Live preview only. The transcript that is saved is generated from the recording after you stop." (max width 480).

Behavior:
- The displayed text is `CanvasTranscriptText`. It is refreshed on every change of `LiveTranscriptText` or `CanvasTranscriptText`, but not while the text block has keyboard focus (so the user can select without it being replaced); it refreshes on lost focus.
- Auto-follow: the view sticks to the end unless the user scrolled up. "Stuck" is recomputed on every scroll: stuck when the content is not scrollable or `verticalOffset >= scrollableHeight - 32`. A "Jump to latest" accent icon button (U+E74B, tooltip/name "Jump to latest" `RecordPage_JumpToLatest`, bottom-right, margins 0,0,20,16) is visible only when not stuck; clicking it re-sticks and scrolls to the end without animation. Following scrolls to the extent height without animation after a layout pass.
- Live transcript updates (event from the live ASR service, off the UI thread, marshalled to the UI thread): `LiveTranscriptText = update.DisplayText ?? ""` always; the rest only while recording (2.8).
- When processing finishes the offline transcript replaces the live text (`OnTranscriptRefreshed`) and the saved transcript shows after the take is done.
- `LiveTranscriptText` changes also publish to `Workspace.PublishLiveTranscript` (chat reads it while capture is active).

### 2.8 Live ask and question detection (shared with the Live Copilot pill)

Visible while recording, as a dock under the transcript:

1. **Armed question notice** (only when `ArmedQuestion` is non-blank): an informational non-closable InfoBar titled "Question detected" (`RecordPage_LiveQuestionNotice.Title`) with the question as the message; an accent button "Answer" (`RecordPage_LiveAnswer.Content`, tooltip "Answer (Ctrl+Enter)", Ctrl+Enter accelerator scoped to the button); a "Dismiss" button (`RecordPage_LiveAnswerDismiss.Content`).
2. **Error bar**: "Could not answer" (`RecordPage_LiveAnswerError.Title`), Error severity, non-closable, shown when `LiveAnswerError` is non-empty.
3. **Question row**: single-line text box (placeholder "Type a question, then press Ctrl+Enter", name "Type a question", tooltip "Press Ctrl+Enter to ask", Ctrl+Enter scoped to the box submits the typed question); a web-search toggle button (globe glyph U+E774, name "Search the web for the answer", checked state = `ForceWebSearch`, enabled only when `CanUseWebSearch`, tooltip `LiveCopilot_WebTooltipOn` "Search the web for the answer" or `LiveCopilot_WebTooltipOff` "No web search with this provider"); a progress ring (20 px, name "Answering") visible while `IsAnswering`.
4. **Answer card** (in the side panel, visible when `HasLiveAnswer`): heading "Answer", a badge "🌐 Searched the web" (`RecordPage_WebBadge.Text`) when the last completed answer used the web, and the answer text in a scroll area of max height 160, selectable.

Commands (all require `IsRecording`):
- `ConfirmLiveAnswer` (allowed concurrently): enabled when recording and (typed text non-blank or an armed question exists). Question = typed text trimmed if non-empty, else the armed question trimmed. Clears the armed notice.
- `SubmitTypedAsk` (allowed concurrently): enabled when recording and typed text non-blank. Question = typed text; the armed notice is neither confirmed nor dismissed.
- `AskPreset(prompt)`: ignores blank prompt or not recording; sets the typed text to `prompt.Trim()` then runs the typed-ask path. (Used by the pill's chips: "What did I miss?" -> prompt `LiveCopilot_PromptMissed` "What did I miss? Summarize the last few minutes."; "Explain simply" -> `LiveCopilot_PromptExplain` "Explain the last point in simple terms.")
- `DismissArmedQuestion`: enabled when an armed question exists; adds the question body to the dismissed set (exact ordinal string match), clears it and the needs-web flag.

Ask algorithm (`AskLiveAsync`, details in 3.12): bumps a generation counter and replaces the cancellation source (cancelling any previous ask), sets `IsAnswering = true`, clears error and answer, `LiveAnswerUsedWeb = false`; loads settings; decides web use; resolves the summary provider through `SummaryProviderResolver` (which may show setup dialogs); builds the prompt; streams the answer, publishing the growing text at most every 80 ms; publishes the final trimmed text.

Messages: provider could not be resolved -> `Status_SetupCancelled` ("Setup cancelled.") if the page wired setup resolvers, else `LiveCopilot_NeedsSetup` ("Open Vozella to finish provider setup."); in that case the previously armed question is restored. Empty answer -> `RecordPage_LiveAnswerEmpty` ("The answer came back empty."). Exception -> `CliFailureUserMessage.Format(ex)`.

Automatic question detection: see 3.12. It never shows an error to the user.

### 2.9 Notepad (session notes)

- A multi-line text box "Notes" (`RecordPage_SessionNotes.Header`), placeholder "Optional — write in your own words" (`RecordPage_SessionNotes.PlaceholderText`), min height 96, wraps, updates the view model on every keystroke.
- Visible when `ShowSessionNotes` (recording, processing, or a coming-up note is open). It sits in the side panel (right column at width >= 1100, below the transcript otherwise).
- Notes are free text. They are saved with the meeting as the `## Personal Notes` section (trimmed; null if blank) and are used as `RawNotes` in the summary enhancement context so the summary can use them.
- While recording they are cleared at Start unless a coming-up note is open (then they are kept, and loaded from the linked meeting if it has notes).
- They stay editable during processing. The run reads the notes live at each save (callback `CurrentSessionNotes`): while the run owns the session it reads the box; after hand-off to a background summary it reads a snapshot taken at hand-off, so the next take's notes can never leak into an earlier take's save.
- Discard clears them (unless a coming-up note is open).
- Prep notes (before recording, coming-up note open, linked to an existing meeting): `SavePrepNotesAsync` writes the box into that meeting's `Notes` when it differs (null if blank, otherwise the raw untrimmed text), only when not recording and not processing, on box lost-focus and on navigating away. Without a linked existing meeting nothing is persisted until the take is saved (B-8).

### 2.10 Stop and processing

Stop (button/Ctrl+R/pill; `StopRecordingAsync`): every path that ends a capture (user stop, capture failure) goes through here so that two callers share one stop:

1. `gate.TryBeginStopping()` (Recording -> Stopping). If refused, the caller gets the stop task already running.
2. Cancel live answer and question judgment; unsubscribe capture events; `audioCapture.StopAsync()`. On error: if no capture failure was previously notified, `captureFailureMessage = "Error stopping the recording: {0}"` and show it. Teardown always completes; errors are surfaced after.
3. `endedAt = now`.
4. If a live session is active: off the UI thread `liveDraft = liveTranscription.Stop()`; on exception `liveDraft = LiveTranscriptText` if non-blank else null. Else `liveDraft = null`.
5. `gate.MarkProcessing()` (Stopping -> Processing); `IsProcessing = true`; `IsPaused = false`; `IsRecording = false`; start the pipeline run (2.11 / 3.7).

If `currentAudioPath` is null at this point the page finishes processing immediately with the current status text.

Processing bar (while `IsProcessing`): the status text (strong, wraps, polite live region), an indeterminate progress bar, and a "Cancel" button (`RecordPage_CancelProcessing.Content`, name "Cancel transcription or summary") bound to `CancelProcessing`. The transcript canvas shows the live text and replaced by the offline transcript when it arrives. The mic bar follows `ShowMicPreview` (hidden while processing).

Status messages emitted during a run (all via `AppStrings`): "Transcribing audio..." (`Status_Transcribing`), "Transcribing audio... {0}%" (`Status_TranscribingPercent`, integer 0-100), "Generating summary..." (`Status_GeneratingSummary`), and the terminal ones in 3.7. When the take had a capture failure its message is prefixed to every status: `"{captureFailureMessage} {status}"`.

### 2.11 Cancel processing

`CancelProcessing` is enabled only while `IsProcessing`; it cancels the active run's token. Cancelling during transcription: the live draft (if any) is saved as the transcript without summary, status "Cancelled. Transcript saved (no summary)." (`Status_CancelledTranscriptSaved`); with no draft the meeting is already saved with its audio and the status is "Cancelled." (`Status_ProcessingCancelled`). Once the pipeline hands off to the background summary (status "Generating summary...") the session is released, `IsProcessing` is false, the Cancel button disappears and the summary cannot be cancelled from the UI (only by closing the app).

### 2.12 Import audio

Button "Import audio" (`Record_Import`, glyph U+E8E5), shown next to Record while idle (`ShowImportAudio`). Enabled when the gate is Idle.

Sequence (`ImportAudioAsync`):
1. `gate.TryBeginPreparing()`. Same readiness checks as Record (2.5 steps 2-3).
2. Show an OS file picker, single file, filter extensions `.wav .mp3 .m4a .aac .flac .wma .3gp .mp4`, start location the Downloads folder (falls back to Documents). Cancel returns silently (no error).
3. `meetingId = linkedMeetingId ?? new Guid`. `recordedAt` = the source file's last-write time (local; `now` if unreadable or `DateTime.MinValue`). Allocate the destination WAV path (same allocator as Start; title from the title box).
4. `StatusText = "Importing audio..." (Status_Importing)`; stop the idle mic preview.
5. Off the UI thread: `audioImport.ConvertToNemotronWav(source, destination)` then read the WAV duration. Failure: delete the partial destination, `StatusText = "Error: couldn't import that audio ({0})." (Error_ImportAudio)`, restart mic preview, stop.
6. Set `currentMeetingId`, `currentAudioPath`, `recordedAt`, `endedAt = recordedAt + wavDuration`, `liveDraft = null`, `pausedDuration = 0`, clear live text, clear notes (unless a coming-up note is open, then restore linked notes), clear highlights, `IsPaused = false`. `gate.MarkProcessing()` (Preparing -> Processing), `IsProcessing = true`, start the run.
7. Any other exception: same error text; always `gate.CancelPreparing()` in `finally` (a no-op once processing started).

No live transcription, no pause time, no highlights for an import. The same processing bar, cancel and statuses apply.

### 2.13 Result card

After a run saves the meeting, the page shows (idle and `LastMeeting` set) a card with an accent left edge (3 px), a success check glyph (U+E73E), the meeting title (strong, ellipsis) and an accent "Open" button (`RecordPage_Open.Content`). Open: select the meeting in the workspace and open the Session page on the Summary tab if the meeting has a summary, else on the Transcript tab. `LastMeeting` is cleared when the workspace reports that meeting deleted. The transcript canvas shows the saved transcript while the result card is up.

### 2.14 Coming up and calendar-started takes

(The calendar store and pager belong to the calendar module; the behavior that touches the recording is specified here.)

- A "Coming up" strip (heading "Coming up", `ComingUp_Heading.Text`) is shown only while idle. It lists events (cards min width 200, max 240, min height 64: subject, time range, location), horizontally scrollable, with icon-only previous/next paging buttons (names "Previous meetings" / "Next meetings") hidden while a message is shown. A muted message line shows `ComingUp_Empty` ("Nothing coming up.") when empty; an Error InfoBar shows `ComingUp_AccessDenied` or `ComingUp_NoPackageIdentity` on calendar failures. Time label: same day `ComingUp_TimeRange` ("{0:t} – {1:t}"), other day `ComingUp_TimeRangeOtherDay` ("{0:ddd, MMM d} {1:t} – {2:t}").
- Loading: on every navigation to the page. Visible events = calendar events passing the hidden-calendar filter, still relevant (`end + 5 min >= now && start <= now + 14 days`), sorted by start then event id (ordinal). A stale response (older generation) is dropped. Any exception shows the access-denied failure.
- Clicking an event (`OpenComingUp`): ignored if the event is null, an open is in flight, or recording/processing. Otherwise: look up an existing meeting by calendar event id; remember the link (existing meeting id, event id, calendar id, series id, join url, attendee display names); `linkedAgenda = event.Details` trimmed (null if blank); `comingUpNoteOpen = true`; clear brief and brief error; title = existing meeting title, else event subject trimmed, else the placeholder title built from the event start; load notes of the existing meeting into the box if it has any; if the event should start capture now (`start <= now && now <= end + 5 min`) and recording is possible, run the Record command and, if recording started, open the join URL (only `http`/`https` absolute URIs, best effort, errors ignored). Then generate the brief in the background.
- Brief: needs useful context (related prior meetings found by `RelatedMeetings.Find`, or an agenda, or attendees); otherwise nothing is shown and no model is called. Resolves the summary provider (may show setup dialogs), builds the prompt (3.13), runs a one-shot completion off the UI thread, normalizes the reply (blank or `NONE` case-insensitive -> hidden). Result is shown under "Brief" (`RecordPage_BriefHeading.Text`, selectable text) and, when an existing meeting is linked, saved into that meeting's `Brief`. Failures show an Error InfoBar "Could not prepare the brief" (`RecordPage_BriefFailed.Title`) with message `RecordPage_BriefFailedFormat` ("The note is open. The brief could not be prepared: {0}"). Every stage drops its result if the generation counter changed (a newer open, or a cleared link).
- The saved meeting carries `calendarEventId`, `calendarId`, `seriesId`, `joinUrl`, `attendees`, `brief`, and the agenda is passed to the summarizer.
- Clearing the link (`ClearCalendarLink`) happens when a run resets for the next take: clears all link fields and the agenda, `comingUpNoteOpen = false`, bumps the brief generation, clears brief and error.

### 2.15 "Take notes" request and Live Copilot handoff

- `Workspace.RequestTakeNotes(calendarEventId?)` stores a pending request and navigates to Record. When the page is visible it consumes the request immediately (on a dispatcher turn); otherwise it consumes it on the next navigation to the page. If the request has an event id the page opens that event through the Coming-up path (after refreshing the list; ignored if the event is not found or a take is active; all errors swallowed). Without an event id it starts a blank recording if idle and the Record command can execute.
- Handoff (app shell, uses this module's `IsRecording` transitions): on the false->true transition of `IsRecording`, the main window minimizes and a "Recording started" hint (`LiveCopilot_StartedMessage`) shows on the floating pill for 2500 ms; the pill is visible while recording and the main window is not the active window, or immediately during the start handoff. Pause/resume/import/discard/stop do not trigger the handoff. Rules are in `LiveCopilotRecordingHandoff`. Starting a recording also dismisses the "Start recording" call prompt. The pill reads these view-model members: `IsRecording`, `IsPaused`, `ElapsedText`, `MicLevel`, `ToggleRecordingCommand`, `TogglePauseCommand`, `ArmedQuestion`, `HasArmedQuestion`, `ConfirmLiveAnswerCommand`, `DismissArmedQuestionCommand`, `AskPresetCommand`, `SubmitTypedAskCommand`, `LiveAskText`, `ForceWebSearch`, `CanUseWebSearch`, `IsAnswering`, `LiveAnswerText`, `LiveAnswerError`, `LiveAnswerUsedWeb`, `HasLiveAnswer`, `HasLiveAnswerError`.

### 2.16 Closing the app (shell behavior that depends on this module)

- `RequiresCloseConfirmation = gate.Phase == Recording`; `HasPendingSaves = gate.Phase == Stopping || any run not yet completed`. If either is true the shell must intercept close or restart. If recording, a confirm dialog: title "Stop recording before closing?" (`AppClose_Recording_Title`), content `AppClose_Recording_Content` ("Vozella is still recording. Stop and save keeps this take as a meeting, then closes or restarts the app. Any transcription or summary left unfinished can be run again from the meeting."), primary "Stop and save", close "Keep recording" (default Primary). Declining aborts the close.
- Then a non-dismissable progress dialog "Saving your recording" (`AppClose_Saving_Title`) runs `SaveAndFinishForCloseAsync`: stop any capture, wait until every run has saved its meeting (first-save signal), cancel all runs, wait for them to wind down with a 30 s grace limit, and return whether every take was saved. On false: dialog "The recording could not be saved" (`AppClose_SaveFailed_Title`), content "The meeting was not saved. Its audio file stays in your meetings folder. Keep the app open to see the error on the Record page." (`AppClose_SaveFailed_Content`), primary "Close anyway", close "Keep open" (default Close).
- A second close request while one is deciding is refused. Any exception means "stay open".
- The main window is restored (un-minimized) before the dialogs.

### 2.17 Capture failures and warnings (while recording)

Hard failures end the take and process it as a normal stop (the audio captured so far is kept):

- Output capture failed (process-tree capture died with an error, not on user stop): `Error_OutputCaptureFailed` "Recording stopped because the meeting audio failed: {0}".
- Capture faulted (the WAV pump died, e.g. disk full): `Error_CaptureFaulted` "Recording stopped because of an audio error: {0}. The audio captured so far was kept."
- Only the first failure per take is handled (`captureFailureNotified` exchange 0->1 on the UI thread); it sets `captureFailureMessage` and the status, then stops the recording if it is still recording. These messages are prefixed to later statuses of that take's run.

Soft warnings (recording continues; shown as the status while `IsRecording`):

- Mic lost and other sources remain: `Warning_MicrophoneLost` "The microphone stopped working, so your voice isn't being recorded. Recording continues with the meeting audio."
- Output lost (system loopback) and others remain: `Warning_OutputAudioLost` "The meeting audio stopped working, so the other side isn't being recorded. Recording continues with the microphone."
- No sources remain: `Warning_NoAudioSourcesLeft` "Nothing is being captured because no audio source is left. Stop the recording to keep what was saved so far." This outranks the other two: once set, later warnings are ignored. The warning key persists for the take (cleared at next Start) and is what `RecordingStatusText` returns on resume from pause.

### 2.18 Error display

- Idle: an Error InfoBar titled "Something went wrong" (`RecordPage_StatusErrorTitle.Title`), non-closable, shown when `IsStatusError`, message = status text. When not an error the status text is shown as muted centered caption (max width 420, polite live region) under the Record hero, hidden if empty.
- During a session: a second copy of the same bar is shown when `IsStatusError && IsSessionActive`.
- Error severity decision: `statusText starts with ErrorPrefix` else Informational.

---

## 3. Domain rules

### 3.1 Session gate (`RecordingSessionGate`)

Phases: `Idle`, `Preparing`, `Recording`, `Stopping`, `Processing`. Transitions return `true` and change phase only from the exact expected phase; otherwise return `false` and change nothing. Not thread-safe (UI thread only).

| Method | From | To |
|---|---|---|
| `TryBeginPreparing` | Idle | Preparing |
| `CancelPreparing` | Preparing | Idle |
| `MarkRecording` | Preparing | Recording |
| `TryBeginStopping` | Recording | Stopping |
| `MarkProcessing` | Stopping or Preparing | Processing |
| `MarkIdle` | Processing or Stopping | Idle |

Derived: `CanToggle = Idle or Recording`; `CanImport = Idle`; `CanControlCapture = Recording` (pause, discard, highlight-ish); `RequiresCloseConfirmation = Recording`.

Consequence: `MarkIdle` while Recording is refused so a late callback cannot end the next take; `CancelPreparing` after `MarkRecording` is a no-op; stopping twice is refused; Stop/Discard/Pause/Import/Toggle during Stopping are all disabled.

Command enablement is re-notified at: start/stop/discard/import transitions, `IsRecording` and `IsProcessing` changes.

### 3.2 Readiness (`RecordingReadinessEvaluator.Evaluate`)

Inputs: `liveTranscriptionEnabled`, `engineReady`, `summaryProviderChosen`, `localSummarySelected`, `localModelDownloaded`, `cliOnPath`. Output:

```
liveRequired = liveTranscriptionEnabled
summaryReady = summaryProviderChosen && (localSummarySelected ? localModelDownloaded : cliOnPath)
canRecord    = engineReady && summaryReady
liveReady    = engineReady ; engineReady = engineReady
```
Live streaming uses the same engine as the offline pass, so live readiness equals engine readiness and live being off does not remove the engine requirement.

Facts gathered by `RecordingSetupResolver.EvaluateAsync`:
- `provider`: parse `settings.selectedSummaryProvider` (case-sensitive enum name `Local|ClaudeCode|Codex|Xai`; null if blank or unparsable).
- `localDownloaded`: provider is Local AND `selectedSummaryModelId` is non-blank AND it matches a catalog summary model by file name AND that model file exists on disk.
- `cliOnPath`: ClaudeCode/Codex -> the CLI executable resolves on PATH (does not check sign-in); Xai -> credentials exist (OAuth or API key); anything else false.
- `engineReady`: the Nemotron model file is downloaded AND (the CUDA runtime OR the CPU runtime is ready).

### 3.3 Capture sources (`RecordingCaptureSources`)

Fields: `captureMicrophone: bool`, `microphoneDeviceId: string|null`, `output: SystemLoopback(0) | ProcessTree(1)`, `processId: uint`.

- `captureMicrophone = false` means open no microphone. A null or empty device id with capture on means the OS default input device. These are different things.
- Validation (`ThrowIfInvalid`, runs in the constructor and again at Start, before any device opens): undefined output kind -> argument error; ProcessTree with pid 0 -> out-of-range error "Process id 0 is not a valid capture target."; SystemLoopback with pid != 0 -> argument error "System loopback cannot also target a process."
- Output is exactly one of system loopback or one process tree; process scope must never also open system loopback and must never silently fall back to it.
- Selecting an app card means `ProcessTree(captureMicrophone, deviceId, rootPid)`; the system card means `SystemLoopback(captureMicrophone, deviceId)`.
- At Record time `ResolveRecordingTarget()`: if the selected card is an app, check `ActiveAppEntries.IsStillRunning(app)`: the process must exist; if both exe paths are known they must be equal ignoring case (rejects a recycled pid); an unreadable path on either side trusts the live process. Still running -> close the fallback bar, return its pid. Not running -> set the fallback message `RecordPage_SourceFallbackMessage` with the card name, open the fallback bar, switch the selection to the system card, return null (system loopback).

### 3.4 Meeting-audio enumeration and cards

**Polling** (`RecordingAudioSourcesViewModel`): runs only while the page is visible and idle (not recording, not processing); `Start()` is idempotent; `Stop()` cancels the loop, bumps the generation (results of a stale loop are discarded) and zeroes every card level. One background loop owns the session source (not thread-safe). Peak tick every 150 ms; every 10th tick (1.5 s) does a full re-enumeration; the first enumeration runs immediately. On `Start`, `restorePending = !userTouched`. Errors in the loop end polling silently.

**Enumeration** (`ActiveAudioAppService.Refresh`) over the audio sessions of the default render endpoint (re-resolved each call; default endpoint can change):
1. Skip sessions that are system sounds or have pid 0.
2. A session is active if its state is Active or its peak > `0.001`. Skip inactive sessions.
3. Resolve process details; skip if unresolvable.
4. Root = walk parents while the parent runs the same exe image path (case-insensitive), stopping at: no exe path, parent pid 0, parent already seen (cycle), parent unresolvable, different image, or parent started after the child (recycled pid); at most 32 steps.
5. Exclude if the process or its root is the host app's own pid, or its executable name (without extension, case-insensitive) is one of: `ApplicationFrameHost, TextInputHost, SystemSettings, explorer, ShellExperienceHost, StartMenuExperienceHost, SearchHost, LockApp, dwm, audiodg`.
6. Group by root pid; peak per root = max of its sessions' peaks.
7. Result per root: `ProcessId` (root), `ExePath` (null if unreadable), `FriendlyName` = trimmed file description of the exe, else trimmed product name, else the process name; `IsBrowser` = exe name in `{chrome, msedge, firefox, brave, opera, vivaldi, arc}`; `IsKnownMeetingApp` = exe name in `{zoom, teams, ms-teams, webex, webexmta, slack, discord, skype, cpthost}` (browsers are intentionally not listed); `Peak`.
8. Ordered by friendly name (case-insensitive, current culture) then pid.
9. `ReadPeaks()` reads current peaks per session using sessions cached by the last refresh, mapped to roots through the map from the last refresh, max per root; empty before the first refresh.

Meter value for a card: `AudioLevelMeter.ToMeterValue(peak) * 100`.

**Merge** (`ActiveAppEntries.Merge(active, selected)`): all active apps are available entries. If an app is selected and not in the active list (matched by pid) it is inserted as unavailable before the first entry whose friendly name sorts after it (case-insensitive, current culture), else appended. `card.Update(entry)`: available -> store the latest app data and set level from its peak; unavailable -> level 0 and keep the old app data.

**Suggestion** (`MeetingAppSuggestion.Pick(active, systemAudioSelected, dismissed)`): null unless system audio is selected; among apps with `IsKnownMeetingApp` and not dismissed, highest `Peak` wins, ties by friendly name (case-insensitive). The suggestion title/action are recomputed only when the suggested pid changes.

**Remembered app restore** (once per `Start()` unless the user touched a card): after the first enumeration, load settings; if the user has not touched and a non-system card is not already selected, `RecordAudioSourceMemory.RestoreApp(settings, lastApps)` returns the playing app whose exe path equals the remembered `recordAppExePath` (ignoring case) only if `recordOutputKind == "App"` (ignoring case) and the path is non-blank; the card with that app's pid becomes selected (programmatic, not persisted). Not playing -> stay on all system audio with no message. Errors -> stay.

**Memory writes**: `RememberSystemAudio`: `recordOutputKind = "System"`, `recordAppExePath = null`, `recordAppName = null`. `RememberApp`: `recordOutputKind = "App"`, `recordAppExePath = exe`, `recordAppName = name`. `RememberMicrophone(kind, id)`: `recordMicrophoneKind = kind name`, `recordMicrophoneDeviceId = id if kind==Device else null`. Callers always load the whole settings file, mutate and save it (the file is rewritten wholesale).

**Microphone restore** (`RestoreMicrophone(settings, availableIds)`): if `recordMicrophoneKind` parses (ignore case) to a defined kind: `None` -> None; `Device` -> that device if its id is non-empty and among the available ids (ordinal) else SystemDefault; `SystemDefault` -> SystemDefault. If not parseable or unset: the Settings microphone `selectedMicrophoneDeviceId` if available else SystemDefault. A missing device never maps to None.

### 3.5 Level meters

- `AudioLevelMeter.ToMeterValue(a)`: NaN -> 0; `db = 20*log10(max(a, 1e-6))`; return `clamp((db + 60) / 60, 0, 1)`. Floor -60 dBFS maps to 0, 0 dBFS to 1, -30 dBFS to 0.5, typical speech at 0.05 RMS (about -26 dBFS) lands around 0.56. Negative input is silence (clamped by max with 1e-6).
- Idle mic preview (Record page): `MicrophoneLevelMeterService` opens the chosen device (default if null; a vanished id falls back to default) for capture without writing anything; per data buffer computes RMS over the samples (supports 32-bit float, 16-bit PCM, 32-bit PCM; other formats give 0; non-finite floats skipped), clamped 0..1, raised as level; the page shows `ToMeterValue(rms) * 100`. Failures to open are swallowed (best effort). A capture that stops by itself (device removed) emits level 0 and is disposed. `Stop()` is idempotent. Preview is started only when the page is visible, not recording, not processing, and a mic is selected; it is stopped on navigate-away (unless recording), when selecting None, and when Start begins. `StopMicPreview` also sets `MicLevel = 0`.
- While recording: the level comes from the same mixed 16 kHz mono stream written to the WAV: RMS of the float samples of each frame, `ToMeterValue(rms) * 100` (mic AND output mixed, see B-13). Empty frames are ignored.
- Settings page meter (`MicrophoneSectionViewModel`) uses `clamp(level * 100, 0, 100)` with no dB scaling (inconsistent with Record, B-14); it saves the microphone device id in `selectedMicrophoneDeviceId` (null for default). Its combo is rebuilt with a sentinel "System default" entry (empty id) first; a load must not commit a selection (suppress flag released on the next dispatcher turn after load; `isLoading` mirrors the page); selecting an option that equals the current one is ignored; otherwise select, restart the meter on the new device and save settings (load, mutate, save).
- `AudioBarsControl` (used only by the Live Copilot pill): 5 rounded bars (width 3, gap 3, radius 1.5, rest height 3, max height 24, panel height 24, vertically centered). Inputs `Level` (0..100), `IsPaused`, `IsRunning`. Target height for bar i: `3 + 21 * clamp(levelFraction * profile[i] * phase, 0, 1)` where `levelFraction = paused ? 0 : clamp(level/100, 0, 1)` (non-finite level -> 0), `profile = [0.55, 0.8, 1.0, 0.8, 0.55]`. While running with animations enabled a 33 ms timer eases each bar: `phase = 0.75 + 0.25*sin(phaseStep[i] + t*phaseSpeed[i])` with `phaseStep = [0, 1.3, 2.6, 3.9, 5.2]`, `phaseSpeed = [7, 9.5, 8, 10.5, 7.5]`, `t` seconds since start; `height += (target - height) * (target > height ? 0.55 : 0.14)`; heights rounded to 0.1. When not running, or OS animations are off, the bars snap to the target with `phase = 1.0` and no timer. The timer only runs while `IsRunning`, and stops on unload. Colors: primary text color.
- `AppIconCache.GetAsync(exePath)`: null/blank path -> null. Otherwise one cached task per path (case-insensitive key): read the exe's shell thumbnail at 32 px (`SingleItem`, current scale), null if it is empty or on any error (packaged apps, access denied); cards then show the glyph. The cache lives for the process. Cards load their icon asynchronously after creation and only assign when non-null.

### 3.6 Timers, status text, highlight times

- Elapsed text: `mm:ss` where `mm = floor(totalMinutes)` zero-padded to at least 2 digits (can exceed 59, e.g. `125:30`), `ss` zero-padded. Timer ticks every 1 s from a stopwatch started when `IsRecording` becomes true; text resets to `00:00` on start and stop. Pause stops both stopwatch and timer; resume restarts them.
- `RecordingStatusText` (set at start and on resume): if a capture warning key is set return that warning; else with `noMic = selection kind None`: an app selected -> noMic ? `Status_RecordingNoMicApp` "Recording... {0} only." : `Status_RecordingMicApp` "Recording... mic + {0}." (`{0}` = app name); system audio -> noMic ? `Status_RecordingNoMic` "Recording... system audio only." : `Status_Recording` "Recording... mic + system audio."
- Highlight timestamp = stopwatch elapsed (excludes pauses, which matches WAV time because the WAV has no paused audio).
- `IsCaptureActive` on the workspace = `IsRecording || IsProcessing` and is updated on every change of either.

### 3.7 Processing pipeline (`RecordingPipelineOrchestrator.RunAsync`) in order

Request (`RecordingPipelineRequest`): `meetingId`, `audioPath`, `recordedAt`, `endedAt` (default = unknown), `title`, `liveDraft?`, `pausedDuration`, `folderId?`, `highlights[]` (snapshot, elapsed times), and optional `calendarEventId`, `calendarId`, `seriesId`, `joinUrl`, `attendees[]`, `brief`, `agenda`, `noteTemplateId`, `templateInstructions`. The request is built before the first await at Stop so nothing the user does next can leak into the take. The folder id is resolved after that (a failing folder store lands the take in Inbox).

Variables: `transcript = EnsureEndedHeader(liveDraft)` (null stays null). `meetingIsDurable = false`.

1. **First save, before anything that can fail.** Load the existing meeting by id. If `ShouldSaveBeforeTranscribing(transcript, existing.audioPath, audioPath)` (3.8): save a meeting record with `transcript = hasDraft ? transcript : existing.transcript`, `summary = hasDraft ? null : existing.summary`, `actionItems = hasDraft ? [] : existing.actionItems`, `summaryProvider = hasDraft ? null : existing.summaryProvider`. Then `meetingIsDurable = true`.
2. Load settings: `language = transcriptionLanguage ?? "es"`, `summaryLanguage = summaryLanguage ?? "es"`.
3. **Offline pass** if the engine is ready: status "Transcribing audio..."; call `transcribe(audioPath, language, progress(0-100 -> "Transcribing audio... {0}%"), token, recordedAt, pausedDuration (clock skew), speakerDiarizationEnabled)`. `OperationCanceledException` propagates; any other exception is captured as `transcriptionFailure`. Resolve the stage (3.8):
   - `OfflineTranscript`: `transcript = EnsureEndedHeader(wavTranscript)`; tell the host `OnTranscriptRefreshed(transcript)`.
   - `LiveDraftAfterFailure`: keep the draft; `transcriptionWarning = "Saved with the live transcript. The final transcription failed: {0}"` (`Status_LiveDraftKeptTranscriptionFailed`, `{0}` = friendly failure).
   - `LiveDraft`: continue with the draft silently.
   - `FailedWithoutTranscript`: `OnSavedWithoutTranscript(meetingId, "Error: The meeting keeps its audio, so you can retranscribe it. Transcription failed: {0}")` (`Error_TranscriptionFailedAudioKept`) and stop.
   - `NoTranscript`: `OnSavedWithoutTranscript(meetingId, "Error: No transcript was produced. The meeting keeps its audio, so you can retranscribe it.")` (`Error_NoTranscript`) and stop.
   If the engine is NOT ready: if there is no usable draft `OnSavedWithoutTranscript(meetingId, "Download finished but the transcription engine is still not ready.")` (`Error_EngineNotReady`) and stop; with a draft, continue with the draft.
4. Throw if cancelled. **Save the transcript** (no summary): `summary = null`, no action items, no provider.
5. **Resolve the summary provider** (`ResolveSummaryProviderAsync`): load settings; if `selectedSummaryProvider` is blank -> none. Else `SummaryProviderResolver.ResolveAsync(kind, ensureModel, ensureCli, ensureXai)` where `kind = ResolveSummaryProviderKind()` (unparsable -> Local): Local -> ask the model resolver for the GGUF path (null = skip); Xai -> the xAI gate; ClaudeCode/Codex -> the CLI gate. The resolver returns null when a gate is not satisfied (this is a safety net: first-time chooser lives in pre-record setup, it must not prompt after the WAV exists). If null: `OnTitleResetAndFinished(transcriptionWarning ?? "Done. Transcript available (no summary).")` (`Status_DoneNoSummary`) and stop.
6. `OnTitleResetAndFinished("Generating summary...")` (`Status_GeneratingSummary`): releases the foreground session; the rest runs in the background.
7. `enhancement = SummaryEnhancementContext(rawNotes = host.CurrentSessionNotes, attendees, agenda, templateInstructions)`; pass it only if any member is non-blank. Call `provider.Summarize(transcript, title, recordedAt, token, summaryLanguage, endedAt==default ? null : endedAt, enhancement?)`. Result: `summaryMarkdown`, `actionItems[]`, `providerId`, `suggestedTitle`.
8. `saveTitle = SuggestedMeetingTitle.Resolve(title, suggestedTitle)` (3.10). Save the record with summary, action items, provider id. If the title changed notify the workspace that the meeting changed.
9. Run Jev (`MeetingJevRunner.TryAnalyzeAndSave`): silent post-summary analysis, requires TypeSafe enabled and a stored key and a non-blank transcript; may drop contradicted action items and file the meeting into a suggested folder; saves again; every failure is swallowed except cancellation (also swallowed here: "Summary is already saved").
10. `OnMeetingCompleted(meetingId, transcriptionWarning ?? "Done. Transcript and summary available.")` (`Status_DoneWithSummary`).

**Exception handling** (outer):
- `OperationCanceledException`: `transcript = transcript if non-blank else EnsureEndedHeader(liveDraft)`. If still blank: `ReportNoTranscript(..., "Cancelled." (Status_ProcessingCancelled))` -> if the meeting is durable `OnSavedWithoutTranscript` else `OnFinished`. Else try to save the transcript without summary; on success `OnTitleResetAndFinished("Cancelled. Transcript saved (no summary).")`.
- Any other exception: `friendly = CliFailureUserMessage.Format(ex)` (a CLI tool exception maps by kind to: `Error_CliNotInstalled`, `Error_CliNotSignedIn`, `Error_CliSubscriptionInactive`, `Error_CliTimedOut`, `Error_CliEmptyOutput`, `Error_CliUnknown` with the provider display name, plus the detail when Unknown and non-blank; non-CLI exceptions use `ex.Message`). No transcript: `ReportNoTranscript(..., "Error processing the recording: {0}")` (`Error_ProcessRecording`). Else try to save the transcript without summary; on success `OnSummaryFailedAfterTranscriptSaved(meetingId, "Transcript saved. Summary failed: {0}")` (`Status_TranscriptSavedSummaryFailed`).
- `TrySaveTranscriptAfterFailure` catches its own failure (the store may be the cause) and reports `OnFinished("Error processing the recording: {0}")` so the host never stays in Processing.
- The host also wraps `RunAsync`: an escaping exception becomes `OnFinished("Error processing the recording: {0}")`, and a `finally` queues `run.Complete`.

**Record built by every save** (`SaveProcessedMeetingAsync`):
```
transcript   = EnsureEndedHeader(transcript, recordedAt, endedAt)
Id           = meetingId            Title = title
RecordedAt   = recordedAt           EndedAt = endedAt == default ? null : endedAt
AudioFilePath= audioPath            FolderId = folderId
Transcript   = blank ? null : TranscriptHighlightApplicator.Apply(transcript, request.highlights)
Summary, ActionItems, SummaryProvider = as passed
Notes        = host.CurrentSessionNotes blank ? null : trimmed
CalendarEventId, CalendarId, SeriesId, JoinUrl = request value, blank -> null, else trimmed
Attendees    = request attendees, non-blank, trimmed, or []
Brief        = request.brief blank->null else trimmed, else existing.Brief
NoteTemplateId = request value blank->null else trimmed
FollowUp, ProjectPlan = copied from the existing record
(JevAnalysis is NOT copied; see B-6)
```
After the save the host is told `OnMeetingSaved(record)` (the repository may have rewritten `AudioFilePath`, `SourcePath`).

### 3.8 Pipeline decision rules (`RecordingPipelineRules`)

`ShouldSaveBeforeTranscribing(liveDraft, existingAudioPath, audioPath)`: true if `liveDraft` is non-blank; else true unless `existingAudioPath` equals `audioPath` (ordinal, ignore case). So: a new take always saves first (a failed offline pass cannot orphan its audio); a re-run over audio the meeting already points at saves nothing first and leaves the previous transcript untouched until the new one succeeds.

`ResolveTranscriptionStage(liveDraft, offlineTranscript, offlinePassFailed)`:
1. offline transcript non-blank -> `OfflineTranscript`.
2. else live draft non-blank -> `offlinePassFailed ? LiveDraftAfterFailure : LiveDraft`.
3. else `offlinePassFailed ? FailedWithoutTranscript : NoTranscript`.

### 3.9 Run ownership and host callbacks (`PipelineRun`)

A run is one take's view of the page. The page keeps `runs[]`, `activeRun` (holds the foreground Processing session), `latestRun` (whose saved meeting the page shows). `ownsSession = (page.activeRun === this)`. State per run: its own cancellation, a `firstSave` future (true on first `OnMeetingSaved`, false when the run completes without one), a `completion` future, the capture-failure message at stop time, and a notes snapshot (the box content at stop).

| Callback | Effect |
|---|---|
| `CurrentSessionNotes` | owns ? page notes box : snapshot |
| `OnStatusChanged(s)` | if owns: `StatusText = withCaptureFailure(s)` |
| `OnTranscriptRefreshed(t)` | if owns: `LiveTranscriptText = t` |
| `OnMeetingSaved(r)` | resolve `firstSave = true`; if this is the latest run: `Workspace.SetLastProcessed(r)` (also selects the meeting) and `LastMeeting = r`; else `Workspace.NotifyMeetingChanged(r.Id)` |
| `OnFinished(s)` | `endOrReport(s, reset=false)` |
| `OnTitleResetAndFinished(s)` | `endOrReport(s, reset=true)` |
| `OnMeetingCompleted(id, s)` | if the gate is Idle and `LastMeeting.Id == id`: `StatusText = withCaptureFailure(s)` |
| `OnSummaryFailedAfterTranscriptSaved(id, m)` | `endOrReport(m, reset=true)` |
| `OnSavedWithoutTranscript(id, s)` | `endOrReport(s, reset=true)` |

`endOrReport(s, reset)`: `shown = withCaptureFailure(s)`; `released = releaseSession(shown, reset)`; if not released and the page is idle on this meeting, `StatusText = shown`.

`releaseSession(status, reset)`: no-op returning false unless the run owns the session. Otherwise: `snapshot = page notes`; `page.activeRun = null`; if `reset`: `MeetingTitle = new placeholder title`, `ClearCalendarLink()`; then `FinishProcessing(status)` = `StatusText = status; gate.MarkIdle(); IsProcessing = false; notify commands; restart idle mic preview`. Returns true. A run that already released can never reset a newer take.

`Complete()` (queued on the dispatcher behind all callbacks): `releaseSession(StatusText, reset=false)`, remove the run, resolve `firstSave` false if unresolved, dispose the cancellation, resolve `completion`.

`withCaptureFailure(s) = failure == null ? s : failure + " " + s`.

`IsMeetingInUse(id)`: true if any run has that meeting id, or `id == currentMeetingId && gate.Phase != Idle` (used by History to refuse deleting a meeting that is being recorded or that a run may re-save).

`SaveAndFinishForCloseAsync`: await the stop, await `firstSave` of every current run, cancel every run, then wait for all completions or 30 s, whichever first. Result = all `firstSave` values true.

### 3.10 Meeting title rules

- Placeholder detection: `LooksLikePlaceholder(title)` = blank, or matches regex `^Meeting\s+\d` (case-insensitive, invariant). (English only; see B-1.)
- `Resolve(current, suggested)`: `normalized = Normalize(suggested)`; if null keep `current`; if `current` looks like a placeholder use `normalized`; else keep `current`. So a user-named or calendar-named meeting is never renamed by the model.
- `Normalize(raw)`: null if blank. Take the first non-blank line (after normalizing CRLF), trim; strip leading `#` characters then trim; strip one pair of wrapping quotes (`"..."` or typographic `“...”`) then trim; strip trailing `.` characters then trim; truncate to 80 characters then trim; return null if empty.
- `FromModelResponse(raw)` (explicit regenerate path, not used by the pipeline): if a line equals `## Title` (trimmed), join the following non-blank trimmed lines with a space until the next line starting `## ` and normalize (null if none); else `Normalize(raw)`.
- After a save with a changed title the repository renames the Markdown and WAV stem accordingly (3.14).

### 3.11 Transcript stamp and highlight algorithms

Transcript text format:
```
Recorded 2026-11-02 14:05
Ended 2026-11-02 14:47
[00:03.20-00:07.90] [ Speaker-1 ] Hello everyone.
[00:08.10-00:12.00] Thanks for joining.
```
- Header lines: `Recorded yyyy-MM-dd HH:mm` and `Ended yyyy-MM-dd HH:mm`, local time, invariant culture, minute precision.
- Line: `[start-end] text`, or `[start-end] [ Speaker-N ] text` when speaker tag N > 0. Elapsed `mm:ss.ff` where `mm` = total minutes (at least 2 digits), `ss` two digits, `ff` = milliseconds/10 (hundredths, truncated). Negative start clamps to 0; end < start clamps to start.
- Newline inside a transcript is whatever the producer used (`\r\n` on Windows for ASR output); functions preserve an existing `\r\n` else use `\n`.
- `EnsureEndedHeader(transcript, recordedAt, endedAt)`: returns the input unchanged if the transcript is null/empty or either timestamp is default. If the first line starts with `Recorded `: if the second line starts with `Ended ` replace it; else insert the `Ended` line after line 1 (the existing first line is kept as is). If the first line is not `Recorded `, prepend both `Recorded` and `Ended` lines. Idempotent.
- `TranscriptHighlightApplicator.Apply(transcript, highlights)`: marks = highlights with negatives clamped to 0, distinct, sorted ascending. No marks -> transcript (or empty string). Empty transcript -> one line per mark `* mm:ss.ff` joined by `\n`. Parse lines matching `^\[(\d+):(\d{2}\.\d{2})-(\d+):(\d{2}\.\d{2})\]` (ignoring an existing `* ` prefix). If no line is timestamped, append the mark lines after all lines. Else each mark selects: the first timestamped line whose `[start, end]` contains the mark (inclusive); otherwise the last timestamped line starting at or before the mark (or the first timestamped line if the mark precedes all). Each selected line gets the prefix `* ` unless it already starts with it; a line selected by two marks is starred once.
- `CommittedTranscriptLine`: a line stamp is `[` ... `]` at the line start containing `mm:ss.ff-mm:ss.ff` (minutes at least 2 digits, seconds 00-59, exactly 2 fractional digits); headers are lines (after left-trim) starting `Recorded ` or `Ended `; the speaker tag ` [ Speaker-<digits> ] ` is stripped when extracting the body.

### 3.12 Live answer and question detection

**Question detection** (while recording, per live transcript update on the UI thread, using the committed-only text):
1. If the committed text equals the previous committed text (ordinal) only store it and stop. Otherwise remember it and start a judgment off the UI thread; a new update cancels the previous judgment (new generation, new cancellation source).
2. The judgment passes `baseline = questionJudgeBaseline` (the committed text already judged) and the current committed text. Skipped (baseline advanced to the current text) when `typeSafeEnabled` is false or no stored TypeSafe API key. Otherwise `LiveQuestionJevJudge.JudgeAsync(api, apiKey, previousCommitted, currentCommitted, token)` returns `{ body, needsWeb }` or null.
3. Apply on the UI thread only if the generation is current and still recording: baseline = judged text; ignore empty or dismissed (ordinal) bodies; else `ArmedQuestion = body`, `armedNeedsWeb = needsWeb`. If cancelled before applying, the baseline is not advanced so the next judgment covers the union.
4. Any failure is swallowed silently (no error text, never stops recording). Cancelled and failed judgments simply leave the previous state.
5. The judgment generation is bumped and cancelled when recording ends (`IsRecording` false), on Stop, on Discard, and on session reset.

**Ask** (`AskLiveAsync`), after the preconditions in 2.8:
- `armedNeedsWeb` is read at call time; `questionIsArmed = typed text empty`. If the confirm path was used with an armed question, the armed notice is cleared first and restored on provider-resolution failure only.
- `supportsWeb = provider is ClaudeCode or Codex`; `CanUseWebSearch` is updated from it. `jevNeedsWeb = supportsWeb && !forceWeb && (questionIsArmed ? armedNeedsWeb : judgeTypedQuestionNeedsWeb)`. The typed-question web judge runs off the UI thread, only if TypeSafe is enabled and a key exists, calls `JudgeNeedsWebAsync(api, key, question, committedText)`, and any failure means false. `useWeb = supportsWeb && (forceWeb || jevNeedsWeb)`.
- Resolve the provider with `webSearch = useWeb` (this uses a live-answer provider variant for CLI providers; summaries and chat never get web arguments).
- Context window: `LiveAnswerWindow.TakeRecent(committedText, 90 s)`: split committed text on CRLF/LF/CR; parse each line's end time; the latest end time is the anchor; keep timestamped lines whose end is within `[latest - window, latest]`; keep un-timestamped lines only if they sit between the first and last kept timestamped lines; drop header lines (`Recorded`/`Ended`); join with the transcript's newline; if there are no timestamped lines at all return the last 2500 characters (or the whole text if shorter); if no line is in range return empty.
- Session context: `BuildSessionContext(title, brief)`: trim both; both empty -> null; else `Meeting: {title}` and, if a brief exists, a newline and the brief; no title -> just the brief; cap at 1500 characters (trim end after cut).
- Prompt (verbatim template; `{language}` is `English` if the summary language code equals `en` ignoring case, else `Spanish`):

```
You are answering a question that was just asked in a live class or meeting.

Write a short answer in 2 to 5 sentences. Write the answer in {language}.

Use the transcript window as context for the topic and who asked.

If the transcript does not contain the factual answer, answer from knowledge. Do not refuse just because the meeting did not state the fact. Do not say that you only know what was said.

{contextBlock}{webLine}Question:
{question}

Transcript window:
{transcriptWindow}
```
  where `contextBlock` is empty when there is no session context, else:
```
Session context:
{sessionContext trimmed}

The session context is the topic, course, or meeting brief supplied by the user. Use it to interpret the question.
```
  (ending with a single newline, so `Question:` follows directly on the next line) and `webLine` is empty unless web search is on, else `You may use web search for current or external facts (competitors, prices, recent news) and keep the answer short.` followed by a blank line. Null `question`/`transcriptWindow` become empty.
- Streaming: `provider.StreamPrompt(prompt, token)` yields chunks; all chunks accumulate; nothing is published until a chunk with visible (non-whitespace) text has arrived; then publish `buffer.TrimStart()` on the first publish and at most once per 80 ms afterwards; the final text is the full buffer trimmed. Every publish marshals to the UI thread and is dropped if the generation changed. Final: if blank -> error "The answer came back empty."; else answer text, no error, `LiveAnswerUsedWeb = useWeb`, `IsAnswering = false`.
- Generation checks (after settings load, after the web judge, after provider resolution, and on every publish) guarantee a newer ask or Stop owns the UI state; `OperationCanceledException` is silent.
- `CancelLiveAnswer` bumps the generation, cancels the source, sets `IsAnswering = false`.
- Session reset at Start clears: armed question, needs-web flag, typed text, answer, error, used-web flag, dismissed set, committed text (previous and current), judge baseline. `ForceWebSearch` is NOT reset between takes.

### 3.13 Pre-meeting brief prompt (verbatim, with `{...}` slots)

```
# Identity

You write a pre-meeting brief the user can glance at before they walk in.
You only use the sources below. You do not search the web, mail, or people directories.

# Instructions

Respond with 2 or 3 Markdown bullets, and nothing else
(no preamble, no code fences, no headings, no closing commentary).

Cover only what the sources support:
- who is attending
- what was discussed last time
- what is still open

Rules:
- Use only the subject, attendees, agenda, and prior meetings below.
- Do not invent people, dates, companies, quotes, or open items.
- Do not invent email addresses. Do not emit a mailto link.
- If a prior meeting has no summary, notes, or action items, do not pretend it did.
- If you cannot ground at least one bullet, return NONE and nothing else.
- No filler.

# Sources

<subject>{subject trimmed}</subject>
<attendees>
{names joined by ", " or (none)}
</attendees>
<agenda>
{agenda trimmed or (none)}
</agenda>
<prior_meetings>
{up to 3 prior meetings joined by a blank line, or (none)}
</prior_meetings>
```
Each prior meeting: `<meeting title="{title}">` / `<summary>` summary or `(none)` `</summary>` / `<notes>` notes or `(none)` `</notes>` / `<action_items>` item texts joined by `; ` or `(none)` `</action_items>` / `</meeting>`. Useful-context rule: at least one prior meeting, or a non-blank agenda, or at least one non-blank attendee. Reply normalization: blank or `NONE` (ignore case) -> hidden.

### 3.14 Library layout and file naming

- Root = user data directory (`Documents/MeetingLive`). Inbox directory = `<root>/Inbox` (reserved name).
- `DirectoryFor(root, folders, folderId)`: null -> Inbox; else walk parents (max 64 steps, break on unknown id), sanitize each name, reverse, join under root; no segments -> Inbox.
- `FileStem(recordedAt, title)` = `yyyy-MM-dd ` + `SanitizeName(title)`; the date uses the offset's own year/month/day (no conversion).
- `SanitizeName`: blank -> `Meeting`; replace each invalid filename character with a space, collapse runs of spaces, trim, trim trailing `.`; truncate to 80 characters, trim, trim trailing `.`; empty -> `Meeting`; case-insensitive `Inbox` -> `Inbox folder`.
- `AllocateFileStem(directory, desiredStem, meetingId, idFromMarkdownPath)`: ensure the directory exists; for n = 1,2,...: stem = n==1 ? desired : `desired n`; accept if the Markdown at that stem belongs to this meeting id, or neither the Markdown nor the WAV exists. At Start/Import the callback always returns null (ids are not looked up), so an existing Markdown at the desired stem always forces the next number (B-9).
- `MarkdownPath = <dir>/<stem>.md`; `AudioPath = <dir>/<stem>.wav`. Markdown and WAV share the stem and move together.
- Saving a meeting (`MarkdownMeetingRepository.SaveAsync`): resolve directory from the record's folder id; allocate the stem with the real id lookup; if the existing audio path (the record's audio path, or the sibling of the existing Markdown if blank) differs from the target, move it (replacing a file already at the target) and set the record's audio path; write the Markdown; delete the old Markdown if its path changed. Delete removes the WAV first (so a locked WAV leaves the meeting listed and retryable) and the Markdown last.

### 3.15 Constants

| Constant | Value |
|---|---|
| Capture mix format | 16000 Hz, mono, written as PCM 16-bit |
| Pump chunk | `averageBytesPerSecond / 5` = 6400 bytes = 200 ms |
| Per-source buffer | 5 s, discards on overflow |
| WAV header flush | every 5 s of written audio (160000 bytes) |
| Pause drain sleep | 50 ms per loop |
| Process loopback capture format | 48000 Hz, stereo, 16-bit; activation timeout 10 s |
| App-audio poll | peak tick 150 ms; refresh every 10th tick (1.5 s) |
| Active audio threshold | peak > 0.001 |
| Parent walk depth | 32 |
| Meter floor | -60 dBFS |
| Elapsed tick | 1 s |
| Copy confirmation | 2.5 s |
| Highlight feedback | 2 s |
| Live answer flush | 80 ms |
| Live answer window | 90 s; untimestamped fallback 2500 chars |
| Session context cap | 1500 chars |
| Title max length | 80 chars |
| Brief prior meetings | 3 |
| Calendar end grace / lookahead / lookback | 5 min / 14 days / 1 day |
| Close grace | 30 s |
| Pill start hint | 2500 ms |
| Wide layout breakpoint / side panel width | 1100 / 320 |
| Jump-to-latest threshold | 32 px |
| Pulse halo | opacity 0.15-0.45, 1.2 s, auto-reverse |
| Import extensions | `.wav .mp3 .m4a .aac .flac .wma .3gp .mp4` |

---

## 4. Persistence and wire formats

### 4.1 Files

- Settings: `%LOCALAPPDATA%/MeetingLive/settings.json`, JSON, web defaults (camelCase property names), indented, whole file rewritten on save. Always load -> mutate -> save; never save a fresh object.
- Meetings: `<Documents>/MeetingLive/<folder path>/<yyyy-MM-dd Title>.md` plus `.wav`. Folder tree metadata: `<Documents>/MeetingLive/folders.json`. Recording audio never goes to `%LOCALAPPDATA%`.
- Legacy `Meetings/` and `Recordings/` flat dumps under the user data directory are read for compatibility; new data never goes there.
- Development uses an isolated data folder; the on-disk format must stay compatible.

### 4.2 Settings fields used by this module

```json
{
  "selectedSummaryProvider": "Local",
  "selectedSummaryModelId": "<gguf file name>",
  "transcriptionLanguage": "es",
  "summaryLanguage": "es",
  "selectedMicrophoneDeviceId": null,
  "recordMicrophoneKind": "Device",
  "recordMicrophoneDeviceId": "{0.0.1.00000000}.{guid}",
  "recordOutputKind": "App",
  "recordAppExePath": "C:\\Program Files\\Zoom\\bin\\Zoom.exe",
  "recordAppName": "Zoom Workplace",
  "liveTranscriptionEnabled": true,
  "speakerDiarizationEnabled": false,
  "typeSafeEnabled": true,
  "disabledCalendarIds": []
}
```
Defaults: `liveTranscriptionEnabled = true`, `speakerDiarizationEnabled = false`, `typeSafeEnabled = true`, languages default to `es` when blank. `recordMicrophoneKind` is one of `None`, `SystemDefault`, `Device`; `recordOutputKind` is `System` or `App`; `selectedSummaryProvider` is one of `Local`, `ClaudeCode`, `Codex`, `Xai`. Unknown values read as unset.

### 4.3 Meeting Markdown

Written by `MeetingMarkdownFormatter.Render` (LF newlines; each section omitted when empty; each section body trimmed):

```
---
id: 3f1c2a9e-5b0e-4d52-8d3c-2d7d4b9f6a11
title: Weekly sync
recordedAt: 2026-11-02T14:05:11.1234567-05:00
endedAt: 2026-11-02T14:47:03.5000000-05:00
audioFilePath: C:\Users\me\Documents\MeetingLive\Inbox\2026-11-02 Weekly sync.wav
folderId: 8c1b4d7a-0a1f-4a52-9b3a-6f0d2e1c7a90
summaryProvider: local
calendarEventId: AAMk...
calendarId: ...
seriesId: ...
joinUrl: https://zoom.us/j/123
noteTemplateId: ...
attendees: Ana Ruiz | Luis Paz
---

## Brief

- Ana and Luis attend.

## Transcript

Recorded 2026-11-02 14:05
Ended 2026-11-02 14:47
* [00:03.20-00:07.90] [ Speaker-1 ] Hello everyone.

## Summary

...markdown from the model...

## Action Items

- [ ] Send the deck
- [x] Book the room

## Jev

{ ...json... }

## Personal Notes

my own notes

## Follow-up

## Project plan
```
Rules: frontmatter keys in that order; `endedAt`, `folderId`, `summaryProvider`, optional keys omitted when null/blank; dates in round-trip `O` format; frontmatter values have CR and LF replaced with a space; `attendees` joined by ` | `; the parser splits each frontmatter line on the first `:` only and trims. Section order: Brief, Transcript, Summary, Action Items, Jev, Personal Notes, Follow-up, Project plan. A section ends at the next line that exactly equals one of the eight headers. If any text body contains a line equal to a header, the file gets `headerEscaping: 1` and those lines are written with a trailing ` ##` (lines that already look escaped get one more); parsing without the key reads literally. On parse, a blank/missing `audioFilePath` or one that does not exist falls back to the sibling `.wav`. Action items are lines `- [ ] text` / `- [x] text` (regex `^\s*-\s\[( |x|X)\]\s+(.*)$`). `ExtractSection` returns null for empty bodies.

### 4.4 WAV

PCM, 16-bit, 16000 Hz, mono, little-endian, standard RIFF/WAVE with `fmt ` then `data`. Header sizes are rewritten every 5 s of audio and at close so an abrupt exit leaves a readable file. If the final flush/close fails, `WavHeaderRepair` rewrites the RIFF and data sizes from the real file length (only those two uint32 fields; PCM and IEEE-float layouts; never truncates audio; never touches a consistent file; outcomes Valid, Repaired, NotWav, Unsupported, Failed). Frames for live ASR are the same stream as float32 = `int16 / 32768`.

### 4.5 In-memory protocol between capture and the page

- `PcmFrame { samples: float32[] (mono, 16 kHz, [-1,1]), sampleRate }`, only produced when there are subscribers and only while not paused.
- `CaptureSourceLost { source: Microphone|Output, remainingSources: int, error }`; `remainingSources` counts sources still alive (starts at 2 with a mic, 1 without; decremented atomically per loss, floor 0).
- `OutputCaptureFailed(error)`: process-tree output died with an error not caused by a user stop. `CaptureFaulted(error)`: the WAV pump died. After a fault `stop()` closes the file so the audio written stays readable, then rethrows the error.
- Live transcript update: `{ displayText (committed lines + interim suffix), committedText (finals only) }`; committed lines include the `Recorded ...` header once the first committed text exists.

---

## 5. Native and OS dependencies

| Capability | Today (Windows) | Class | Port note |
|---|---|---|---|
| Microphone capture | WASAPI via NAudio `WasapiCapture`, device by MMDevice id, default endpoint role Console, fallback to default when the id is gone or inactive | Windows-only impl | Native module behind `IMicrophoneSource`; macOS: CoreAudio/AVAudioEngine. |
| System loopback | `WasapiLoopbackCapture` on the default render endpoint; delivers no packets while silent, so the mixer pads silence | Windows-only impl | Interface `IOutputSource`. macOS: ScreenCaptureKit audio or a CoreAudio tap (14.2+). |
| Per-app (process-tree) capture | `ProcessLoopbackCapture` via `ActivateAudioInterfaceAsync` with `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` + include-process-tree; 48 kHz stereo 16-bit; needs Windows 10 build 20348+ / Windows 11; failure to activate throws and never falls back to system loopback | Windows-only | Same `IOutputSource` with a target pid. macOS: CoreAudio process taps (14.4+). Chromium's loopback capture is system-wide only, so a native addon (Rust or C++) is required. |
| Mixing, downmix, resampling to 16 kHz mono | NAudio `MixingSampleProvider`, `WdlResamplingSampleProvider` | Portable logic | Reimplement in the native layer or in Node (all inputs must be same rate and channel count; downmix any channel count, B-5). |
| WAV writer with periodic header flush and repair | NAudio `WaveFileWriter`, `WavHeaderRepair` | Portable | Plain file I/O. |
| Audio session enumeration with peaks | NAudio `AudioSessionManager` on the default render endpoint (`GetProcessID`, state, `MasterPeakValue`) | Windows-only | `IAudioSessionSource` (Enumerate, ReadPeaks). The grouping logic (`ActiveAudioAppService`) is portable. macOS has no per-app peak API; the list of "apps playing audio" needs a different source or reduced behavior. |
| Process info | `WindowsProcessInfoProvider` (pid, parent pid, exe path, name, start time; file version info description/product name) | Windows-only impl | `IProcessInfoProvider`; the root-walk logic is portable. |
| Shell icon | WinRT `StorageFile` thumbnail 32 px | Windows-only | Electron `app.getFileIcon(path, { size: "normal" })` (32x32 on Windows). |
| Device enumeration | NAudio `MMDeviceEnumerator` active capture endpoints | Windows-only | `IMicrophoneCatalog`. |
| Idle mic level meter | `MicrophoneLevelMeterService` over WASAPI | Windows-only impl | Reuse the mic source with a metering sink. |
| File picker | WinRT `FileOpenPicker` (Downloads) | Windows UI | Electron `dialog.showOpenDialog`. |
| Clipboard | WinRT `DataPackage` | Windows UI | Electron `clipboard.writeText`. |
| Open join URL | `Launcher.LaunchUriAsync` (http/https only) | Windows UI | `shell.openExternal` after the same scheme check. |
| Import conversion (any format -> 16 kHz mono PCM16 WAV) | NAudio `AudioFileReader` (Media Foundation) | Windows-only impl | ffmpeg or a native decoder; same output contract. |
| Animations setting | `UISettings.AnimationsEnabled` | Windows UI | `prefers-reduced-motion`. |
| Offline/live ASR (Nemotron, NeMo-Speech.cpp, CUDA/CPU runtimes) | native runtimes | Other modules | Interfaces `ITranscriptionService`, `ILiveTranscriptionService`, readiness `IsReady`. |
| Summary providers, TypeSafe Jev, CLI tools, xAI auth | other modules | Other modules | Interfaces named in 3.7 and 3.12. |
| Calendar store | WinRT appointment store | Windows-only | Other module. |
| Window handoff (minimize, floating pill) | WinUI window APIs | Windows UI | BrowserWindow minimize and always-on-top window. |
| Close interception | `AppWindow.Closing` | Windows UI | `before-quit` / window `close` with async confirmation. |

---

## 6. Existing test coverage (`MeetingLive.Core.Tests/Services`)

There are no tests for `RecordingPageViewModel`, `RecordingPipelineOrchestrator`, `RecordingSetupResolver`, `AudioSourceCard`, `RecordingAudioSourcesViewModel`, `MicrophoneSectionViewModel`, `AppIconCache` or `AudioBarsControl` (all App-project code). The port should add tests for them (the orchestrator and the view-state logic are the priority). Existing cases that must carry over as tests of the ported logic:

- **`RecordingSessionGateTests`**: `TryBeginStopping_WhileAlreadyStopping_IsRefusedSoTheTakeIsProcessedOnce`; `Preparing_BlocksImportAndAnotherStart`; `Stopping_BlocksToggleDiscardPauseAndImport`; `Recording_AllowsStopAndCaptureControlsButNotImport`; `CancelPreparing_AfterRecordingStarted_LeavesRecordingPhase`; `CancelPreparing_WhenStartIsAbandoned_ReturnsToIdle`; `Import_GoesFromPreparingToProcessingToIdle`; `Stop_GoesFromStoppingToProcessing`; `Discard_GoesFromStoppingToIdle`; `MarkIdle_WhileRecording_IsRefusedSoALateCallbackCannotEndTheNextTake`.
- **`RecordingReadinessEvaluatorTests`**: live on + all ready -> can record; live off + engine missing -> cannot; live off + engine ready -> can; live on + engine missing -> cannot; provider unset -> cannot; Local + model missing -> cannot; Local + model downloaded -> summary ready; CLI + missing from PATH -> cannot; CLI on PATH -> can.
- **`RecordingPipelineRulesTests`**: `ShouldSaveBeforeTranscribing_NewTakeWithoutDraft_SavesSoAFailedPassKeepsTheAudio`; `..._TakeWithDraft_Saves`; `..._LinkedMeetingWithOtherAudio_SavesSoTheNewAudioIsNotOrphaned`; `..._RetranscribeOfSavedAudio_LeavesThePreviousTranscriptAlone`. (No test exists for `ResolveTranscriptionStage`; add all five outcomes.)
- **`RecordingCaptureSourcesTests`**: system loopback keeps mic and needs no pid; `captureMicrophone=false` is distinct from a null device id; process tree with pid 0 throws out-of-range; process tree with a pid does not use loopback; loopback with a pid throws; plus Windows-native cases (`AudioClientActivationParams_IncludeTree_Is12BytesWithHeaderOffsets`, `PropVariant_PinnedBlobCarrier_MatchesNativeSize`, `ShouldSurfaceOutputFailure_*`: error while recording true; user stop false; system-loopback error false) which stay with the Windows native module.
- **`AudioCaptureServiceTests`** (behavior contract of the capture service): pump fault reaches the caller while recording; stop rethrows, cleans up and leaves readable audio; a new recording can start after a fault; a throwing frame subscriber is surfaced; a failing teardown step still runs the rest and reaches the caller; mic lost warns and keeps recording with the output (and the output still reaches the mix); system loopback lost warns and keeps recording with the mic; both lost -> last warning says nothing is left; only source lost -> nothing left; process output lost keeps its stop behavior; mic lost during process capture warns and continues; user stop is never a failure; concurrent stops tear down once and all callers see the same outcome/failure; stop when not recording does nothing; dispose after a fault does not throw.
- **`AudioImportServiceTests`**: stereo 44.1 kHz PCM -> 16 kHz mono PCM16; already 16 kHz mono -> valid WAV; missing source throws; non-audio bytes throw and leave no valid WAV.
- **`WavHeaderFlushCadenceTests`** and **`WavHeaderRepairTests`** (13 cases): flush cadence by byte count; readable header while open after flush; repair outcomes.
- **`MicrophoneLevelMeterServiceTests`**: device refuses to start -> capture disposed; start after failed start works; creation failure does not throw; stop disposes once.
- **`AudioLevelMeterTests`**: full scale 1; above full scale clamps; -30 dB is 0.5; speech well above floor; negative treated as silence; NaN is 0; louder never reads lower.
- **`ActiveAudioAppServiceTests`** (25 cases): child roots to parent with same image; different-image parent stops at child; parent started after child is a reused pid; missing parent; parent cycle terminates; two sessions same root = one entry with max peak; two roots same exe both playing are separate; only the playing root kept; inactive silent excluded; inactive with peak above threshold included; active with zero peak included; inactive with peak below threshold excluded; system sounds excluded; own process tree excluded; unresolvable process skipped; pid 0 skipped; unreadable exe path falls back to process name and no roll-up; friendly name prefers file description, then product name, then process name; ordering by friendly name; peak reported; `ReadPeaks` returns latest per root without re-enumerating, empty before refresh, ignores unmapped sessions.
- **`ActiveAppEntriesTests`**, **`MeetingAppSuggestionTests`** (8), **`RecordAudioSourceMemoryTests`** (17, including JSON round-trip), **`WindowsProcessInfoProviderTests`**.
- **`LiveAnswerPromptBuilderTests`** (7), **`LiveAnswerWebPolicyTests`** (4), **`LiveAnswerWindowTests`** (6), **`LiveCopilotRecordingHandoffTests`** (9, including `StartedHintDuration_IsTwoAndAHalfSeconds`), **`LiveQuestionJevJudgeTests`** (other module).
- **`SuggestedMeetingTitleTests`** (12), **`TranscriptStampFormatterTests`** (12), **`TranscriptHighlightApplicatorTests`** (6), **`MeetingLibraryLayoutTests`** (4), **`FolderPathListTests`** (3), **`CalendarEventTimingTests`** (6), **`CalendarEventPagerTests`**.
- **`MeetingRetranscriptionTests`**: availability (audio exists + idle = available; audio missing = NoAudio; null record = NoAudio; busy = Busy; checks the recorded audio path); `CreateRequest` drops the live draft, keeps meeting context (calendar ids, attendees, brief, note template, folder), and a missing `EndedAt` becomes `default`.
- **`MarkdownMeetingRepositoryTests`**, **`MeetingMarkdownFormatterTests`**: persistence contract of 4.3.

Cases with no test today that the port must add: orchestrator end-to-end with doubles for each outcome in 3.7 (including cancel at each stage, failure of the first save, summary failure after transcript saved, no provider chosen, engine not ready); host callback matrix of 3.9 (hand-off then next take must not be reset; late callbacks no-op); `SaveAndFinishForCloseAsync`; readiness resolver (provider parsing, local model on disk); question-detection generation/baseline logic; ask web decision; microphone choice resolution (`ResolveMicrophoneChoice`, `SameMicrophoneChoices`); `AudioSourceCard.Update`; card list reconciliation; elapsed formatter above 59 minutes; highlight timing across pause.

---

## 7. Bugs, races and uncovered cases

Status: **confirmed** = established from code reading with the cited lines (and library contracts where noted); none were reproduced by running the app. **suspected** = plausible from the code but depends on runtime or intent.

| ID | Status | Finding | Evidence |
|---|---|---|---|
| B-1 | confirmed | Placeholder-title detection only matches the English prefix `Meeting <digit>`. The default UI/transcript/summary language is Spanish, where the placeholder is `Reunión 2 nov, 14:05`, so a model-suggested title is never applied for Spanish users. | `MeetingLive.Core/Services/SuggestedMeetingTitle.cs:15`; `MeetingLive.App/Strings/es/Resources.resw:290`; used at `RecordingPipelineOrchestrator.cs:153`. |
| B-2 | confirmed | A failed capture start leaves a header-only or empty WAV in the library: the writer is created before the devices start, and the abort path disposes but never deletes the file; the view model does not delete it either. | `AudioCaptureService.cs:135,157,336-397`; `RecordingPageViewModel.cs:1289-1300`. |
| B-3 | confirmed | Re-recording a calendar-linked existing meeting reuses its id, so the first take's transcript, summary and action items are shown paired with the new audio until replaced, and the previous WAV is left orphaned when the new stem differs (the move only follows the record's current audio path). | `RecordingPipelineOrchestrator.cs:48-58`; `MarkdownMeetingRepository.cs:73-82`; `RecordingPageViewModel.cs:1238`. Intent unclear, so consequence-level status: suspected for the orphan, confirmed for the stale pairing. |
| B-4 | confirmed | `RecordedAt` is taken before the live model loads and the capture starts, so `recordedAt` precedes the real start of audio by the model load time (can be seconds); `endedAt - recordedAt` is longer than the WAV, and wall-clock stamps derived from `recordedAt` are shifted. | `RecordingPageViewModel.cs:1239` vs `1266`, `1279`. |
| B-5 | confirmed (NAudio contract) | Only 2-channel sources are downmixed. A device or loopback with more than 2 channels (5.1/7.1 render endpoint, multi-channel mic array) keeps its channel count and `MixingSampleProvider.AddMixerInput` rejects it, so Start throws. The same one-line condition exists in the import service, where a >2-channel file is written as a multi-channel WAV instead of mono. | `AudioCaptureService.cs:405-410`; `AudioImportService.cs:32`. |
| B-6 | confirmed | Every save builds a fresh record and does not copy `JevAnalysis`; saves 4-5 in a re-transcribe or any second save drop previously stored Jev results until analysis runs again (it only runs after a successful summary). `Notes`, `Attendees`, calendar ids and `NoteTemplateId` are also only taken from the request, so any caller that does not pass them loses them (the retranscribe request does pass them). | `RecordingPipelineOrchestrator.cs:281-308`; `MeetingRetranscription.cs:35-58`. |
| B-7 | confirmed | A new transcript save during re-transcription writes `summary = null, actionItems = []` before the new summary exists, erasing the old summary and action items; if no provider is chosen or summarization fails the user ends with a transcript only. Highlight stars in the old transcript are lost (retranscribe passes no highlights). | `RecordingPipelineOrchestrator.cs:127-129`; `MeetingRetranscription.cs:47`. |
| B-8 | confirmed | Prep notes typed in a coming-up note whose event has no saved meeting are not persisted anywhere until a recording is saved; `SavePrepNotesAsync` returns when there is no linked meeting. | `RecordingPageViewModel.cs:1029-1032`. |
| B-9 | confirmed | `CreateLibraryAudioPathAsync` passes `_ => null` as the id lookup, so the allocator can never recognize an existing Markdown as the same meeting and picks `stem 2` for the WAV; the repository later resolves stem 1 and moves/overwrites the file. Behavior is correct only by accident of the later move. | `RecordingPageViewModel.cs:1901-1905`; `MeetingLibraryLayout.cs` `AllocateFileStem`. |
| B-10 | confirmed | Stale notes leak into the next take or another meeting: after a run resets, `SessionNotes` keeps the previous take's text; opening a coming-up note does not clear it, `StartRecordingCore` skips clearing when a coming-up note is open, and `SavePrepNotesAsync` then writes the stale text into the linked existing meeting (or the new meeting's notes). | `RecordingPageViewModel.cs:858-892, 1248-1252, 1029-1044`; release path `RecordingPageViewModel.PipelineRun.cs:ReleaseSession` does not clear notes. |
| B-11 | confirmed | In the first-save-failed-with-no-draft case (store fault on the first save) the WAV exists but no meeting does, the take stays on screen with an error, there is no retry action, and the next Record overwrites the page's reference to the file. | `RecordingPipelineOrchestrator.cs:44-60, 190-197, 208-217`. |
| B-12 | confirmed | Error detection is a string-prefix test. Capture failure messages (`Error_OutputCaptureFailed`, `Error_CaptureFaulted`) do not begin with "Error", and `withCaptureFailure` prefixes statuses with them, so those states render as informational, not as errors. | `RecordingPageViewModel.cs:246-247`; `PipelineRun.cs` `WithCaptureFailure`; resw keys. |
| B-13 | confirmed | While recording, the bar named "Microphone level" shows the RMS of the mixed stream (mic + meeting audio), not the microphone. | `RecordingPageViewModel.cs:1820-1832`; `RecordPage_MicLevelBar` name. |
| B-14 | confirmed | The Settings microphone meter is linear (`level*100`) while the Record meter is dB-scaled (`ToMeterValue`), so the same voice reads very differently on the two pages. | `MicrophoneSectionViewModel.cs:85` vs `RecordingPageViewModel.cs:1817`. |
| B-15 | confirmed | `MicLevel` is not reset on Pause and no frames arrive while paused, so the recording-bar meter freezes at the last value; `ShowMicPreview` stays true during pause. | `RecordingPageViewModel.cs:1496-1524`; `AudioCaptureService.cs:445-453`; `ShowMicPreview` formula. |
| B-16 | confirmed | In the "Answer" button (confirm) path with text in the typed box, the typed question is answered and the detected question is cleared without being added to the dismissed set; on provider exception or empty answer the armed question is not restored (only the provider-unresolved path restores it). | `RecordingPageViewModel.cs:544, 554-555, 596-642`. |
| B-17 | confirmed | In `EnsureReadyAsync` the branch `if (dialog.ViewModel.CanRecord) return true` is unreachable (the dialog is only shown when `CanRecord` is false) and the "Done" button text/default-button logic in `Apply` is dead. `CreateCaptureSourcesOrShowError` never returns null and never shows an error. | `RecordingSetupResolver.cs:68-80`; `RecordingSetupDialog.xaml.cs:Apply`; `RecordingPageViewModel.cs:2155-2165`. |
| B-18 | confirmed | `Error_EngineNotReady` says "Download finished but ..." although nothing was downloaded in this path (engine removed between the readiness gate and processing, or an import/re-run path). | `RecordingPipelineOrchestrator.cs:120-124`; resw. |
| B-19 | confirmed | Import: `recordedAt` = file last-write time (usually the end of the recording for voice memos), `endedAt = recordedAt + duration`, so the end time is wrong by one duration. The import conversion call is not given a cancellation token although the service supports one. | `RecordingPageViewModel.cs:1411, 1438, 1421-1425`. |
| B-20 | confirmed | A provider setting that does not parse is "not chosen" for readiness but defaults to Local in the pipeline and in live answers; `Enum.TryParse` is case-sensitive and accepts numeric strings. | `RecordingSetupResolver.cs:117-125` vs `AppSettings.ResolveSummaryProviderKind`. |
| B-21 | confirmed | Background summary after hand-off cannot be cancelled from the UI (Cancel is bound to `activeRun`, null after release, and hidden). | `PipelineRun.cs:CancelProcessing`; `RecordingPageViewModel.cs:1622-1625`. |
| B-22 | suspected | `CanvasTranscriptText` (O(n) highlight pass over the whole transcript) is recomputed in the property getter on every live update and read twice per update by the page; long meetings may lag. | `RecordingPageViewModel.cs:252-255, 1721-1729`; `RecordingPage.xaml.cs:137-162`. |
| B-23 | suspected | Recording started from the pill or a toast without ever visiting the Record page skips the remembered-app restore and device list load; capture falls back to system audio and the default microphone. | `RecordingPageViewModel.cs:1227-1228, 1988`; `AudioSources.Start` only on navigation. |
| B-24 | suspected | Soft warnings (mic lost, output lost) only show while recording; after Stop they vanish, so the user is not told the saved audio lacks a side. | `RecordingPageViewModel.cs:1870-1879`; `WithCaptureFailure` uses only hard failures. |
| B-25 | suspected | Apps whose audio runs in a helper with a different exe image than the app (for example a WebView host child of the meeting app) are listed under the helper's name and not flagged as a known meeting app. | `ActiveAudioAppService.cs:FindRoot` (same-image rule); test `Refresh_ParentWithDifferentImage_StopsAtChild`. |
| B-26 | suspected | A calendar link and `comingUpNoteOpen` survive an error end (`OnFinished`, no reset), so the next unrelated Record can reuse the linked meeting id and overwrite that meeting. | `PipelineRun.cs:EndOrReport(reset=false)`; `RecordingPageViewModel.cs:1238`. |
| B-27 | suspected | Brief generation resolves the provider with the page's setup gates, which can open model-download or sign-in dialogs when the user only opened a calendar card. | `RecordingPageViewModel.cs:1066-1073`. |
| B-28 | suspected | Orchestrator keeps using the original `audioPath` after the repository may have moved the WAV (title or folder change at a later save), so the failure-path save passes a stale path. | `RecordingPipelineOrchestrator.cs:199-200` with `MarkdownMeetingRepository.cs:79-81`. |
| B-29 | suspected | A start that fails after `liveTranscription.Start` threw midway does not stop the live session because `liveSessionActive` is set only after Start returns. | `RecordingPageViewModel.cs:1266-1268, 1289-1296`. |
| B-30 | suspected | Race: a capture-failure event can arrive on the UI thread between `MarkRecording` and `IsRecording = true`; it is handled by the post-start check, but a failure arriving while the stop is in progress sets status text after the stop's own error text overwrote it. | `RecordingPageViewModel.cs:1280-1287, 1848-1860, 1324-1331`. |
| B-31 | suspected | The settings file is shared by several writers that each load, mutate and write the whole file (`RememberMicrophone`, `RememberChoice`, settings sections) with no lock, so concurrent saves can drop each other's change. | `RecordingPageViewModel.cs:2129-2148`, `RecordingAudioSourcesViewModel.cs` `RememberChoiceAsync`, `AppSettingsService`. |
| B-32 | suspected | The idle mic preview is a singleton shared with the Settings page; Settings' `StopLevelMeter` stops whatever is running, so navigation order Settings -> Record could stop the Record preview started a moment earlier. | `MicrophoneSectionViewModel.cs:75-80`; `MicrophoneLevelMeterService.Start/Stop`. |

---

## 8. Parity checklist

Mark an item done only when the port reproduces the behavior and has a test (or a recorded reason). Items prefixed "FIX" implement the corrected behavior of the bug listed.

### Gate, readiness and setup
1. Session gate with phases Idle, Preparing, Recording, Stopping, Processing and the exact transition table of 3.1; refused transitions change nothing.
2. `CanToggle`, `CanImport`, `CanControlCapture`, `RequiresCloseConfirmation` derived exactly as in 3.1.
3. Command enablement re-evaluated on every transition and on `IsRecording`/`IsProcessing` changes.
4. `MarkIdle` while Recording is refused.
5. `CancelPreparing` in `finally` of Start and Import is a no-op after the phase moved on.
6. Readiness evaluator with the exact formulas of 3.2 (`liveRequired`, `summaryReady`, `canRecord`, `liveReady`).
7. Live preview readiness equals engine readiness; live off does not waive the engine.
8. Provider parse for readiness: blank or unparsable -> not chosen. FIX B-20: use one parse rule everywhere.
9. Local summary ready only when the chosen model id exists in the catalog and its file is on disk.
10. CLI summary ready when the CLI resolves on PATH; xAI ready when credentials exist.
11. Engine ready when the Nemotron model is on disk and the CUDA or CPU runtime is ready.
12. Setup snapshot texts for the three cards (status and detail) with all key variants of 2.4.
13. Summary caption rules (not chosen, Local, Local — {model}, CLI names, xAI name).
14. Inline setup panel shown only when idle and not ready, with the headline, three cards and the "Set up to record" button.
15. Setup dialog with title, primary "Set up", close "Cancel", headline and the same three cards.
16. `EnsureReady` returns true immediately when ready; otherwise loops dialog -> missing steps -> re-evaluate until ready or cancelled.
17. Missing-steps order: engine setup first, then summary chooser, then CLI/xAI availability for the chosen kind; a cancelled step ends the pass.
18. Readiness is refreshed on page entry, after setup, and before every Start and Import.
19. Idle status text is "Ready to record." or "Set up recording before you start." per readiness, only when idle.

### Microphone choice
20. Microphone list order: None, System default, then devices with non-empty ids.
21. Restore preselection from remembered kind/device; vanished device -> System default, never None.
22. When nothing remembered, fall back to the Settings microphone if present, else System default.
23. Preserve the current choice on refresh (match by kind and id; missing device -> System default).
24. Do not rewrite the list when unchanged (dropdown-open refresh).
25. Suppress selection events during list rebuilds.
26. Stale/hidden-page microphone loads are discarded by generation.
27. Selecting a microphone persists kind and device via load-mutate-save, swallowing errors.
28. Selecting None stops the preview; other choices restart it on the chosen device.
29. Start captures a microphone unless kind is None; device id only for kind Device; null id = OS default.
30. Recording-time status text variants (mic/no mic, app/system) of 3.6.

### Meeting-audio sources
31. Fixed "All system audio" card with tooltip and no meter.
32. One card per playing app, reused by process id across refreshes, with minimal list reconciliation.
33. Card data: name, tooltip, level, availability, icon, detected tag, browser hint, not-playing tag, opacity 1.0/0.55.
34. A selected app that stops playing stays in the list, unavailable, inserted in name order.
35. Empty-state hint when no available app cards exist.
36. Polling only while the page is visible and idle; start idempotent; stop zeroes levels and invalidates in-flight results.
37. Peak read every 150 ms, full refresh every 1.5 s, first refresh immediate.
38. Enumeration filters (system sounds, pid 0, inactive with peak <= 0.001), host exclusions, own-process-tree exclusion.
39. Root resolution by walking same-image parents with cycle, depth 32 and recycled-pid guards.
40. Friendly name order: file description, product name, process name.
41. Browser and known-meeting-app classification lists exactly as in 3.4.
42. Per-root peak is the max over its sessions; list ordered by name then pid.
43. Card selection by the user persists the choice; programmatic selection does not.
44. Remembered app restored once per polling start only if that exe is playing and the user has not touched anything.
45. Meeting-app suggestion rules (system selected, known app, not dismissed, loudest then name).
46. Suggestion bar text, action button, dismissal by closing (per process id, session only), no auto-switch.
47. Suggestion not evaluated while restore is pending.
48. Record-time target resolution: still-running check by pid and exe path (case-insensitive; unknown path trusts the process).
49. Fallback to system audio with a warning bar and message when the app is gone; bar closes on any user card selection.
50. Sources summary line "Mic: {0} · Audio: {1}" shown while recording.
51. Icon loading: 32 px shell icon, cached per path case-insensitively, null on any error, glyph fallback, async assignment.

### Start, pause, highlight, copy, discard, stop
52. Start sequence order of 2.5 (gate, readiness, mic load, sources, settings, session reset, ids, path, state reset, live start, preview stop, event wiring, capture start, mark recording).
53. New take id = linked meeting id or a fresh Guid.
54. `RecordedAt` captured at the moment of Start. FIX B-4: capture it at the moment audio capture actually starts, or store separately the capture start.
55. WAV path allocated from library layout using destination folder, date and title.
56. Live transcription started only when enabled, with language, recordedAt and diarization flag; status "Loading transcription model..." during load.
57. Idle mic preview stopped before capture starts; restarted on any start failure.
58. Four capture event subscriptions added before Start and removed on stop, discard or failure.
59. Start failure text "Error: could not start recording ({0})." and cleanup of live session. FIX B-2/B-29: delete the partial WAV and stop a half-started live session.
60. Failure notified between capture start and mark-recording triggers an immediate stop.
61. Elapsed timer: 1 s tick, `mm:ss` with minutes beyond 59, reset on start/stop, paused by Pause.
62. Recording bar content, button order, tooltips, names and accelerators (Ctrl+R, Ctrl+P, Ctrl+Shift+D, Ctrl+Enter scoped).
63. Pulse halo animation values, static fallback under reduced motion, stopped when paused/not recording.
64. LIVE badge visible only while recording and not paused.
65. Pause: capture pause, stopwatch/timer stop, pause clock restart, status "Paused. The break is not recorded.".
66. Resume: accumulate pause duration, capture resume, live clock skew update, restart stopwatch/timer, recording status text.
67. Paused time is absent from the WAV and from live ASR input and from elapsed.
68. Highlight: elapsed (>= 0) appended, feedback "Highlighted mm:ss.ff" cleared after 2 s with a restartable timer, canvas refreshed.
69. Highlights are in WAV time (excluding pauses) and are applied as `* ` line prefixes per 3.11 at every save.
70. Copy: copies the canvas text, shows the "Copied" bar for 2.5 s (restartable), disabled when empty.
71. Discard confirmation dialog texts and default button (Close).
72. Discard sequence of 2.6 including deleting the WAV, clearing state and status "Recording discarded.".
73. Discard never saves anything and never touches a linked existing meeting.
74. Stop sequence of 2.10: shared by user stop and capture failure; second caller joins the running stop.
75. Stop errors surface "Error stopping the recording: {0}" unless a capture failure was already reported.
76. Live draft taken at Stop; on failure use the visible live text if non-blank.
77. Transition to Processing sets `IsProcessing` before clearing `IsRecording`; pipeline run starts.
78. Request snapshot built before the first await (title, draft, pause duration, highlights, calendar link, brief, agenda).

### Capture engine (behind interfaces)
79. Output kind is exactly one of system loopback or one process tree; validation errors per 3.3 before any device opens.
80. Mix of microphone (optional) and one output into 16 kHz mono PCM16 WAV. FIX B-5: downmix any channel count.
81. Per-source 5 s buffers with discard-on-overflow; resample non-16 kHz sources.
82. Pump paced against a wall clock excluding paused time; silence is written for empty sources.
83. Header flush every 5 s of written audio; repair on failed close.
84. Pause drops incoming audio and writes nothing; resume continues the same file.
85. PCM frames raised only with subscribers and while writing, as float32 = int16/32768.
86. `CaptureSourceLost` with decremented `remainingSources`; not raised on user stop.
87. `OutputCaptureFailed` only for process-tree errors not caused by a user stop; it cancels the pump.
88. `CaptureFaulted` when the pump dies; stop closes the file then rethrows.
89. Single teardown for concurrent stops; every step runs regardless of earlier failures; first error reported.
90. Start while recording throws; start failure tears down everything that was opened.
91. Microphone device resolution falls back to default when the id is missing or inactive.
92. System loopback silent-period behavior covered by silence padding.
93. Process-tree capture never falls back to system loopback.

### Failures and warnings
94. Hard failures (output failed, faulted): message, one per take, stop the recording, keep audio, prefix later statuses.
95. Soft warnings (mic lost, output lost, nothing left) with precedence; "nothing left" outranks others; shown only while recording; persist for resume.
96. FIX B-12: render capture-failure messages as errors using a typed severity, not a string prefix.
97. FIX B-24: keep soft warnings visible in the post-stop status of that take.
98. Idle and session error bars ("Something went wrong") with the visibility rules of 2.18.

### Level meters and visuals
99. dB-scaled meter function exactly as 3.5 (floor -60, clamp, NaN -> 0).
100. Idle preview from the chosen microphone with RMS per buffer for float32/int16/int32; failures swallowed; stops cleanly.
101. Recording meter from the mixed stream RMS. FIX B-13: meter the microphone separately or rename; keep one scale across pages (FIX B-14).
102. Preview start/stop conditions (visible, idle, mic selected) and level reset on stop. FIX B-15: reset level while paused.
103. Audio bars component values: 5 bars, sizes, profile, phases, speeds, attack 0.55, decay 0.14, 33 ms timer, snap under reduced motion, paused flat.

### Live transcript canvas
104. Canvas text rule (live with stars while session active, saved transcript otherwise) and heading text.
105. Placeholder hint text when empty; hidden canvas when idle with nothing to show.
106. Display refresh suppressed while the text has focus; refreshed on blur.
107. Auto-follow with 32 px stick threshold and a "Jump to latest" button.
108. Live updates replace display text always; committed-text bookkeeping only while recording.
109. Offline transcript replaces the live text when it arrives.
110. Live transcript published to the workspace for chat.
111. FIX B-22: do not recompute highlight application per update over the whole text (cache or incremental).

### Live ask and question detection
112. Armed question notice with Answer and Dismiss; Ctrl+Enter on the button.
113. Typed ask box with Ctrl+Enter submit, placeholder and tooltip; progress ring while answering.
114. Web toggle enabled only for providers that search the web; tooltips per state; not reset between takes.
115. Confirm vs typed-only command semantics and enablement. FIX B-16: define and test what happens to the armed question in each path.
116. Preset ask command (chips) uses the typed path.
117. Dismissal set (exact string) suppresses re-arming; cleared on session reset.
118. Detection per committed-text change with generation and cancellation; baseline advances only on completed or skipped judgments.
119. Detection skipped when TypeSafe is disabled or no key; all failures silent.
120. Ask generation checks after every await; newer ask or Stop owns the UI.
121. Web decision (`supportsWeb`, forced, armed verdict, typed judge) exactly as 3.12.
122. Provider resolution message variants (setup cancelled vs needs setup) and armed restore.
123. Context window of 90 s with the rules of `TakeRecent`; 2500-char fallback.
124. Session context builder with 1500-char cap.
125. Live answer prompt text verbatim (3.12), language rule, optional context and web lines.
126. Streaming with 80 ms flush, no publish before visible text, trim, empty-answer error, used-web flag.
127. Stop and Discard cancel any running answer and judgment; session reset at Start.
128. Answer card with heading, web badge, selectable text, max height 160.

### Notes
129. Notes box with header, placeholder, wrapping, live binding; visible per `ShowSessionNotes`.
130. Notes cleared at Start unless a coming-up note is open; linked meeting notes restored.
131. Notes saved trimmed as `## Personal Notes`, null when blank; read live at each save through the run callback.
132. Run keeps a notes snapshot after hand-off; next take's notes never leak into it.
133. Prep notes saved to the linked meeting on blur and on navigate-away when idle. FIX B-8: persist or keep a draft for unlinked events. FIX B-10: clear stale notes when opening a different coming-up note or resetting.
134. Notes passed as raw notes to the summarizer enhancement context (only when non-blank).

### Pipeline
135. First save before any step that can fail, per `ShouldSaveBeforeTranscribing`; draft vs existing content rules.
136. Transcript stamped with Recorded/Ended headers on every save; `EnsureEndedHeader` idempotent rules.
137. Offline pass with language, progress percent status, cancellation, recordedAt, pause clock skew and diarization flag.
138. Stage resolution (`ResolveTranscriptionStage`) and each stage's behavior and message.
139. Engine-not-ready behavior with and without a draft. FIX B-18: use an accurate message.
140. Transcript save before summarization (no summary, no action items).
141. Summary provider resolution as a safety net (never prompts for first-time choice); null provider -> "Done. Transcript available (no summary)." or the transcription warning.
142. Hand-off message "Generating summary..." releases the foreground session and resets the title.
143. Summarization call with title, recordedAt, summary language, endedAt (null if default) and optional enhancement context (notes, attendees, agenda, template instructions).
144. Title resolution via `SuggestedMeetingTitle.Resolve` and its normalization rules. FIX B-1: placeholder detection in every supported UI language (derive from the same format as `MeetingTitleFormat`).
145. Final save with summary markdown, action items and provider id; workspace notified when the title changed.
146. Post-summary Jev step silent and non-fatal; cancellation tolerated after the summary save.
147. Completion message "Done. Transcript and summary available." (or the transcription warning).
148. Cancellation handling with and without a transcript (messages and saves) per 3.7.
149. Generic failure handling with and without a transcript; summary-failed message; nested save failure reported as terminal error.
150. Host-level guard: any escaping exception becomes a terminal error status; `Complete` always runs.
151. Saved record field mapping exactly as 3.7 (including trimming rules, null rules, `Brief` fallback, `FollowUp`/`ProjectPlan` carry-over). FIX B-6: also carry over `JevAnalysis`, `Notes` and other fields from the existing record when the request lacks them.
152. Highlights applied to the transcript at every save, idempotent.
153. FIX B-7: do not erase the previous summary and action items before the new summary succeeds on re-transcribe.
154. FIX B-11: offer retry or keep a recoverable entry when the first save fails and no draft exists.
155. FIX B-3: when re-recording a linked meeting, preserve or archive the previous take's audio and content explicitly.
156. FIX B-28: use the repository-returned audio path for later saves.

### Run ownership and host
157. Run object per take with its own cancellation, first-save and completion futures, capture-failure snapshot and notes snapshot.
158. Callback matrix of 3.9, including ownership checks and the latest-run rule.
159. `releaseSession` is idempotent and resets title/calendar link only when asked and only when owning.
160. Late callbacks of a handed-off run never reset or mutate a newer take.
161. Status prefixing with the capture-failure message.
162. `LastMeeting` set from the latest run's saves, cleared when that meeting is deleted; workspace "last processed" updated.
163. Cancel processing enabled only while processing; cancels the active run. FIX B-21: allow cancelling the background summary.
164. `IsMeetingInUse` rule for History delete.
165. Close protection: confirm while recording, save-with-progress, 30 s grace, failure dialog, reentrancy guard, all texts of 2.16.
166. `IsCaptureActive` workspace flag mirrors recording or processing.

### Import
167. Import button visibility and enablement; same readiness gates as Record.
168. File picker with the extension list and Downloads start location; cancel is silent.
169. Recorded time from the file's last-write time. FIX B-19: derive start as end minus duration when the file time is a modification time.
170. Destination path allocation and conversion to 16 kHz mono PCM16 WAV with cancellation. FIX B-5 for multi-channel files.
171. Import failure cleans up the partial WAV and shows "Error: couldn't import that audio ({0}).".
172. Imported take: no live draft, no pause, no highlights, `EndedAt = recordedAt + duration`, runs the same pipeline.
173. "Importing audio..." status and mic preview stopped during import.

### Calendar-started takes and brief
174. Coming-up strip visibility (idle only), paging buttons, empty and error messages, time labels.
175. Relevance filter (end + 5 min >= now, start <= now + 14 days), sort by start then id, stale responses dropped.
176. Open event: link fields, agenda, title rule, notes restore, start capture only when the event is current (start <= now <= end + 5 min), join URL opened only for http/https after capture started.
177. Open ignored while another open is in flight or a take is active.
178. Brief generation rules, prompt (3.13), normalization, persistence to the linked meeting, error bar text, generation guards. FIX B-27: do not trigger setup dialogs from brief generation.
179. Link cleared on reset: all fields, agenda, note-open flag, brief state. FIX B-26: do not reuse a stale link after an error end.
180. Take-notes request consumption (immediately when visible, else on next entry); event id routes through the coming-up path; blank request starts a recording.
181. Saved meeting carries calendar event id, calendar id, series id, join URL, attendees, brief.

### Handoff, result, persistence
182. Recording-start handoff rules (`Decide`, `ShouldShowPill`, 2500 ms hint).
183. Result card with title and Open (Summary tab if a summary exists, else Transcript tab).
184. Meeting Markdown format of 4.3 (frontmatter keys and order, sections and order, header escaping, attendees separator, fallbacks).
185. Action item line format and parser.
186. Settings fields of 4.2 with exact value spellings and load-mutate-save rule. FIX B-31: serialize settings writes.
187. Library layout rules (inbox, folder path, sanitize, stem, allocation, move on save, delete order) of 3.14. FIX B-9: pass the real id lookup at allocation.
188. WAV format and header repair of 4.4.
189. Default title format and recomputation after reset.
190. Destination list flattening and selection retention; folder resolved again at Stop with Inbox fallback.
191. Page layout breakpoints, panel arrangement and idle/session scroll behavior of 2.1.
192. All string keys of section 2 present in English and Spanish with the same placeholder positions.
193. Reduced-motion handling for the pulse and the audio bars.
194. Accessibility names and automation ids kept for each control listed in section 2 (for example `BtnToggleRecording`, `BtnPauseRecording`, `BtnHighlightMoment`, `BtnCopyLiveTranscript`, `BtnDiscardRecording`, `BtnImportAudio`, `BtnCancelProcessing`, `BtnOpenSession`, `TxtMeetingTitle`, `ComboRecordDestination`, `ComboRecordMicrophone`, `ListRecordAudioSource`, `TxtRecordingNotes`, `TxtLiveAsk`, `BtnLiveAnswer`, `BtnLiveAnswerDismiss`, `ToggleLiveWebSearch`, `TxtLiveTranscriptPreview`).
195. FIX B-15, B-23, B-25, B-30, B-32: each either fixed with a test or recorded with a reason in the feature document.
