# Module spec: session-views

Source of truth: `MeetingLive.App/SessionPage.xaml(.cs)`, `ViewModels/SessionPageViewModel.cs`, `TranscriptPage.xaml(.cs)`, `ViewModels/TranscriptPageViewModel.cs`, `ISessionCopySource.cs`, `PaneResizeGrip.cs`, `Services/MeetingRetranscriptionRunner.cs`, `MeetingLive.Core/Services/MeetingRetranscription.cs`. Followed references: `RecordingPipelineOrchestrator.cs`, `RecordingPipelineRules.cs`, `SuggestedMeetingTitle.cs`, `CliMeetingTitlePromptBuilder.cs`, `TranscriptStampFormatter.cs`, `TranscriptHighlightApplicator.cs`, `MeetingMarkdownFormatter.cs`, `WorkspaceService.cs`, `MainPage.xaml.cs` (pane drag), `AppSettings.cs`, `Strings/{en-us,es}/Resources.resw`.

Scope note. The assignment mentions playback, transcript highlight styling and enhancement. In the WinUI code none of these exist inside these files:

- There is no audio playback anywhere in the app (a repo-wide search for MediaPlayer, playback and NAudio output classes finds nothing). The transcript tab is a read-only, selectable block of text.
- "Highlight" means only the `* ` line prefix written into the transcript text at save time (section 3.5). The page renders that prefix as ordinary characters.
- "Enhancement" means `SummaryEnhancementContext` (notes, attendees, agenda, template instructions) fed to the summary provider by the pipeline that re-transcription reuses (section 3.7). The summary content itself belongs to the summary module.

Everything below describes current behavior. Items in section 7 are defects the port should fix rather than copy.

---

## 1. Purpose

An "opened meeting" screen (the Session page). It shows one saved meeting with a header (back, title, rename, AI title suggestion, copy, open file location, re-transcribe), a progress/notice area for re-transcription, two tabs (Transcript, Summary) and the active tab's content. This module owns the page chrome, the Transcript tab, the copy contract used by both tabs, the re-transcription feature, and the resizable navigation pane grip in the shell. The Summary tab content is another module; this module only hosts it and reads its copy text.

The Session page is a shell destination (tag `Session`). Shell navigation stays on "Library" while it is showing. It is entered from Library (open a meeting), from Record after a meeting finishes, from a notification/deep link to the Summary tab, and from the personal-tasks dialog.

## 2. User-facing features

String keys are resw keys; English and Spanish values are in section 2.12. `{0}` is a format placeholder.

### 2.1 Page lifecycle and states

Inputs: a meeting id (Guid) passed as navigation parameter; if the parameter is not a Guid, use `Workspace.SelectedMeetingId`.

States of the page, derived from the view model:

- Loading: `IsLoading` true. A 32x32 progress ring centered in the content row. Initial value true.
- Empty: `IsEmpty = !IsLoading && !HasMeeting`. Shows text `SessionPage_Empty` and an accent button `SessionPage_EmptyCta`. The button navigates the shell to Recording (`NavigateTo("Recording")`). Header buttons and tabs are hidden.
- Loaded: `HasMeeting` true. Header title row, header action row, tab bar and inner frame are visible.

Load sequence (`OnNavigatedTo`):
1. Resolve the id as above.
2. `LoadAsync(id)`: set `IsLoading=true`; store id; if id is null set Title="", HasMeeting=false, HasTranscript=false, HasAudio=false and stop; otherwise read the record from the repository. Title = record.Title or "" when the record is missing. HasMeeting = record exists. HasTranscript = record exists and Transcript is not whitespace. HasAudio = `MeetingRetranscription.Evaluate(record, isBusy:false) == Available` (audio path non-blank and the file exists). Then sync re-transcription state (2.8). `IsLoading=false` in a finally block.
3. If no meeting: clear the inner frame content and return.
4. Select the tab stored in `Workspace.SessionTab` (without firing selection handling, guard flag `_isApplyingTab`), then navigate the inner frame to that tab.

Leaving the page (`OnNavigatedFrom`) calls `Detach()`: unsubscribe from `Workspace.MeetingChanged`, `Workspace.ScopeChanged`, `Retranscription.StateChanged`, `Retranscription.Finished`. The view model subscribes to those four events in its constructor. The page is not cached; a new instance is built per navigation.

On the page `Loaded` event the page installs three provider-setup gates on the view model (they need a window root to show dialogs): summary-model resolver (Local provider), CLI provider resolver (Claude Code / Codex), xAI provider resolver. See 5.

External refresh: when `Workspace.MeetingChanged(id)` fires and `id == current id`, re-read the record and, on the UI thread, update Title, HasMeeting, HasTranscript, HasAudio (guarded again by `_meetingId == id`). It does not reload the inner tab.

### 2.2 Tabs

Tab bar: a selector bar with two items, in order: Transcript (tag `Transcript`, document icon, text `SessionPage_TabTranscript`) and Summary (tag `Summary`, sparkle glyph U+EB78, text `SessionPage_TabSummary`). Hidden when there is no meeting.

- Valid tab names: exactly `Transcript` and `Summary`. `Workspace.SetSessionTab` throws on any other value; default is `Transcript`. Unknown tag in the UI falls back to Transcript.
- Selecting a tab (user action, not programmatic): store it with `Workspace.SetSessionTab(tab)` (it persists for the app session and is the tab used the next time any meeting opens), then navigate the inner frame to the tab page with the selected meeting id from `Workspace.SelectedMeetingId`.
- Inner frame: back stack disabled. Navigation uses a slide transition. Effect `FromRight` when the new selected index minus the previously navigated index is greater than 0, else `FromLeft`. The previous index is updated after each navigation. (Quirk: programmatic reloads of the same tab yield `FromLeft`; first open of Summary slides from the right because the stored previous index starts at 0.)
- The inner frame is reloaded (re-navigated to the same tab) after: successful rename, successful suggested title, and re-transcription finished. Reload re-reads data from disk.
- Open entry points choose the initial tab: Library row opens Transcript, Library summary action opens Summary, Record finished opens Summary when the meeting has a summary else Transcript (`OpenSession(ViewModel.HasSummary ? Summary : Transcript)`), main-window deep link opens Summary, tasks dialog opens Summary.

### 2.3 Header: title, rename, suggest title

Back button (`SessionPage_Back`, back arrow, automation id `BtnSessionBack`): `Workspace.NavigateTo("History")` (the Library destination).

Title: bold title text, single line, trailing ellipsis, max width 720 px, shown only when a meeting is loaded.

Rename button (pencil, tooltip `SessionPage_Rename.ToolTipService.ToolTip`, id `BtnSessionRename`): enabled when `CanRename = HasMeeting && !IsSuggestingTitle`. Flow:
1. Show a confirm dialog titled `SessionRename_Title` with a single-line text box (header `SessionRename_Name.Header`, placeholder `SessionRename_Name.PlaceholderText`, prefilled with the current title). Buttons: primary `SessionRename_Primary` (default button = Primary), close `SessionRename_Cancel`.
2. The dialog refuses to close with Primary while the text is empty or whitespace (closing is cancelled; the dialog stays open, no message shown).
3. On Primary: `RenameAsync(text)`.
   - trimmed = text.Trim(). Empty returns false.
   - No current id returns false.
   - If trimmed equals the current VM title (ordinal), return true without saving.
   - Else read the record (missing returns false), set `record.Title = trimmed`, save the whole record, set VM Title, and if `Workspace.LastProcessedMeeting` has the same id, set its Title as well. Return true.
   - Rename never changes the file name: the markdown file stays `{id}.md`; only the `title:` frontmatter line changes.
4. When RenameAsync returns true the page reloads the inner tab. No `MeetingChanged` event is raised by rename.

Suggest-title button (sparkle glyph U+EB78, tooltip "Generate title with AI", id `BtnSessionSuggestTitle`): enabled when `CanSuggestTitle = HasMeeting && HasTranscript && !IsSuggestingTitle`. While running a 20x20 progress ring is shown next to the buttons and both Rename and Suggest are disabled.

`SuggestTitleAsync` returns `(Applied, Error)`:
1. If already suggesting or no id: `(false, null)`.
2. Read record; if missing or transcript blank: `(false, null)`.
3. Set `IsSuggestingTitle=true`.
4. Load settings; provider kind = `ResolveSummaryProviderKind()` (default Local when unset or unparsable). Resolve the provider through the gate (5.2). If the gate returns null (model not chosen, CLI missing, xAI not signed in, or user cancelled setup) return `(false, null)` silently.
5. summaryLanguage = `ResolveSummaryLanguage()` (default `es`).
6. Run `provider.SuggestTitleAsync(transcript, recordedAt, outputLanguage: summaryLanguage)` on a worker thread. Any exception returns `(false, CliFailureUserMessage.Format(ex))`.
7. `next = SuggestedMeetingTitle.FromModelResponse(raw)`. Null returns `(false, "SessionSuggestTitle_Empty" text)`.
8. `titleChanged = record.Title != next` (ordinal, case-sensitive). Call `RenameAsync(next)`; false returns `(false, SessionSuggestTitle_Empty text)`.
9. If titleChanged: set VM Title on the UI queue and raise `Workspace.NotifyMeetingChanged(id)`.
10. Return `(true, null)`. Finally: reset `IsSuggestingTitle=false` via the UI queue (direct assignment if enqueue fails).

Page handling: error not null shows an OK-only dialog titled `SessionSuggestTitle_ErrorTitle` with the error as content and close text `Dialog_OK`. `applied` true reloads the inner tab. `(false, null)` does nothing visible.

Title-only prompt (sent to all providers; Local passes maxTokens 80, temperature 0.3). `{languageName}` is the English name of the summary language code (es Spanish, en English, pt Portuguese, fr French, de German, it Italian, nl Dutch, ja Japanese, others in `ToEnglishLanguageName`; empty means Spanish). `{recordedAt}` is ISO 8601 round-trip ("O"):

```
# Identity

You name a recording from an automatic-speech-recognition transcript.
The transcript may contain ASR errors, false starts, and filler.

# Instructions

Return ONLY a short title, about 3–8 words. Nothing else:
no preamble, no code fences, no ## headings, no quotes, no trailing period.

Write the title in {languageName}.
Ground it in the transcript. Do not invent.
If the recording is an informal ASR test, say so plainly (e.g. Microphone test).
This is an explicit regenerate: do not copy a current title; name the recording from the transcript.

# Context

<recorded_at>{recordedAt}</recorded_at>
<transcript>
{transcript}
</transcript>
```

(The prompt text above is indented in the C# raw string; the real prompt has no leading indentation. The en dash in "3–8" is U+2013.)

### 2.4 Header: copy

Copy button (copy icon, tooltip "Copy what this tab shows", id `BtnSessionCopy`) is always enabled when a meeting is loaded.

- Contract `ISessionCopySource { string? GetCopyText() }` is implemented by each tab page. The page asks the current inner content; if it does not implement the interface nothing happens.
- Transcript tab copy text: the full transcript string if the tab has content, else null.
- Summary tab copy text: the summary view model's `CopyText` (summary module).
- `Copy(text)`: null/empty/whitespace does nothing and shows no feedback. Otherwise put the text on the system clipboard as plain text and show the confirmation.
- Confirmation: a success info bar (`SessionPage_CopyConfirmation.Title` "Copied", `.Message` "Copied to the clipboard.", id `InfoSessionCopy`) opens, and a one-shot timer of 2.5 seconds closes it. Each new copy stops and restarts the timer. The user can also dismiss it manually (two-way bound open flag).

### 2.5 Header: open file location

Button (folder glyph U+E838, id `BtnSessionOpenLocation`, label `SessionPage_OpenLocation.*`). Reads the record, takes `SourcePath` (absolute path of the `.md` file). If the id is missing, the path is blank, or the file does not exist, do nothing (no message). Otherwise launch `explorer.exe /select,"<path>"` so the file is highlighted in Explorer.

### 2.6 Transcript tab (TranscriptPage)

Navigated with a Guid. On navigation it starts `LoadAsync(id)` without awaiting it.

`LoadAsync(id?)`:
1. `IsLoading=true`.
2. Record = repository by id when id given; when id is null, the most recent meeting by `RecordedAt` descending (null when none).
3. If a record was found call `Workspace.SelectMeeting(record.Id)` (this raises `ScopeChanged` if the selection changed).
4. `Title = record.Title`, or the string `NoTranscriptsYet` when no record. (Title is not displayed by the tab; the header shows the title.)
5. `Transcript = record.Transcript ?? ""`. `HasContent = !IsNullOrWhiteSpace(Transcript)`.
6. `IsLoading=false` in finally.

Display:
- Loading: progress ring 32x32 centered.
- Empty (`!IsLoading && !HasContent`): text `TranscriptPage_Empty` plus accent button `TranscriptPage_EmptyCta` (id `BtnTranscriptEmptyRecord`) which navigates the shell to Recording.
- Content: a vertically scrolling container (horizontal scrolling disabled) holding one wrapping, selectable text block with the raw transcript text (id `TxtTranscriptContent`). Padding 24 px on all sides. No search, no per-line controls, no click-to-seek, no speaker colors. Lines are separated by the newline characters stored in the file; the stamps, speaker tags and the star prefix appear as literal text (see 3.4 and 3.5).
- User can select and copy part of the text with the standard text selection.

### 2.7 Re-transcribe: availability and confirmation

Button (glyph U+E72C, id `BtnSessionRetranscribe`):
- Visible only when `HasAudio` (saved audio file exists).
- Enabled only when `CanRetranscribe = HasMeeting && HasAudio && !IsRetranscribeBusy`.
- `IsRetranscribeBusy = runner.IsRunning || Workspace.IsCaptureActive`. `IsCaptureActive` is true while the Record page is recording or processing. The busy flag is global: while any meeting is being re-transcribed, the button is disabled on every meeting.

`MeetingRetranscription.Evaluate(record, isBusy, fileExists?)` returns:
1. `NoAudio` when the record is null, or `AudioFilePath` is null/whitespace (the disk is not probed in that case), or the file does not exist.
2. else `Busy` when `isBusy`.
3. else `Available`.
Audio is checked before busy, so a meeting without audio is NoAudio even when busy.

Click flow: if `!CanRetranscribe` return. Show a confirm dialog: title `SessionRetranscribe_Title`, content `SessionRetranscribe_Content` formatted with the meeting title, primary `SessionRetranscribe_Primary`, close `SessionRetranscribe_Cancel`, default button = Close (the safe one). Only Primary continues.

`RetranscribeAsync()`:
1. Return if no id or `!CanRetranscribe`.
2. Re-read the record. If `Evaluate(record, runner.IsRunning) != Available`: set `HasAudio` from a fresh evaluation (so the button hides if the file vanished) and return with no message.
3. Close the error and notice info bars.
4. `runner.StartAsync(record, summaryModelGate, cliGate, xaiGate)`.

### 2.8 Re-transcribe: progress, cancel, completion

`SyncRetranscriptionState()` runs on load, on `Workspace.ScopeChanged` and on `runner.StateChanged`:
- `IsRetranscribing = runner.IsRunning && runner.MeetingId == current id`
- `RetranscribeStatus = IsRetranscribing ? runner.Status : ""`
- `IsRetranscribeBusy = runner.IsRunning || Workspace.IsCaptureActive`

Progress block (row under the header, visible while `IsRetranscribing`): status text (live region "Polite", id `TextSessionRetranscribeStatus`), an indeterminate progress bar (name `SessionPage_RetranscribeProgress.AutomationProperties.Name`, id `ProgressSessionRetranscribe`) and a Cancel button (`SessionPage_RetranscribeCancel.Content`, id `BtnSessionRetranscribeCancel`) that calls `runner.Cancel()`.

Status messages shown in the status text (all produced by the shared pipeline, see 3.7): `Status_Transcribing` ("Transcribing audio..."), then `Status_TranscribingPercent` with an integer 0-100 ("Transcribing audio... {0}%"), then `Status_GeneratingSummary`, and for terminal states `Status_DoneNoSummary`, `Status_DoneWithSummary`, `Status_ProcessingCancelled`, `Status_CancelledTranscriptSaved`, `Status_LiveDraftKeptTranscriptionFailed`, `Status_TranscriptSavedSummaryFailed`, `Error_*` (values live in the recording module's resources).

Completion (`runner.Finished(result)`), handled only if `result.MeetingId == current id`:

| Outcome | UI |
|---|---|
| `Failed` or `SummaryFailed` | `RetranscribeError = result.Message ?? ""`; error info bar (title `SessionPage_RetranscribeError.Title`, severity Error, id `InfoSessionRetranscribeError`) opens |
| `Cancelled` | notice bar with `SessionRetranscribe_Cancelled` |
| `TranscriptOnly` | notice bar with `SessionRetranscribe_DoneNoSummary` |
| `Completed` (default) | notice bar with `SessionRetranscribe_Done` |

Notice bar: severity Informational, title `SessionPage_RetranscribeNotice.Title`, id `InfoSessionRetranscribeNotice`. It stays open until the user closes it or the next re-transcription starts. After any outcome the page reloads the inner tab (event `RetranscriptionFinished`). Events for another meeting are ignored. The page no longer receives events after navigating away (Detach).

### 2.9 Runner semantics (`MeetingRetranscriptionRunner`)

App-lifetime singleton (`AppServices.Retranscription`), so navigating away neither stops the run nor allows a second parallel one. Properties: `IsRunning`, `MeetingId`, `Status`. Events: `StateChanged` (progress or running flag changed), `Finished(RetranscriptionResult(MeetingId, Outcome, Message))`; both on the UI thread.

`StartAsync(record, gates...)` (UI thread only):
1. If already running return false (the view model ignores the return value).
2. `IsRunning=true`, `MeetingId=record.Id`, `Status = Status_Transcribing`. Capture `_notes = record.Notes`. Reset `_completed`, `_failure`, `_summaryFailure`. Dispose and create a new cancellation source. Raise `StateChanged`.
3. Resolve template instructions from `record.NoteTemplateId` (3.7). Build the request with `MeetingRetranscription.CreateRequest` and run the shared recording pipeline with this runner as the callback sink.
4. Exceptions: `OperationCanceledException` is swallowed (nothing was written yet). Any other exception sets `_failure = CliFailureUserMessage.Format(ex)`.
5. Queue `Complete()` on the dispatcher behind the pipeline's own queued callbacks, and return true.

Callback mapping:
- `CurrentSessionNotes` returns `_notes` (the notes as they were when the run started).
- `OnStatusChanged(s)` and `OnTitleResetAndFinished(s)` set `Status` and raise `StateChanged`.
- `OnTranscriptRefreshed` does nothing.
- `OnMeetingSaved(record)` raises `Workspace.NotifyMeetingChanged(record.Id)` (every intermediate save).
- `OnFinished(s)` (also the target of `OnSavedWithoutTranscript`): if cancellation was not requested set `_failure = s`.
- `OnMeetingCompleted` sets `_completed = true`.
- `OnSummaryFailedAfterTranscriptSaved(id, msg)` sets `_summaryFailure = msg`.

`Complete()` outcome precedence (first match wins): `_summaryFailure` set gives `SummaryFailed` (message = that text); `_failure` set gives `Failed` (message = failure); `_completed` gives `Completed`; cancellation requested gives `Cancelled`; else `TranscriptOnly`. Then reset `IsRunning=false`, `MeetingId=null`, `Status=""`, raise `StateChanged`, then raise `Finished`.

Outcome meanings: Completed = new transcript and summary saved. TranscriptOnly = new transcript saved, no summary (no summary engine chosen or its setup declined). SummaryFailed = new transcript saved, summary provider failed. Cancelled = user cancelled; previous transcript untouched unless the new one was already saved. Failed = offline pass produced nothing; previous transcript untouched.

### 2.10 Navigation pane resize grip (shell)

`PaneResizeGrip` is a transparent 8 px wide grid whose only behavior is a west-east resize cursor. It is hosted in MainPage (not in the session page), overlays the left navigation pane edge, and is driven by MainPage handlers:

- Visible only when the navigation view display mode is Expanded and the pane is open. Re-evaluated on display-mode change, pane opened, pane closed.
- Position: left margin = `OpenPaneLength - 4` (so the 8 px grip is centered on the pane edge); re-positioned on every width change and when shown.
- Pointer pressed: start drag, remember start X (relative to the page) and start pane width, capture the pointer, mark handled.
- Pointer moved while dragging: new width = `clamp(startWidth + (currentX - startX), 200, 480)`; apply live to the pane; reposition; mark handled.
- Pointer released or capture lost (same handler): if dragging, stop, release capture, reposition, mark handled, then load settings, set `NavigationPaneLength` to the final width and save.
- Startup: pane width = `settings.ResolveNavigationPaneLength()` = 280 when unset, else clamp(value, 200, 480).
- Constants: default 280, min 200, max 480 (device-independent pixels), automation id `SizerNavigationPane`.

### 2.11 Accessibility and automation ids

Automation ids to keep: `BtnSessionBack`, `BtnSessionRename`, `BtnSessionSuggestTitle`, `BtnSessionCopy`, `BtnSessionOpenLocation`, `BtnSessionRetranscribe`, `InfoSessionCopy`, `TextSessionRetranscribeStatus`, `ProgressSessionRetranscribe`, `BtnSessionRetranscribeCancel`, `InfoSessionRetranscribeError`, `InfoSessionRetranscribeNotice`, `SelectorSessionTabs`, `SelectorSessionTranscript`, `SelectorSessionSummary`, `BtnSessionEmptyRecord`, `BtnTranscriptEmptyRecord`, `TxtTranscriptContent`, `SizerNavigationPane`. The retranscribe status text is a polite live region. Icon-only buttons carry an accessible name and a tooltip.

### 2.12 String table (en-us / es)

| Key | English | Spanish |
|---|---|---|
| SessionPage_Back.AutomationProperties.Name | Back | Atrás |
| SessionPage_TabTranscript.Text | Transcript | Transcripción |
| SessionPage_TabSummary.Text | Summary | Resumen |
| SessionPage_Empty.Text | Open a meeting from Library, or record one. | Abre una reunión desde la Biblioteca, o graba una nueva. |
| SessionPage_EmptyCta.Content | Record a meeting | Grabar una reunión |
| SessionPage_Rename.AutomationProperties.Name | Rename | Renombrar |
| SessionPage_Rename.ToolTipService.ToolTip | Rename title | Renombrar título |
| SessionPage_SuggestTitle.AutomationProperties.Name | Suggest title | Sugerir título |
| SessionPage_SuggestTitle.ToolTipService.ToolTip | Generate title with AI | Generar título con IA |
| SessionPage_Copy.AutomationProperties.Name | Copy | Copiar |
| SessionPage_Copy.ToolTipService.ToolTip | Copy what this tab shows | Copiar lo que muestra esta pestaña |
| SessionPage_OpenLocation.AutomationProperties.Name / .ToolTip | Open file location | Abrir ubicación del archivo |
| SessionPage_CopyConfirmation.Title | Copied | Copiado |
| SessionPage_CopyConfirmation.Message | Copied to the clipboard. | Copiado al portapapeles. |
| SessionPage_Retranscribe.AutomationProperties.Name | Re-transcribe | Volver a transcribir |
| SessionPage_Retranscribe.ToolTipService.ToolTip | Re-transcribe from the saved audio | Volver a transcribir desde el audio guardado |
| SessionPage_RetranscribeProgress.AutomationProperties.Name | Re-transcription progress | Progreso de la nueva transcripción |
| SessionPage_RetranscribeCancel.Content | Cancel | Cancelar |
| SessionPage_RetranscribeCancel.AutomationProperties.Name | Cancel re-transcription | Cancelar la nueva transcripción |
| SessionPage_RetranscribeError.Title | Re-transcription failed | No se pudo volver a transcribir |
| SessionPage_RetranscribeNotice.Title | Re-transcription | Nueva transcripción |
| SessionRetranscribe_Title | Re-transcribe this meeting? | ¿Volver a transcribir esta reunión? |
| SessionRetranscribe_Content | Re-transcribing "{0}" replaces its transcript with a new one made from the saved audio, then regenerates the summary. Any edits to the current summary will be lost. | Al volver a transcribir "{0}", se reemplazará su transcripción por una nueva generada a partir del audio guardado y se regenerará el resumen. Se perderán las ediciones del resumen actual. |
| SessionRetranscribe_Primary | Re-transcribe | Volver a transcribir |
| SessionRetranscribe_Cancel | Cancel | Cancelar |
| SessionRetranscribe_Done | Re-transcribed. The transcript and summary were updated. | Transcripción nueva lista. Se actualizaron la transcripción y el resumen. |
| SessionRetranscribe_DoneNoSummary | Re-transcribed. The transcript was updated, but no summary was generated. | Transcripción nueva lista. Se actualizó la transcripción, pero no se generó un resumen. |
| SessionRetranscribe_Cancelled | Re-transcription cancelled. | Se canceló la nueva transcripción. |
| SessionRename_Title | Rename meeting | Renombrar reunión |
| SessionRename_Primary | Rename | Renombrar |
| SessionRename_Cancel | Cancel | Cancelar |
| SessionRename_Name.Header | Title | Título |
| SessionRename_Name.PlaceholderText | Meeting title | Título de la reunión |
| SessionSuggestTitle_ErrorTitle | Could not suggest a title | No se pudo sugerir un título |
| SessionSuggestTitle_Empty | The model did not return a usable title. | El modelo no devolvió un título utilizable. |
| TranscriptPage_Empty.Text | There's no transcript yet. Record or import a meeting first. | Todavía no hay transcripción. Graba o importa una reunión primero. |
| TranscriptPage_EmptyCta.Content | Record a meeting | Grabar una reunión |
| NoTranscriptsYet | No transcripts yet | (see es resw) |
| Status_Transcribing | Transcribing audio... | (see es resw) |
| Status_TranscribingPercent | Transcribing audio... {0}% | (see es resw) |
| Dialog_OK | OK | (see es resw) |

Unused keys in the current resources (do not port as features): `TranscriptPage_Title.Text`, `TranscriptPage_Notes.Header`, `TranscriptPage_Notes.PlaceholderText` ("Your notes" / "Add your notes for this meeting"; notes editing lives on the Summary tab).

## 3. Domain rules

### 3.1 Constants

| Name | Value | Where |
|---|---|---|
| Copy confirmation duration | 2.5 s, one-shot, restarted on each copy | SessionPageViewModel |
| Title max width | 720 px | SessionPage.xaml |
| Suggested title max length | 80 characters | SuggestedMeetingTitle |
| Title-only token cap (Local provider) | 80 tokens, temperature 0.3 | LocalLlmSummaryProvider |
| Nav pane default / min / max | 280 / 200 / 480 | AppSettings |
| Grip width / offset | 8 px, margin-left = width - 4 | MainPage, MainPage.xaml |
| Placeholder-title pattern | regex `^Meeting\s+\d`, case-insensitive, culture-invariant, applied to the trimmed title | SuggestedMeetingTitle |
| Highlight prefix | `* ` (asterisk + space) | TranscriptHighlightApplicator |
| Default transcription language | `es` when unset | AppSettings |
| Default summary language | `es` when unset | AppSettings |

### 3.2 Title normalization (`SuggestedMeetingTitle`)

`Normalize(raw)`:
1. null/whitespace gives null.
2. Split on `\n` after replacing `\r\n`; take the first line that is non-empty after trim.
3. Remove all leading `#` characters, trim.
4. Strip one pair of wrapping quotes: ASCII `"..."` or curly U+201C...U+201D (only when length >= 2 and both ends match). Trim.
5. Remove all trailing `.` characters, trim.
6. If longer than 80 characters cut to 80 and trim.
7. Empty gives null.

`FromModelResponse(raw)` (the always-apply parser used by the suggest button):
1. null/whitespace gives null.
2. Find the first line whose trim equals `## Title`. If none: `Normalize(raw)`.
3. If found: collect following non-empty trimmed lines until a line whose trim starts with `## `; join with a single space; if nothing collected return null; else `Normalize(joined)`. A heading-only response returns null (never the word "Title").

`Resolve(current, suggested)` (used by the pipeline after summarizing, not by the suggest button): normalize the suggestion; if null return current; return the normalized value only when `LooksLikePlaceholder(current)` (blank, or matches the placeholder pattern, e.g. "Meeting 2026-10-01 22:36"), else keep current.

### 3.3 Rename rules

Trim, non-empty, unchanged title is a no-op success, no length limit, no uniqueness check, record saved whole, file name stays `{id}.md`. On write, the title line replaces `\r` and `\n` with a space (so a multi-line title is flattened in the file). On read the title is the text after the first `:` on the `title:` line, trimmed.

### 3.4 Transcript text format

Produced by the transcription service and the stamp formatter; the Transcript tab shows it verbatim.

Header (optional, first lines): `Recorded yyyy-MM-dd HH:mm` then `Ended yyyy-MM-dd HH:mm`, local time, invariant culture. `EnsureEndedHeader(transcript, recordedAt, endedAt)`: no-op if the transcript is empty or either time is default; if line 1 starts with `Recorded ` then replace line 2 if it starts with `Ended `, else insert the Ended line as line 2; if there is no Recorded line prepend both lines. Preserves `\r\n` when the transcript contains it, else uses `\n`. Idempotent.

Line: `[mm:ss.ff-mm:ss.ff] text` or `[mm:ss.ff-mm:ss.ff] [ Speaker-N ] text` when the speaker tag is greater than 0. Elapsed format: minutes are total minutes (not wrapped at 60, at least 2 digits), seconds 2 digits, hundredths = milliseconds / 10 truncated, 2 digits, invariant. Negative start is clamped to 0; end before start is set equal to start.

Example:
```
Recorded 2026-10-01 22:36
Ended 2026-10-01 23:06
[00:00.00-00:04.52] [ Speaker-1 ] Buenos días a todos.
* [00:04.52-00:09.10] [ Speaker-2 ] Empecemos con el presupuesto.
[00:09.10-00:12.00] Gracias.
```

### 3.5 Highlights (stars)

Highlights are elapsed times the user marked while recording. They are applied at save time by `TranscriptHighlightApplicator.Apply(transcript, highlights)` and become literal `* ` prefixes in the stored transcript.

Algorithm:
1. Clamp negatives to 0, distinct, sort ascending. No marks: return the transcript unchanged (or "" if null).
2. Transcript empty: return one line `* mm:ss.ff` per mark, joined with `\n`.
3. Detect newline style (`\r\n` if present else `\n`), split into lines.
4. Index lines that, after removing one leading `* `, match `^\[(\d+):(\d{2}\.\d{2})-(\d+):(\d{2}\.\d{2})\]`; record start and end times (minutes + fractional seconds).
5. No timestamped lines: append one `* mm:ss.ff` line per mark after the existing lines.
6. For each mark: first line whose [start, end] inclusive contains it; else the last line whose start is <= mark; else (mark before all lines) the first timestamped line. Star each target line once; a line already starting with `* ` is not prefixed twice.
7. Join with the detected newline.

The Transcript tab does not style starred lines.

### 3.6 Copy rules

Copy puts exactly what the tab is showing on the clipboard as plain text: for the Transcript tab, the whole raw transcript including header lines, stamps, speaker tags and `* ` prefixes. No trimming or reformatting is applied. Whitespace-only text is never copied.

### 3.7 Re-transcription pipeline rules

`MeetingRetranscription.CreateRequest(record, templateInstructions)` builds a pipeline request:

| Request field | Value |
|---|---|
| MeetingId, AudioPath, RecordedAt, Title, FolderId | from record |
| EndedAt | `record.EndedAt ?? default` (default means unknown) |
| LiveDraft | null (so the offline pass result becomes the transcript) |
| PausedDuration | zero |
| Highlights | empty |
| CalendarEventId, CalendarId, SeriesId, JoinUrl, Attendees, Brief, NoteTemplateId | from record |
| Agenda | null |
| TemplateInstructions | argument (resolved by the runner) |

Template instructions (`NoteTemplateInstructions.ResolveAsync`): normalize the id; null id gives null; the custom-template id loads the user's custom template store and returns its trimmed `Instructions` (null if blank); any other id returns the built-in catalog instructions for it.

Pipeline (`RecordingPipelineOrchestrator.RunAsync`) as it applies to re-transcription (no live draft):
1. Read the existing record. `ShouldSaveBeforeTranscribing(liveDraft, existingAudioPath, audioPath)` is true if the live draft is non-blank, or the existing audio path differs (ordinal, ignore case) from the request audio path. For re-transcription both are false, so nothing is saved first and the previous transcript stays untouched. Then the meeting is considered durable.
2. Load settings. Language = `ResolveTranscriptionLanguage()` (default `es`).
3. If the local speech engine is installed and ready (`TranscriptionEngineInstaller.IsReady`): status `Status_Transcribing`; run `transcription.TranscribeAsync(audioPath, language, progress(int percent), cancellation, recordedAt, pausedDuration, settings.SpeakerDiarizationEnabled)`. Progress updates the status to `Status_TranscribingPercent` with the percent. Cancellation propagates; any other exception is kept.
4. `ResolveTranscriptionStage(liveDraft, offline, failed)`: non-blank offline transcript gives OfflineTranscript (apply `EnsureEndedHeader` and use it); else with a draft gives LiveDraft / LiveDraftAfterFailure (never reached here); else failed gives FailedWithoutTranscript (status `Error_TranscriptionFailedAudioKept` with the friendly message, terminal "saved without transcript"); else NoTranscript (`Error_NoTranscript`).
5. If the engine is not ready and there is no draft: terminal `Error_EngineNotReady`.
6. Save the record with the new transcript (highlight applicator applied with the empty highlight list) and with Summary=null, ActionItems=empty, SummaryProvider=null (the old summary is erased at this point).
7. Resolve the summary provider: if `settings.SelectedSummaryProvider` is blank, skip summarizing and finish with `Status_DoneNoSummary` (outcome TranscriptOnly). Else resolve through the gate for the selected kind (null result also finishes as TranscriptOnly).
8. Status `Status_GeneratingSummary`. Summarize with the provider using transcript, current title, recordedAt, summary language, EndedAt (null if default) and a `SummaryEnhancementContext(notes = record.Notes as captured at start, attendees, agenda = null, template instructions)`; the context is passed only if any part is non-blank.
9. New title = `SuggestedMeetingTitle.Resolve(title, result.SuggestedTitle)` (only replaces a placeholder title). Save with summary, action items and provider id. If the title changed, raise `MeetingChanged`.
10. Try the Jev analysis step and save it; cancellation here is swallowed and the summary stays saved.
11. Terminal `OnMeetingCompleted` (Completed).
12. Cancellation anywhere: if there is a transcript, save it (no summary) and report `Status_CancelledTranscriptSaved`; if none, report cancelled (`Status_ProcessingCancelled`).
13. Other exception: friendly message; if a transcript exists save it and report `OnSummaryFailedAfterTranscriptSaved` with `Status_TranscriptSavedSummaryFailed` formatted with the message; else `Error_ProcessRecording` terminal.

Record save fields (`SaveProcessedMeetingAsync`): a new record is built with Id, Title, RecordedAt, EndedAt (null if default), AudioFilePath, Transcript (stamped + highlights), Summary, ActionItems, SummaryProvider, FolderId, Notes (trimmed callbacks notes or null), calendar ids and join url (blank to null, trimmed), Attendees (non-blank, trimmed), Brief (request brief, else the existing brief), NoteTemplateId, FollowUp and ProjectPlan carried over from the existing record. Anything else on the old record (for example `JevAnalysis`) is not carried over.

### 3.8 CLI failure text (`CliFailureUserMessage.Format`)

Non-CLI exceptions give `exception.Message`. For CLI tool exceptions the text is a format of the provider display name using resw keys: NotInstalled `Error_CliNotInstalled`, NotSignedIn `Error_CliNotSignedIn`, SubscriptionInactive `Error_CliSubscriptionInactive`, TimedOut `Error_CliTimedOut`, EmptyOutput `Error_CliEmptyOutput`, anything else `Error_CliUnknown`; for Unknown with non-blank detail append a space and the detail.

## 4. Persistence and wire formats

### 4.1 Meeting file

One markdown file per meeting, `{id}.md`, in the user's meeting library (`MarkdownMeetingRepository`). Newlines `\n` when written; the reader accepts `\r\n`. A sibling `.wav` with the same base name is used as the audio path if the stored path is blank or the file is missing.

```
---
id: 3f2c0b8e-6a1d-4c55-9a2e-0b7f9d1c2a44
title: Weekly sync
recordedAt: 2026-10-01T22:36:00.0000000+00:00
endedAt: 2026-10-01T23:06:00.0000000+00:00
audioFilePath: C:\Users\x\Documents\MeetingLive\audio\take.wav
folderId: 9a8b7c6d-0000-4000-8000-000000000001
summaryProvider: local
calendarEventId: evt
calendarId: cal
seriesId: series
joinUrl: https://meet.example/x
noteTemplateId: template-1
attendees: Ana | Luis
headerEscaping: 1
---

## Brief

...

## Transcript

Recorded 2026-10-01 22:36
Ended 2026-10-01 23:06
[00:00.00-00:04.52] [ Speaker-1 ] Hola.

## Summary

...

## Action Items

...

## Jev

{ json }

## Personal Notes

...

## Follow-up

...

## Project plan

...
```

Rules relevant to this module:
- Frontmatter is split on the first `:` per line; keys trimmed; values trimmed. Required: `id` (Guid) and `recordedAt` (parsable), else a format error. `title` defaults to "". Optional keys are omitted when empty. `attendees` are joined by ` | `.
- Sections are written only when non-empty, in the fixed order above, each as a blank line, header, blank line, trimmed body. A section ends at the next of the eight known headers. Headers must match exactly (case-sensitive) on their own line.
- If any text section holds a line equal to a known header, the file gets `headerEscaping: 1` and such lines (and lines already looking escaped) get a trailing ` ##` suffix on write, removed on read. Files without the key are read literally.
- Rename only rewrites `title:`; the whole file is re-rendered from the in-memory record.

### 4.2 Settings

`settings.json` (camelCase, indented): `navigationPaneLength` (number, optional; absent means default 280; value is clamped to 200..480 on read), plus keys read by this module: `selectedSummaryProvider` (string enum name, e.g. `Local`, `ClaudeCode`, `Codex`, `Xai`; unparsable gives Local), `transcriptionLanguage`, `summaryLanguage`, `speakerDiarizationEnabled`. The settings service serializes read-modify-write access.

### 4.3 Workspace state (memory only)

`Workspace.SessionTab` (default `Transcript`), `SelectedMeetingId`, `LastProcessedMeeting`, `IsCaptureActive`, events `MeetingChanged(Guid)`, `ScopeChanged`, `MeetingDeleted(Guid)`. Nothing here is persisted.

### 4.4 Re-transcription result (in memory)

```
RetranscriptionResult { MeetingId: Guid, Outcome: Completed | TranscriptOnly | SummaryFailed | Cancelled | Failed, Message: string? }
```

## 5. Native and OS dependencies

| Item | Where | Classification |
|---|---|---|
| Clipboard write (plain text) | Copy | Portable (Electron `clipboard.writeText`) |
| Reveal file in Explorer (`explorer.exe /select,"path"`) | Open file location | Windows-only implementation; portable concept (`shell.showItemInFolder`, Finder on macOS) |
| Native `ContentDialog` (confirm/error/text-input) | Rename, re-transcribe, error | Replace with in-app modal; portable |
| Slide navigation transition between tabs | Tabs | Portable (CSS) |
| System resize cursor on the pane grip | Grip | Portable (CSS `col-resize` / `ew-resize`) |
| Pointer capture drag | Grip | Portable (pointer events) |
| Local speech engine (Nemotron/NeMo runtime) readiness check and transcription | Re-transcribe | Windows-only today (see local-inference research); sits behind the transcription interface |
| Audio file existence check | Availability | Portable |
| Summary providers: Local LLM, Claude Code CLI, Codex CLI, xAI | Suggest title, summary | Local model portable via runtime; CLIs portable if on PATH; xAI sign-in portable |
| Provider setup gates (model download dialog, CLI install dialog, xAI sign-in dialog) | Suggest title, re-transcribe | UI portable; gate logic portable |
| Dispatcher queue to UI thread | VM/runner | Not needed in Electron (marshal main to renderer through IPC) |
| Markdown file store with sibling `.wav` fallback | Load | Portable (paths differ per OS; sibling lookup uses extension swap) |
| Windows theme/Fluent controls (SelectorBar, InfoBar, NavigationView) | UI | Windows-only look; recreate in web UI |

## 6. Existing test coverage

Test project: `MeetingLive.Core.Tests/Services`. There are no tests for the App-layer classes in this module (SessionPageViewModel, TranscriptPageViewModel, MeetingRetranscriptionRunner, PaneResizeGrip, the page code-behind). Those behaviors must get new tests in the port.

`MeetingRetranscriptionTests` (carry over all):
- `Evaluate_AudioExistsAndIdle_IsAvailable`
- `Evaluate_AudioFileMissing_IsNoAudio`
- `Evaluate_BlankAudioPath_IsNoAudioWithoutProbingTheDisk` (theory: "" and "   ")
- `Evaluate_NullRecord_IsNoAudio`
- `Evaluate_AudioExistsButBusy_IsBusy`
- `Evaluate_ChecksTheRecordedAudioPath`
- `CreateRequest_DropsLiveDraftSoTheOfflinePassBecomesTheTranscript`
- `CreateRequest_KeepsMeetingContextSoTheSavedRecordDoesNotLoseIt`
- `CreateRequest_MissingEndedAt_UsesDefaultSoThePipelineTreatsItAsUnknown`

`SuggestedMeetingTitleTests` (carry over all): `Normalize_WhenMissingOrWhitespace_ReturnsNull`, `Normalize_WhenMultipleLines_UsesFirstNonEmptyLine`, `Normalize_WhenLeadingMarkdownHashes_StripsThem`, `Normalize_WhenWrappedInQuotes_StripsWrappingQuotes`, `Normalize_WhenTrailingPeriod_StripsIt`, `Normalize_WhenLongerThan80Characters_Truncates`, `Normalize_WhenEmptyAfterCleaning_ReturnsNull`, `LooksLikePlaceholder_MatchesAutoGeneratedMeetingDateTitles`, `FromModelResponse_WhenPlainOneLineTitle_ReturnsNormalizedTitle`, `FromModelResponse_WhenWrappedInTitleHeading_ReturnsBodyNotHeading`, `FromModelResponse_WhenTitleBlockThenSummary_ReturnsTitleBody`, `FromModelResponse_WhenQuotedPlainTitle_StripsQuotesAndPeriod`, `FromModelResponse_WhenEmpty_ReturnsNull`, `FromModelResponse_WhenHeadingOnly_ReturnsNull`, `Resolve_WhenSuggestedIsNull_ReturnsCurrentTitle`, `Resolve_WhenCurrentIsPlaceholder_ReturnsNormalizedSuggestion`, `Resolve_WhenCurrentIsEmpty_ReturnsNormalizedSuggestion`, `Resolve_WhenCurrentIsUserNamed_KeepsCurrentTitle`, `Resolve_WhenSuggestedNormalizesToNull_ReturnsCurrentTitle`.

`RecordingPipelineRulesTests` (carry over all): `ShouldSaveBeforeTranscribing_NewTakeWithoutDraft_SavesSoAFailedPassKeepsTheAudio`, `ShouldSaveBeforeTranscribing_TakeWithDraft_Saves`, `ShouldSaveBeforeTranscribing_LinkedMeetingWithOtherAudio_SavesSoTheNewAudioIsNotOrphaned`, `ShouldSaveBeforeTranscribing_RetranscribeOfSavedAudio_LeavesThePreviousTranscriptAlone`, `ResolveTranscriptionStage_ReportsWhatTheMeetingEndsUpWith`.

`TranscriptStampFormatterTests` (carry over all): `FormatHeader_UsesLocalRecordedStamp`, `FormatLine_WhenSpeakerTagIsZero_OmitsSpeakerBracket`, `FormatLine_WhenSpeakerTagIsPositive_IncludesSpeakerBracket`, `FormatLine_NegativeElapsed_ClampsToZero`, `FormatLine_WhenEndIsBeforeStart_UsesStartForEnd`, `FormatLine_WhenMinutesExceed59_KeepsTotalMinutes`, `FormatEnded_UsesLocalEndedStamp`, `EnsureEndedHeader_WhenRecordedHeaderExists_InsertsEndedAsSecondLine`, `EnsureEndedHeader_WhenEndedHeaderExists_ReplacesSecondLine`, `EnsureEndedHeader_WhenCalledTwice_DoesNotDuplicateEnded`, `EnsureEndedHeader_WhenTimestampsAreDefault_ReturnsTranscriptUnchanged`, `EnsureEndedHeader_WhenRecordedHeaderIsMissing_PrependsRecordedAndEnded`.

`TranscriptHighlightApplicatorTests` (carry over all): `Apply_WhenNoHighlights_ReturnsTranscriptUnchanged`, `Apply_WhenTranscriptEmpty_WritesMarkLines`, `Apply_WhenMarkFallsInsideLine_PrefixesThatLine`, `Apply_WhenLineAlreadyMarked_DoesNotDoublePrefix`, `Apply_WhenMarkIsBetweenLines_StarsThePreviousLine`, `Apply_WhenTwoMarksHitTheSameLine_StarsOnce`.

`MeetingMarkdownFormatterTests` (carry over all, they define the file format): `RenderThenParse_RoundtripsAllFields`, `Render_WhenOptionalFieldsAreEmpty_OmitsTheirFrontmatterAndSections`, `RenderThenParse_RoundtripsBriefTemplateAndDrafts_AndOmitsThemWhenEmpty`, `RenderThenParse_RoundtripsCalendarLink_AndOmitsItWhenUnset`, `Parse_FileWithoutCalendarFields_LeavesThemUnset`, `RenderThenParse_RoundtripsJevAnalysis`, `Parse_MissingOpeningDelimiter_ThrowsFormatException`, `Parse_MissingId_ThrowsFormatException`, `RenderThenParse_WhenNotesHoldASectionHeaderLine_KeepsEveryLineAndInventsNoSection`, `RenderThenParse_WhenEveryTextSectionHoldsHeaderLines_KeepsEachSectionUnchanged`, `RenderThenParse_WhenTrimmingExposesAHeaderLine_KeepsTheLine`, `RenderThenParse_WhenTheBodyUsesCrLf_StillProtectsTheHeaderLine`, `RenderThenParse_WhenContentAlreadyLooksEscaped_RemainsUnchanged`, `Render_WhenAHeaderLineIsEscaped_StaysAReadableMarkdownHeading`, `Render_WithoutHeaderLinesInContent_ProducesTheExistingFormatByteForByte`, `Parse_ExistingFileWithAHeaderLineInNotes_StillSplitsItTheOldWay`.

Also present and related: `MarkdownMeetingRepositoryTests`, `TranscriptLineIndexTests` (line splitting used by chat/TypeSafe, not by this page), `AppSettingsTests` (pane length clamping and defaults; carry the `NavigationPaneLength` cases).

New tests needed (no coverage today): rename rules (3.3), `SuggestTitleAsync` branching (silent null, error text, titleChanged notification), `CanRename`/`CanSuggestTitle`/`CanRetranscribe` truth tables, runner outcome precedence (3.7 / 2.9), copy no-op on whitespace, copy confirmation timer restart, pane clamp 200..480 and persistence.

## 7. Bugs, races and uncovered cases

Evidence uses `file:line` from the current tree. "Confirmed" means the behavior follows directly from the code read; "suspected" means it depends on runtime ordering or other modules.

1. **Confirmed. Re-transcription drops highlights.** `MeetingLive.Core/Services/MeetingRetranscription.cs:48` passes `Highlights: []`, and the saved transcript is replaced by a new offline transcript, so every `* ` star the user created while recording is lost.
2. **Confirmed. Re-transcription erases the old summary before a new one exists.** `RecordingPipelineOrchestrator.cs:129` saves the new transcript with `summary: null, actionItems: []`. If no summary provider is selected (`SelectedSummaryProvider` blank), the provider gate is declined, or summarization fails, the previous summary and action items are gone. The confirm dialog only says the summary will be regenerated; it does not warn that it can end up empty. Port fix: keep the old summary until a new one is saved, or warn.
3. **Confirmed. `JevAnalysis` is dropped.** `SaveProcessedMeetingAsync` (`RecordingPipelineOrchestrator.cs:~270-306`) builds a fresh record without `JevAnalysis`, so the saved file loses the `## Jev` section until the Jev step runs again (and permanently when no summary provider runs).
4. **Confirmed. Rename and Suggest title are lost, and notes are overwritten, during a re-transcription.** `SessionPageViewModel.cs:142` allows rename while `IsRetranscribing`. The pipeline captured `request.Title` and `Notes` at start (`RecordingPipelineOrchestrator.cs:284,295`, runner `_notes` at `MeetingRetranscriptionRunner.cs:68`) and later saves a record built from those, overwriting a title changed in the meantime. Port fix: disable rename/suggest while a run targets this meeting, or have the pipeline reload the title at each save.
5. **Suspected. `PausedDuration` is always zero on re-transcription** (`MeetingRetranscription.cs:46`). If the transcription service uses it to align timestamps of recordings that were paused, re-transcribed timestamps differ from the original. Depends on the transcription module.
6. **Confirmed. Session page mixes two sources of "current meeting".** The view model uses the id it loaded; the page reloads tabs with `Workspace.SelectedMeetingId` (`SessionPage.xaml.cs:31,81,99,145`). If the selection changes while the page is open (for example the Record page finishes a meeting and calls `SetLastProcessed`, or `TranscriptPage.LoadAsync` selects the latest meeting at `TranscriptPageViewModel.cs:38`), tab reloads can show a different meeting than the header. Port fix: use one id source.
7. **Confirmed. Completion feedback is lost when the user navigates away.** `Detach()` unsubscribes from `Finished` (`SessionPageViewModel.cs:~31`), and the runner does not retain the last result; a run that ends while the user is on another page leaves no notice or error. Returning to the page only re-syncs the running flag.
8. **Confirmed. Transcript tab flashes the empty state.** `TranscriptPageViewModel._isLoading` defaults to false (`TranscriptPageViewModel.cs:12-16`) and loading is started without awaiting (`TranscriptPage.xaml.cs:~24`), so `IsEmpty` is true for the first frame and the "no transcript" message appears briefly. The session view model defaults `IsLoading` to true, so only the tab flashes.
9. **Suspected. Unobserved load failures.** `_ = ViewModel.LoadAsync(...)` (`TranscriptPage.xaml.cs:~24`) discards the task; a repository exception would be unobserved and the ring would stop (finally) with no error shown. `SessionPageViewModel.LoadAsync` is awaited in an `async void` handler, so exceptions there reach the UI thread's unhandled-exception path.
10. **Confirmed. Transcript tab does not refresh on mid-run saves.** The runner raises `MeetingChanged` on every save (`MeetingRetranscriptionRunner.cs:141`) but only the session header listens; the tab reloads only at the end. The old transcript stays visible until completion.
11. **Confirmed. `Rename` raises no `MeetingChanged`** (`SessionPageViewModel.cs:179-203`), while the suggested-title path does (`:251`). Anything other than the session header that caches titles (library lists, chat scope) only updates on its own reload. Port fix: raise it in `RenameAsync`.
12. **Confirmed (minor). Suggest-title state handling.** `IsSuggestingTitle` is reset through a queued call (`SessionPageViewModel.cs:258`), so the buttons stay disabled for one extra dispatcher turn; the `TryEnqueue(() => Title = next)` at `:250` is redundant because `RenameAsync` already set Title; the changed-check at `:244` compares the on-disk title while `RenameAsync` compares the in-memory VM title (`:187`), so the two can disagree when the title changed elsewhere (then nothing is saved but `Applied` is still true).
13. **Confirmed. Silent no-ops without feedback.** Open file location with a missing path (`SessionPageViewModel.cs:113-118`), copy of empty text (`:82-83`), suggest title with a gated provider declined (`SessionPageViewModel.cs:~222`), and re-transcribe when the audio vanished (`:~311`, button just disappears) show no message. Rename dialog with an empty name just refuses to close, with no hint.
14. **Confirmed (minor). Notice info bar never auto-closes**, while the copy bar closes after 2.5 s. Both can be dismissed manually.
15. **Confirmed (minor). Slide direction quirks.** `SessionPage.xaml.cs:~175-185`: the previous index starts at 0 and `SelectTab` does not update it; same-tab reloads always slide from the left.
16. **Suspected. Busy flag crosses meetings.** Starting a run for meeting A disables re-transcribe on meeting B, and `IsCaptureActive` disables it while recording. This is intended by the doc comments, but no message explains why the button is greyed.
17. **Suspected. Cross-thread property writes.** `Workspace.ScopeChanged` handlers call `SyncRetranscriptionState` directly (`SessionPageViewModel.cs:~318`); if any publisher raises it from a background thread the observable properties change off the UI thread. `IsCaptureActive` is set from the Record view model (UI thread) today.
18. **Suspected. Runner cancellation window.** `Complete()` checks `_cts.IsCancellationRequested` only after `_completed`/`_failure`; a cancel pressed after the final save but before `Complete` runs is reported as Completed (correct), but one pressed between a failed transcription and `Complete` is reported as Failed. Low impact.
19. **Confirmed. Dead code and resources.** `TranscriptPageViewModel.Title` and the `NoTranscriptsYet` fallback are never displayed; `TranscriptPage_Title.Text` and `TranscriptPage_Notes.*` resources are unused; the `null` id branch of `TranscriptPageViewModel.LoadAsync` is unreachable from the session page. Do not port as features.
20. **Uncovered cases the port should handle:** meeting deleted while the page is open (`Workspace.MeetingDeleted` is not observed here); transcript text very large (a single text block with no virtualization); audio file present but unreadable/corrupt; re-transcribing a meeting with a transcript that has no audio path but a sibling `.wav` (handled by the loader fallback, not by `Evaluate` on a manually edited record); copy while the transcript is being replaced; title containing characters that need escaping in frontmatter (only CR/LF are flattened).
21. **Not present, flagged.** No audio playback, no click-to-seek, no highlight styling, no transcript search or edit. If the product wants these in the Electron app, they are new features, not parity.

## 8. Parity checklist

Each line is one behavior to verify in the port.

Page and lifecycle
1. Session page receives a meeting id; falls back to the workspace selected meeting id when none is passed.
2. Loading state shows a centered progress ring; initial state is loading.
3. Empty state (no meeting) shows `SessionPage_Empty` text and the `SessionPage_EmptyCta` button; header actions and tabs are hidden.
4. The empty-state button navigates to the Record destination.
5. `LoadAsync` sets Title, HasMeeting, HasTranscript, HasAudio from the record; missing record gives empty title and HasMeeting false.
6. HasTranscript is false for whitespace-only transcripts.
7. HasAudio is true only when the audio path is non-blank and the file exists.
8. Loading state is cleared even when loading throws.
9. Re-transcription state is synced right after load.
10. When no meeting loads, the inner content is cleared.
11. After load the stored session tab is selected without triggering a navigation from the selection handler.
12. Leaving the page unsubscribes from MeetingChanged, ScopeChanged, runner StateChanged and runner Finished.
13. A MeetingChanged for the open meeting refreshes title, HasMeeting, HasTranscript, HasAudio; events for other ids are ignored.
14. The refresh re-checks the id after the async read (stale results discarded).

Tabs
15. Two tabs in order: Transcript (document icon) and Summary (sparkle icon), localized labels.
16. Tab bar is hidden when no meeting is loaded.
17. Only the names `Transcript` and `Summary` are valid; others are rejected; default is Transcript.
18. User tab selection is stored in the workspace and used as the initial tab for the next opened meeting.
19. Tab selection navigates the inner content for the workspace selected meeting.
20. Inner navigation keeps no back stack.
21. Tab change uses a horizontal slide: from right when moving to a higher index, else from left.
22. Inner content is reloaded after rename success, suggested title applied, and re-transcription finished.
23. Entry points choose the initial tab: Library row opens Transcript; Library summary action, deep link and tasks dialog open Summary; Record finish opens Summary if a summary exists else Transcript.

Header
24. Back button returns to the Library destination.
25. Title is shown single-line, ellipsized, max width 720 px, only when a meeting is loaded.
26. Rename button enabled iff meeting loaded and not suggesting a title.
27. Rename opens a dialog with title, labeled text box (header and placeholder), prefilled with the current title.
28. Rename dialog primary button is default; buttons are `SessionRename_Primary` and `SessionRename_Cancel`.
29. Rename dialog cannot be confirmed with an empty or whitespace-only name.
30. Rename trims the input.
31. Rename to the same title is a successful no-op with no write.
32. Rename saves the entire record with the new title and keeps the file name `{id}.md`.
33. Rename updates the in-memory title and the last-processed meeting title when it is the same meeting.
34. Rename returns false for missing record or no meeting.
35. Successful rename reloads the inner tab.
36. Suggest-title button enabled iff meeting loaded, has transcript, not already suggesting.
37. Suggest title shows a 20 px progress ring while running and disables Rename and Suggest.
38. Suggest title does nothing (silently) for a missing record or blank transcript.
39. Suggest title uses the configured summary provider kind (default Local when unset or invalid).
40. Suggest title passes through the provider readiness gate; a declined gate aborts silently.
41. Suggest title uses the summary language setting (default `es`).
42. Suggest title sends the exact title-only prompt (section 2.3) with recorded-at in ISO 8601 and the language name.
43. Local provider title inference is capped at 80 tokens, temperature 0.3.
44. Provider exceptions produce an error dialog with the friendly CLI message.
45. Error dialog uses `SessionSuggestTitle_ErrorTitle`, the message, and an OK-only close button.
46. Model response is parsed with FromModelResponse (heading block, quotes, trailing period, 80-char cap, first non-empty line).
47. Unusable model response gives `SessionSuggestTitle_Empty` in the error dialog.
48. Suggested title is always applied (not only when the current title is a placeholder).
49. When the title actually changed, MeetingChanged is raised.
50. `IsSuggestingTitle` is always reset, including on error.
51. Applied suggested title reloads the inner tab.

Copy
52. Copy button is shown when a meeting is loaded.
53. Copy asks the active tab for its copy text through the shared `GetCopyText` contract; tabs without it do nothing.
54. Transcript tab copy text is the full raw transcript when it has content, else null.
55. Summary tab copy text comes from the summary module (hosted contract only).
56. Empty or whitespace copy text copies nothing and shows nothing.
57. Copy writes plain text to the system clipboard.
58. A success bar "Copied / Copied to the clipboard." appears after a copy.
59. The bar closes automatically after 2.5 s; a new copy restarts the timer.
60. The user can dismiss the bar manually.

Open location
61. Open-file-location reveals the meeting's markdown file in the system file manager with the file selected.
62. Does nothing when the meeting, path or file is missing.
63. Windows uses `explorer.exe /select`; macOS must use Finder reveal (behind an interface).

Transcript tab
64. Receives a meeting id; loads the record by id.
65. Null id loads the most recent meeting by recorded date (unreachable from session page; optional).
66. Loading selects the loaded meeting in the workspace.
67. Loading shows a centered progress ring.
68. Transcript text is `record.Transcript ?? ""`; content state is non-whitespace.
69. Empty state shows `TranscriptPage_Empty` and an accent `TranscriptPage_EmptyCta` button that navigates to Record.
70. Content state shows the raw transcript in a wrapping, selectable text area inside a vertical scroller, no horizontal scroll, 24 px padding.
71. Header lines `Recorded ...` and `Ended ...` are displayed as stored.
72. Timestamp line format `[mm:ss.ff-mm:ss.ff]` with optional `[ Speaker-N ]` is displayed verbatim.
73. Starred lines show a literal `* ` prefix with no special styling.
74. Selecting part of the transcript text and copying it works with the standard selection.
75. Transcript tab is the default tab.

Highlights
76. Marks are clamped to >= 0, de-duplicated and sorted.
77. No marks returns the transcript unchanged.
78. Empty transcript gets one `* mm:ss.ff` line per mark.
79. A mark inside a line's inclusive range stars that line.
80. A mark between lines stars the previous line; before all lines stars the first timestamped line.
81. Multiple marks on one line star it once; an already starred line is not double-prefixed.
82. Transcript with no timestamped lines gets `* mm:ss.ff` lines appended.
83. Newline style (`\r\n` or `\n`) is preserved.
84. Lines are matched with `^\[(\d+):(\d{2}\.\d{2})-(\d+):(\d{2}\.\d{2})\]` after removing one leading `* `.

Transcript stamps
85. Recorded/Ended headers use local time, `yyyy-MM-dd HH:mm`, invariant culture.
86. EnsureEndedHeader: no-op for empty transcript or default timestamps; inserts or replaces line 2; prepends both headers when Recorded is missing; idempotent; preserves newline style.
87. Elapsed format: total minutes (2+ digits), seconds, hundredths truncated; negatives clamp to zero.
88. Line format: end clamps to start when earlier; speaker tag shown only when > 0.

Re-transcribe availability
89. Button visible only when the audio file exists.
90. Button enabled only when meeting loaded, audio exists and nothing is busy.
91. Busy means a re-transcription is running (any meeting) or the Record page is capturing/processing.
92. `Evaluate`: null record or blank/whitespace path gives NoAudio without touching the disk.
93. `Evaluate`: missing file gives NoAudio; present file and busy gives Busy; present and idle gives Available.
94. `Evaluate` checks audio before busy.
95. `Evaluate` probes exactly the recorded audio path.
96. Click re-checks `CanRetranscribe` before showing the dialog.
97. Confirm dialog uses title, meeting-title-formatted content, `Re-transcribe`/`Cancel` buttons, default button is Cancel.
98. Content warns that the transcript is replaced, the summary is regenerated and summary edits are lost.
99. Declining the dialog does nothing.
100. After confirmation the record is re-read and availability re-evaluated; if no longer Available, HasAudio is refreshed and nothing starts.
101. Starting clears the error and notice bars.

Re-transcribe request and pipeline
102. The request has no live draft, empty highlights, zero paused duration, no agenda.
103. The request keeps id, audio path, recorded-at, title, folder, calendar event/calendar/series ids, join URL, attendees, brief, template id.
104. Missing ended-at is passed as the default (unknown) value.
105. Template instructions resolve from the template id (null id gives null; custom id loads user instructions trimmed; other ids use the built-in catalog).
106. Nothing is saved before transcription when the audio path is unchanged (previous transcript untouched until the new one succeeds).
107. Transcription language comes from settings (default `es`); diarization comes from the speaker diarization setting.
108. Progress is reported as integer percent into `Status_TranscribingPercent`.
109. Engine not ready and no draft gives `Error_EngineNotReady` and the Failed outcome.
110. Offline pass failing gives `Error_TranscriptionFailedAudioKept` with the friendly message.
111. Offline pass returning nothing gives `Error_NoTranscript`.
112. New transcript gets the Ended header ensured and is saved with summary cleared.
113. Summary is skipped (TranscriptOnly, `Status_DoneNoSummary`) when no summary provider is selected or the gate is declined.
114. Summary uses transcript, title, recorded-at, summary language, ended-at (null when unknown) and the enhancement context (notes captured at start, attendees, template instructions).
115. Enhancement context is omitted when all its parts are blank.
116. New title replaces the old one only when the old one is blank or matches `^Meeting\s+\d`.
117. If the title changed, MeetingChanged is raised.
118. Saved record carries notes (trimmed), brief (request or existing), follow-up and project plan from the existing record, and clears summary until the new one is saved.
119. Jev analysis is attempted after the summary; cancellation there keeps the summary.
120. Cancellation with a transcript present saves it and reports `Status_CancelledTranscriptSaved`; without one reports `Status_ProcessingCancelled`.
121. Other errors with a transcript save it and report `Status_TranscriptSavedSummaryFailed` (SummaryFailed outcome); without a transcript report `Error_ProcessRecording`.
122. CLI failure messages map kind to the `Error_Cli*` keys, with detail appended for Unknown.

Runner
123. One run at a time app-wide; a second start returns false.
124. The run survives navigating away from the session page.
125. Start sets running, meeting id, status `Status_Transcribing`, captures notes, resets flags, creates a fresh cancel token, raises StateChanged.
126. Cancel before the pipeline starts writes nothing.
127. Non-cancel exceptions before or during the pipeline become the Failed message.
128. Every intermediate save raises MeetingChanged.
129. Terminal step is queued after pending progress callbacks.
130. Outcome precedence: SummaryFailed, then Failed, then Completed, then Cancelled, then TranscriptOnly.
131. `OnFinished` records a failure message only when cancellation was not requested.
132. After completion the runner resets running, meeting id and status, raises StateChanged, then Finished.
133. Events are delivered on the UI thread.

Re-transcribe UI
134. The progress block is visible only while the open meeting is the one being re-transcribed.
135. Status text is a polite live region and tracks the runner status.
136. Progress bar is indeterminate with an accessible name.
137. Cancel button calls the runner's cancel and has an accessible name.
138. Finished for another meeting is ignored.
139. Failed and SummaryFailed show the error bar with the message.
140. Cancelled shows the notice `SessionRetranscribe_Cancelled`.
141. TranscriptOnly shows `SessionRetranscribe_DoneNoSummary`.
142. Completed shows `SessionRetranscribe_Done`.
143. After every outcome the inner tab reloads.
144. Error and notice bars stay open until dismissed or the next run starts.

Pane grip (shell)
145. Grip is 8 px wide, transparent, full height, shows a west-east resize cursor.
146. Visible only in expanded mode with the pane open; refreshed on mode, open and close changes.
147. Positioned at pane width minus 4 px; repositioned on every resize.
148. Pointer press starts a drag, captures the pointer, records start X and start width.
149. Drag width = start width + delta clamped to 200..480, applied live.
150. Release or capture loss ends the drag, releases capture and persists the width to settings.
151. Persisted value is `navigationPaneLength`; reading clamps to 200..480; unset gives 280.
152. Press, move and release events are marked handled.

Persistence and strings
153. Meeting file frontmatter and section order exactly as in section 4.1; optional fields omitted when empty.
154. Frontmatter parsing splits on the first colon only; id and recordedAt required.
155. Title newlines are flattened to spaces on write.
156. Header-escaping behavior for section header lines inside text sections is preserved byte for byte.
157. Sibling `.wav` fallback when the stored audio path is blank or missing.
158. All strings in section 2.12 exist in English and Spanish with the same keys and placeholders.
159. Automation ids in section 2.11 are kept.
160. Existing unit tests listed in section 6 are ported and pass.
