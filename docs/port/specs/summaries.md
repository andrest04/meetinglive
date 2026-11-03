# Summaries module: behavior spec

Source: `MeetingLive.Core` and `MeetingLive.App` on branch `feat/electron-port` (read 2026-11-02). Every claim below comes from reading those files or the cited tests. "Confirmed" means shown by code reading alone, "suspected" means it needs a runtime check. Nothing was run against the user's real data.

Conventions used in this document:

- `Core/...` is `MeetingLive.Core/...`, `App/...` is `MeetingLive.App/...`, `Tests/...` is `MeetingLive.Core.Tests/...`.
- String keys are quoted as `Key`. Core keys live in `Core/Strings/CoreStrings.resx` (English) and `CoreStrings.es.resx`. App keys live in `App/Strings/en-us/Resources.resw` and `App/Strings/es/Resources.resw`. The English text is quoted in section 2.9. The Spanish files hold the same keys.
- "Provider" means an implementation of `ISummaryProvider`. Provider ids persisted in a meeting file are `local`, `claude-code`, `codex`, `xai`.

---

## 1. Purpose

The module turns a meeting transcript into three things:

1. A Markdown summary body.
2. A checklist of action items.
3. An optional short suggested meeting title.

It does so through one of four interchangeable engines, chosen once in Settings:

| Kind (enum name, stored in settings) | Provider id | How it runs |
|---|---|---|
| `Local` | `local` | In-process llama.cpp (LLamaSharp 0.27.0, CPU backend only) over a downloaded GGUF file. |
| `ClaudeCode` | `claude-code` | Spawns the user's installed `claude` CLI, prompt on stdin. |
| `Codex` | `codex` | Spawns the user's installed `codex` CLI, prompt on stdin. |
| `Xai` | `xai` | HTTPS to `api.x.ai` with SuperGrok OAuth (device code) or a pasted API key. |

All four are asked to emit the same three-section Markdown contract (`## Title`, `## Summary`, `## Action Items`). One shared splitter parses the reply, so nothing downstream branches on the engine.

The module also owns: the Summary tab (view, generate, regenerate, edit raw notes, toggle action items, copy), the note templates (built-in plus one custom), the first-run setup wizard (engine choice, hardware detection, model catalog, download), the CLI setup dialog, the xAI sign-in dialog, the Settings "summary provider" section, title-only suggestion, and the generic "run this prompt" and "stream this prompt" entry points that chat features reuse.

Out of scope here, but called from this module (see section 5.3 for the cross-module list): meeting persistence, the recording pipeline, Jev analysis, chat, transcript polishing, the Settings page shell, the local-model management list in Settings.

---

## 2. User-facing features

### 2.1 Provider contract (`ISummaryProvider`, `Core/Services/ISummaryProvider.cs`)

Four operations. Every provider implements the first three. The fourth has a default.

| Operation | Inputs | Output |
|---|---|---|
| `SummarizeAsync` | transcript, title, recordedAt, cancellation, outputLanguage (nullable), endedAt (nullable), enhancement (nullable) | `SummaryResult { SummaryMarkdown, ActionItems, ProviderId, SuggestedTitle? }` |
| `SuggestTitleAsync` | transcript, recordedAt, cancellation, outputLanguage | raw model text. The caller runs `SuggestedMeetingTitle.FromModelResponse` (always applies). |
| `CompletePromptAsync` | an already-built prompt, cancellation | raw model text |
| `StreamPromptAsync` | prompt, cancellation | async stream of text chunks. Default implementation yields the whole `CompletePromptAsync` result once. Only `LocalLlmSummaryProvider` and `XaiSummaryProvider` override it with real streaming. CLI providers use the default (one chunk at the end). |

Concatenating all chunks of `StreamPromptAsync` equals the full answer.

`SummaryResult.SuggestedTitle` is parsed from the same response as the summary. There is never a second inference for the title on the summarize path.

### 2.2 Summary tab (`App/SummaryPage.xaml`, `SummaryPage.xaml.cs`, `ViewModels/SummaryPageViewModel.cs`)

#### Layout

Page padding 24,16,24,24, row spacing 12. Four rows: toolbar, related meetings, draft InfoBar, content. Content column is capped at 880 px wide.

Toolbar, left side: a two-item selector bar, "My notes" (`NotesMode_MyNotes.Text`) and "Enhanced" (`NotesMode_Enhanced.Text`). "Enhanced" is selected by default. The bar is visible only when a meeting is loaded (`HasMeeting`).

Toolbar, right side, in order:

1. Status text, max width 240 px, ellipsis trimmed, tooltip shows the full text, secondary text colour. Together with the next two items it is visible only when `ShowSummaryActionBar`.
2. Progress ring 20x20, active while `IsGenerating`.
3. "Generate summary" accent button (`SummaryPage_Generate.Text`), visible when `CanGenerateSummary`. Automation id `BtnGenerateSummary`.
4. "Regenerate" button (`SummaryPage_RegenerateLabel.Text`), visible when `CanRegenerateSummary`. Automation id `BtnRegenerateSummary`.
5. Note-template combo box, width 200, accessible name and tooltip "Note template" (`SummaryPage_NoteTemplateCompact.*`), visible when `ShowNoteTemplate`. Items show `DisplayName`. Automation id `CmbSummaryNoteTemplate`.
6. "More options" button (40x32, `SummaryPage_More.*`), visible when `ShowNoteTemplate`, opens a flyout aligned bottom-right with two items:
   - "Save as custom template" (`SummaryPage_MoreSaveTemplate.Text`, id `BtnSaveSummaryCustomTemplate`).
   - "Copy action items" (`SummaryPage_MoreListActions.Text`, id `BtnListActions`), visible when `ShowDraftActions`, enabled when `HasSummary && !IsGenerating`.

Related meetings strip (row 1), visible when there is at least one: caption "Related meetings" (`SummaryPage_RelatedMeetings.Text`), then a horizontally scrolling list, no selection, item click enabled. Each item: title (max width 220, ellipsis) over a caption date label. Clicking selects that meeting in the workspace and opens the Summary tab of the session. At most 5 items (`MaxRelatedMeetings = 5`). The matching rule lives in `RelatedMeetings.Find` (another module): other meetings sharing the calendar series or the exact title.

Draft InfoBar (row 2): open when `DraftMessage` is non-empty, not closable, severity Error when `IsDraftError` else Success, message is `DraftMessage`. Its title is the fixed resource `SummaryPage_DraftError.Title` = "Could not create the draft", shown for success messages too (see bug B16).

Content (row 3), a grid that stacks:

- Raw notes editor, visible when `IsShowingNotes`: multi-line wrapped text box, header "Your notes" (`SummaryPage_Notes.Header`), placeholder "Add your notes for this meeting" (`SummaryPage_Notes.PlaceholderText`), two-way bound, updates on every keystroke. Id `TxtMeetingNotes`.
- Enhanced view, visible when `ShowEnhancedChrome` (not showing notes):
  - Progress ring 32x32 centered, active while `IsLoading`.
  - Empty state, visible when `IsEmpty`: text "There's no summary yet. Record or import a meeting, or generate one from its transcript." (`SummaryPage_Empty.Text`, centered, max 360) and an accent button "Record a meeting" (`SummaryPage_EmptyCta.Content`) that navigates to the Recording page.
  - Scrollable summary, visible when `HasSummary`: the summary rendered as Markdown (`TxtSummaryContent`), wrap whole words, transparent background. Below it, when action items exist, a bold heading "Action items" (`SummaryPage_ActionItems.Text`) and one checkbox per item (content = item text, two-way bound to done state, bottom margin 8, id `ListActionItems`).

Page title resource `SummaryPage_Title.Text` = "Summary" exists in resources (used by the shell, not rendered on this page).

#### Computed state

| Property | Rule |
|---|---|
| `HasSummary` | `Summary` is not null/whitespace |
| `hasTranscript` (local) | record exists and its transcript is not null/whitespace |
| `CanGenerateSummary` | `hasTranscript && !HasSummary` |
| `CanRegenerateSummary` | `hasTranscript && HasSummary` |
| `ShowEnhancedChrome` | `!IsShowingNotes` |
| `ShowNoteTemplate` | `(CanGenerateSummary \|\| CanRegenerateSummary) && ShowEnhancedChrome` |
| `ShowSummaryActionBar` | same expression as `ShowNoteTemplate` |
| `ShowDraftActions` | `HasSummary && ShowEnhancedChrome` |
| `IsEmpty` | `!IsLoading && !HasSummary && !CanGenerateSummary` |
| `HasActionItems` | action item collection count > 0 |
| `CanExecuteGenerate` | `CanGenerateSummary && !IsGenerating` |
| `CanExecuteRegenerate` | `CanRegenerateSummary && !IsGenerating` |
| `CopyText` | text shown on this tab: `Notes` when `IsShowingNotes`, else `Summary`. Null when blank. Exposed to the session-level "copy" command (`ISessionCopySource.GetCopyText`). |

Note: a meeting with a summary but no transcript has `HasSummary` true and both Can flags false, so the action bar and template picker are hidden.

#### Load (`LoadAsync(Guid? meetingId)`)

Called on navigation. The id is the navigation parameter if it is a `Guid`, else the workspace's selected meeting id (may be null).

1. `IsLoading = true`.
2. Record = repository `GetByIdAsync(id)` when an id is given, else the most recent by `RecordedAt` over `GetAllAsync()`. May be null.
3. If a record was found, tell the workspace to select it.
4. `HasMeeting = record != null`. `Notes = record.Notes ?? ""`. `IsShowingNotes = false`.
5. `Title = record.Title`, or "No summaries yet" (`NoSummariesYet`) when there is no record.
6. `Summary = record.Summary ?? ""`. Derive `HasSummary`, `CanGenerateSummary`, `CanRegenerateSummary` as above.
7. Clear `StatusText` and `DraftMessage`.
8. `SelectedNoteTemplateId = record.NoteTemplateId`, or `auto` when null/blank (also when no record).
9. Load the template list (built-ins plus custom if saved), load related meetings, rebuild the action item list.
10. Finally (always): `IsLoading = false`, refresh command states.

After load the page code selects the combo item whose id equals `SelectedNoteTemplateId`, else the first item, with a re-entrancy guard so this programmatic selection does not write back.

#### Generate and Regenerate (`GenerateSummaryAsync`)

Preconditions: not already generating and the loaded record has a non-empty transcript. Otherwise silent no-op.

Regenerate first calls `ConfirmRegenerateAsync`. If the callback is missing or returns false, nothing happens. The dialog is a confirm dialog: title "Replace this summary?" (`SummaryRegenerate_Title`), content `SummaryRegenerate_Content` = "Regenerating will overwrite the summary and action items for "{0}"." with `{0}` = the page title, primary button "Regenerate" (`SummaryRegenerate_Primary`), close button "Cancel" (`SummaryRegenerate_Cancel`), default button Close. Only the primary result proceeds.

Steps:

1. `IsGenerating = true`, `StatusText = "Generating summary..."` (`Status_GeneratingSummary`).
2. Load settings. Provider kind = `ResolveSummaryProviderKind()` (see 4.1).
3. Resolve the provider through the readiness gate (2.7). If the gate returns nothing, `StatusText = "Setup cancelled."` (`Status_SetupCancelled`) and stop. The final block still runs.
4. `summaryLanguage = settings.ResolveSummaryLanguage()` (default `es`).
5. `templateId = NoteTemplateCatalog.NormalizeId(SelectedNoteTemplateId)` (null for `auto`/blank). `instructions = NoteTemplateInstructions.ResolveAsync(templateId, store)`.
6. Build `SummaryEnhancementContext(RawNotes = record.Notes, Attendees = record.Attendees, Agenda = null, TemplateInstructions = instructions)`. Pass it only when `HasAny`, else pass null.
7. Run `provider.SummarizeAsync(transcript, record.Title, record.RecordedAt, outputLanguage = summaryLanguage, endedAt = record.EndedAt, enhancement)` on a worker thread (`Task.Run`). No cancellation token is passed, and the UI offers no cancel (bug B13).
8. `resolvedTitle = SuggestedMeetingTitle.Resolve(record.Title, result.SuggestedTitle)`. `titleChanged` = ordinal inequality with the current title.
9. Mutate the in-memory record: `Summary`, `ActionItems`, `SummaryProvider = result.ProviderId`, `NoteTemplateId = templateId`, and `Title` if changed.
10. Save the whole record (`SaveAsync(record)`).
11. If the title changed: set page `Title`, update `Workspace.LastProcessedMeeting.Title` when it is the same meeting, and call `Workspace.NotifyMeetingChanged(id)`.
12. Set `Summary`, `HasSummary = true`, `CanGenerateSummary = false`, `CanRegenerateSummary = true`, `StatusText = "Summary generated."` (`Status_SummaryGenerated`).
13. Run Jev analysis for the record (`MeetingJevRunner.TryAnalyzeAndSaveAsync`, cancellation none). Cross-module, may call the TypeSafe API for up to 2 minutes.
14. Rebuild the action item list from the record (this happens after step 13, bug B15).
15. On any exception: `StatusText = "Error generating the summary: {0}"` (`Error_GenerateSummary`) with `{0}` = `CliFailureUserMessage.Format(ex)` (2.5).
16. Finally: `IsGenerating = false`, refresh command and visibility notifications.

Template id persisted with the record is whatever was selected at generate time, including `custom`.

#### Action item toggle

Each checkbox is an `ActionItemViewModel` wrapping one `ActionItem`. Toggling writes through to the model, then the page saves the whole record asynchronously (fire and forget). On failure: `StatusText = "Error saving the action item: {0}"` (`Error_SaveActionItem`) with `{0}` = exception message. The checkbox text is read-only; items cannot be added, edited, deleted, or reordered in this tab.

#### Copy action items (`CopyActionItems`)

- No record or zero items: draft message "No action items to copy." (`SummaryPage_NoActionItems`), error severity.
- Otherwise copy `ActionItemParser.Render(items)` with the trailing newline trimmed (lines `- [ ] text` / `- [x] text`, joined by `\n`) to the clipboard as plain text. Success message "Action items copied to the clipboard." (`SummaryPage_ActionsCopied`), success severity.
- Clipboard exception: draft message = `CliFailureUserMessage.Format(ex)`, error severity.
- The draft message is only cleared by loading a meeting.

#### Raw notes editing

- `Notes` edits are mirrored into the loaded record in memory on every change (empty/whitespace becomes null).
- `SaveNotesAsync`: reload the record by id from the repository (so transcript, summary, folder filing are not overwritten), compute `notes = null if blank else Notes`, return if equal (ordinal) to the stored value, else set and save. Triggers: text box loses focus, switching from "My notes" to "Enhanced", page unload. No-ops without a record.
- Switching mode only toggles `IsShowingNotes`. Mode bar handler ignores events until the page has loaded.

#### Custom template save from the tab

"Save as custom template" loads the existing custom template, shows the custom template dialog (2.6) pre-filled, and on OK saves it and reloads the template list with `custom` selected. The combo box then reselects `custom`.

### 2.3 Note templates

Built-in ids: `auto`, `one-on-one`, `standup`, `sales`, `user-interview`. Plus `custom`. Combo box order: Auto, 1:1, Standup, Sales, User interview, then the custom template last if one exists with a non-blank name (display = trimmed name, id `custom`).

Display names: `NoteTemplate_Auto` "Auto", `NoteTemplate_OneOnOne` "1:1", `NoteTemplate_Standup` "Standup", `NoteTemplate_Sales` "Sales", `NoteTemplate_UserInterview` "User interview".

Instruction text per id (verbatim, `NoteTemplateCatalog.InstructionsFor`; the id is trimmed, matching is case-sensitive):

- `one-on-one`: `Shape the enhanced notes as a 1:1. Include decisions, feedback, and commitments that were actually stated. Omit a heading if that content is not in the sources.`
- `standup`: `Shape the enhanced notes as a standup. Include yesterday, today, and blockers that were actually stated. Omit a heading if that content is not in the sources.`
- `sales`: `Shape the enhanced notes as a sales call. Include pain, decision process, next step, and objections that were actually stated. Omit a heading if that content is not in the sources.`
- `user-interview`: `Shape the enhanced notes as a user interview. Include what they tried, quotes, and jobs-to-be-done. Quotes must be taken from the transcript or the raw notes. Do not invent quotes.`
- `auto`, `custom`, blank, unknown: null.

`NoteTemplateCatalog.NormalizeId(id)`: null/whitespace gives null. Trim. If it equals `auto` (case-insensitive) give null. Otherwise return the trimmed value as given (so `Custom` or `Standup` are not canonicalized).

`NoteTemplateInstructions.ResolveAsync(templateId, store)`: normalize. Null gives null. `custom` (case-insensitive) loads the custom template and returns its trimmed instructions, or null when absent/blank. Anything else returns `InstructionsFor(id)`.

### 2.4 Custom note template

Exactly one custom template exists per device. Shape: `{ Name, Instructions }`. It is not shared.

Dialog (`App/Services/CustomNoteTemplateDialog.cs`): confirm dialog titled "Custom template" (`CustomTemplate_Title`) with two text boxes in a vertical stack, spacing 12:

- Name: header "Name" (`CustomTemplate_Name.Header`), placeholder "Name this template", automation name "Template name".
- Instructions: header "Instructions", placeholder "What the enhanced notes should include", multi-line wrapped, min height 120, automation name "Template instructions".

Buttons: primary "Save" (`CustomTemplate_Save`), close "Cancel" (`CustomTemplate_Cancel`), default Primary. The primary click is cancelled (dialog stays open) while name or instructions is blank/whitespace, with no message. Cancel returns null. OK returns trimmed values.

Store (`JsonCustomNoteTemplateStore`): see 4.3. `SaveAsync` throws `ArgumentException("A custom template needs a name.")` or `("A custom template needs instructions.")` for blank fields, trims both fields on the passed object (mutating it), creates the directory, truncates and rewrites the file. All file access is serialized by a semaphore. `LoadAsync` returns null when the file is absent.

There is no way to delete the custom template, and no way to have more than one.

### 2.5 Failure classification and messages

#### CLI failures (`CliFailureMapper`, `CliToolException`, `Core/Strings`)

`CliFailureKind`: `NotInstalled`, `NotSignedIn`, `SubscriptionInactive`, `TimedOut`, `EmptyOutput`, `Unknown`.

Display names: `Claude Code` and `Codex`.

`Classify(exitCode, stdout, stderr, isOnPath = true)`, first match wins:

1. `!isOnPath` gives NotInstalled.
2. `exitCode == 0` and stdout blank gives EmptyOutput.
3. `text = stdout + " " + stderr`.
4. Not installed: contains phrase `not found` or `cannot find` (case-insensitive substring), or word `ENOENT` (whole word, case-insensitive).
5. Subscription inactive: phrases `payment required`, `plan expired`, or whole words `402`, `subscription`, `billing`, `payment`, `quota`, `credit`.
6. Not signed in: phrases `not logged in`, `sign in`, `sign-in`, `unauthorized`, `session expired`, `token expired`, `authentication`, whole words `login`, `oauth`, `auth`, `401`, or regex `please run.{0,80}login` (case-insensitive).
7. Timed out: phrases `timed out`, `time out`, `time-out`, or word `timeout`.
8. Else Unknown.

"Whole word" = regex `\b<escaped word>\b`, case-insensitive, invariant culture.

`Classify(Exception)`:

- `CliToolException` returns its kind.
- `TimeoutException` gives TimedOut.
- `FileNotFoundException` gives NotInstalled.
- `Win32Exception` with native error 2 or 3, or whose message looks not-installed, gives NotInstalled.
- Otherwise `Classify(exitCode: 1, stdout: null, stderr: exception.Message)`.

Messages (`BuildMessage`, Core keys, `{0}` = provider display name):

| Kind | Key | English |
|---|---|---|
| NotInstalled | `CliFailureNotInstalled` | `{0} is not installed. Install it, or pick another summary engine in Settings.` |
| NotSignedIn | `CliFailureNotSignedIn` | `Your {0} session expired. Sign in again on this PC, then generate the summary from the session.` |
| SubscriptionInactive | `CliFailureSubscriptionInactive` | `{0} could not run this request. The subscription on this account may have ended. Renew it, or switch summary engine in Settings.` |
| TimedOut | `CliFailureTimedOut` | `{0} took too long and was stopped. Try again, or switch engine in Settings.` |
| EmptyOutput | `CliFailureEmptyOutput` | `{0} returned nothing. Try again, or switch engine in Settings.` |
| Unknown | `CliFailureUnknown` | `{0} could not finish the summary.` |

`CliToolException` extends `InvalidOperationException`. `Message` = message, plus a space and the detail when a detail exists. `Detail` is set only for Unknown: `SanitizeSnippet(first non-blank of stderr, stdout)` for `Create`, or `SanitizeSnippet(exception.Message)` for `Wrap`. It never includes the exit code.

`SanitizeSnippet(text, max = 120)`: null for blank input. Trim. Replace matches of `Bearer\s+\S+|(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{20,}` (case-insensitive) with `[redacted]`. Collapse every whitespace run to one space. If longer than 120 chars, cut to 120, trim the end, append `…`.

`Wrap(displayName, ex)`: returns `ex` if already a `CliToolException`, else classifies and builds a new exception with the original as inner exception.

`RunRequiredStdoutAsync(runner, exe, args, stdin, timeout, displayName, ct)`:

1. If `!runner.IsOnPath(exe)`: throw `Create(displayName, NotInstalled)`.
2. Run the process. `OperationCanceledException` propagates unchanged. Any other exception is wrapped.
3. Non-zero exit code: throw `Create(displayName, exitCode, stdout, stderr)`.
4. `raw = stdout.Trim()`. Empty: throw EmptyOutput. Else return `raw`.

#### How the UI shows a failure (`App/Services/CliFailureUserMessage.cs`)

`Format(ex)`: non-CLI exceptions return `ex.Message` unchanged. CLI exceptions map kind to App keys with `{0}` = display name:

| Kind | App key | English |
|---|---|---|
| NotInstalled | `Error_CliNotInstalled` | `{0} is not installed. Install it, or pick another summary engine in Settings.` |
| NotSignedIn | `Error_CliNotSignedIn` | `Your {0} session expired. Sign in again on this PC, then generate the summary from the session.` |
| SubscriptionInactive | `Error_CliSubscriptionInactive` | `{0} could not run this request. The subscription on this account may have ended. Renew it, or switch summary engine in Settings.` |
| TimedOut | `Error_CliTimedOut` | `{0} took too long and was stopped. Try again, or switch engine in Settings.` |
| EmptyOutput | `Error_CliEmptyOutput` | `{0} returned nothing. Try again, or switch engine in Settings.` |
| Unknown | `Error_CliUnknown` | `{0} could not finish the summary.` plus `" " + Detail` when a detail exists |

Because `Format` returns raw `Message` for other exception types, these English strings reach the user untranslated in the Spanish UI: the local-model messages in 3.5, `FileNotFoundException` text, every `XaiException` message, and `HttpRequestException` text.

### 2.6 Setup wizard (`SummaryModelSetupDialog`, `SummaryModelSetupDialogViewModel`)

A modal dialog titled "Set up summary generation" (`Setup_Title.Title`) with a "Cancel" close button (`Setup_Title.CloseButtonText`), default button Close, no primary button. Content scrolls (max height 480), fixed width 440. Only one ContentDialog can show at once on WinUI, which shapes the xAI hand-off below; the Electron port does not have that limit.

Wizard states (`SummaryModelWizardState`): `ChoosingEngine`, `DetectingHardware`, `SelectingModel`, `Downloading`, `CheckingCli`, `Completed`. Exactly one panel is visible per state.

Two entry points:

- `ShowAsync(root)`: starts at `ChoosingEngine`. Returns `(Kind, ModelPath?)` or null. Loops (see Xai below).
- `ShowForLocalModelAsync(root)`: starts at hardware detection (the engine is already Local, e.g. the saved model was deleted). Returns the model file path or null. The dialog first renders `ChoosingEngine` until its `Loaded` event fires `InitializeForLocalOnlyAsync`, so the chooser can flash.

**ChoosingEngine** panel: heading "Choose how to generate summaries" (`Setup_ChooseEngine`), hint "Pick the engine Vozella should use to turn a transcript into a summary and action items." (`Setup_ChooseEngineHint`), then four full-width buttons in this order, each an icon plus name plus hint:

| Button (id) | Name | Hint | Icon |
|---|---|---|---|
| `BtnEngineClaudeCode` | "Claude Code" | "Uses the Claude Code CLI already installed on this PC." | Claude Code logo |
| `BtnEngineCodex` | "Codex" | "Uses the Codex CLI already installed on this PC." | Codex logo |
| `BtnEngineXai` | "Grok (xAI)" | "Sign in with SuperGrok or paste an xAI API key." | Grok logo |
| `BtnEngineLocal` | "Local models" | "Runs entirely on this PC — no account, no server, no cost." | chip glyph U+E950 |

Choosing an engine (`ChooseEngine(kindName)`, parses the enum name):

- `Local`: result kind = Local, run hardware detection.
- `Xai`: if credentials already exist, finish with xAI and close. Otherwise set `PendingXaiAuth = true` and raise `XaiAuthRequested` (the host hides the dialog).
- `ClaudeCode` or `Codex`: go to `CheckingCli`.

**CheckingCli**: remember the pending kind and set it as result kind. If the CLI executable is on PATH: save `SelectedSummaryProvider = <kind name>` to settings, set result (no model path), mark resolved, state Completed, raise Completed (host hides). Otherwise show `Cli_NotFoundCheckAgain` = `Vozella couldn't find "{0}" on your PATH. {1} Once it's installed, select "Check again".` with `{0}` = executable name (`claude`/`codex`) and `{1}` = the install hint: `Cli_ClaudeHint` = `Install it from https://claude.com/claude-code, then run "claude" once from a terminal to sign in.` or `Cli_CodexHint` = `Install it with "npm install -g @openai/codex" (see https://github.com/openai/codex), then run "codex" once from a terminal to sign in.` Buttons: "Check again" (`Setup_CheckAgain`, accent, id `BtnRecheckCli`) and "Back" (`Setup_Back`, id `BtnBackToEngineChoice`). Check again repeats the PATH test: success finishes as above, failure sets `Cli_StillMissing` = `Still not found on PATH as "{0}". Install it, then try again.`. Back returns to `ChoosingEngine`. The check never verifies that the CLI is signed in.

**DetectingHardware**: spinner plus "Detecting hardware..." (`Setup_DetectingHardware`). The detection is synchronous and cached, so this state is visible only momentarily.

Detection step: read the hardware profile (4.4), build `HardwareSummary`:

- Dedicated GPU (`GpuVramGb > 0`): `Hardware_WithGpu` = `Detected: {0} GB RAM, GPU {1} ({2} GB VRAM)` with RAM, GPU name (empty if null), VRAM, formatted with default `ToString` in the current culture.
- Else `Hardware_NoGpu` = `Detected: {0} GB RAM, no dedicated GPU`.

Build one `ModelOption` per catalog entry in catalog order: fit rating (4.5) and whether the file already exists on disk. Default selection: first downloaded model, else first rated Recommended, else the first. State becomes `SelectingModel`.

**SelectingModel**: heading "Choose a model to generate summaries" (`Setup_ChooseModel`), hint "Runs entirely on this PC — no account, no server, no cost. Larger models are slower but produce better summaries." (`Setup_ChooseModelHint`), the hardware summary line, a single-select list (max height 280, id `ListModelOptions`), and an accent button "Download and use this model" (`Setup_DownloadModel`, id `BtnDownloadModel`) enabled only when a model is selected.

Each list row: bold display name (`Model_Downloaded` = `{0} (downloaded)` when the file exists, else the plain display name), the model's use-case caption, a dimmed line `Model_SpeedQuality` = `{0} · Quality {1} · {2:0.#} GB download` (speed label, quality label, size in GB with up to one decimal), and a rounded badge on the right with the fit label: `Fit_Recommended` "Recommended", `Fit_MayBeSlow` "May be slow", `Fit_NotRecommended` "Not recommended". Badge background: success brush for Recommended, caution brush for MayBeSlow, critical brush otherwise; text uses the on-accent primary colour. (Port note: the Electron constraint says red `signal` means live recording only, so the "critical" badge must use a different error token.)

**Download** (`DownloadSelectedModel`):

- If the selected model is already downloaded: finish immediately with it.
- Else state `Downloading`, mark the option as downloading, set status `Download_ModelProgress` = `Downloading {0} ({1:0}%)...` with the display name and 0.
- Download via the model manager (3.4) with a progress callback that updates the option's percent and the status text. No cancellation token is passed (bug B6).
- On success mark the option downloaded and finish with the model.
- On any exception: status `Error_DownloadModel` = `Error downloading the model: {0}` with the raw exception message, state returns to `SelectingModel`. The status text is stored but the `SelectingModel` panel does not render it (only the `Downloading` panel binds `DownloadStatusText`), so the error is invisible (bug B7).
- Always clears the downloading flag.

**Downloading** panel: a determinate progress bar (0 to 100) bound to the selected option's percent, and the status text.

**Finish with local model**: result path = model file path, kind Local, save settings (`SelectedSummaryModelId = model.FileName`, `SelectedSummaryProvider = "Local"`), mark resolved, state Completed, raise Completed.

**Completed** panel: success InfoBar "Done" with message "The model is ready to use." (`Setup_Done.*`). The host hides the dialog on `Completed`, so this panel is not seen.

**Xai hand-off** (inside `ShowAsync`): after the wizard dialog closes, if it is not resolved and `PendingXaiAuth` is set, show the xAI sign-in dialog. If that returns true: finish with xAI (save `SelectedSummaryProvider = "Xai"`) and return `(Xai, null)`. If it returns false the loop starts a brand-new wizard at `ChoosingEngine`. Loop exit: when a wizard closes unresolved and without a pending xAI request, return null.

All settings writes in the wizard are read-modify-write of the whole settings object (load, mutate one or two fields, save).

### 2.7 Provider readiness gate (resolvers)

`SummaryProviderResolver.ResolveAsync(kind, ensureLocalModel, ensureCli, ensureXai, webSearch = false)` returns a provider plus provenance, or null when the gate fails. The page supplies three UI callbacks. Behavior:

- `Local`: await `ensureLocalModel()`; null result (or missing callback) gives null. Otherwise `CreateSummaryProvider(Local, path)`. Result carries kind and the model path.
- `Xai`: callback must exist and return true, else null. Creates the xAI provider.
- `ClaudeCode` / `Codex`: callback must exist and return true for that kind, else null. When `webSearch` is true use the live-answer factory (web search flags); otherwise the plain factory. Only the live-answer feature passes `webSearch`.

Callbacks wired by the Summary page on load:

- Local: `SummaryModelResolver.ResolveAsync`: load settings; if `SelectedSummaryModelId` is set and matches a catalog entry whose file exists, return that path; otherwise show the wizard in local-only mode and return its path or null. Matching is by exact file name.
- CLI: `CliProviderResolver.EnsureAvailableAsync(kind)`: true if the executable is on PATH; otherwise show the CLI setup dialog (below). Executable names: `claude`, `codex`. Any other kind throws `ArgumentOutOfRangeException` ("Only ClaudeCode and Codex are CLI-backed providers.").
- xAI: `XaiProviderResolver.EnsureAvailableAsync`: true if the auth session has a non-blank saved access token; otherwise show the xAI sign-in dialog, true only if it saved credentials.

The provider factory (`AppServices.CreateSummaryProvider`) builds a new provider on every call, reading model and effort from a settings snapshot (see bugs B1, B2):

- Local: `new LocalLlmSummaryProvider(path)`; a null path throws `ArgumentNullException`.
- ClaudeCode: `ClaudeCodeCliSummaryProvider(runner, settings.ResolveClaudeModelId(), settings.ResolveClaudeEffort(), webSearch)`.
- Codex: same with the Codex resolvers.
- Xai: `XaiSummaryProvider(session, api, ResolveXaiModelId(), settings.ResolveXaiEffort())`.

**CLI setup dialog** (`CliToolSetupDialog`): title `Cli_SetupTitle` = `Set up the {0} CLI` ({0} = "Claude Code" or "Codex"). Body text `Cli_NotFound` = `Vozella couldn't find "{0}" on your PATH. {1} Once it's installed and signed in, select Retry.` and a warning InfoBar titled "Not found on PATH" (`CliSetup_NotFound.Title`). Buttons: primary "Retry" (`CliSetup.PrimaryButtonText`), close "Cancel". Primary click: if the executable is now on PATH, the dialog closes with true; otherwise the click is cancelled (dialog stays) and the InfoBar message becomes `Cli_StillMissing`. Width 420, scroll max height 480.

### 2.8 xAI sign-in dialog (`XaiAuthDialog`, `XaiAuthDialogViewModel`)

Title "Sign in to Grok (xAI)" (`XaiAuth.Title`), close button "Cancel", default Close. Content (width 440):

1. Headline: "Use SuperGrok (opens a browser) or paste an API key from console.x.ai. Saving one replaces the other." (`XaiAuth_Headline`)
2. SuperGrok section: header "SuperGrok", hint "Vozella shows a short code and opens xAI. Approve it in the browser, then this window finishes on its own.", accent button "Sign in with SuperGrok" (id `BtnXaiSuperGrok`), disabled while busy. A device-code panel, shown while polling: label "Enter this code if the browser does not fill it in:", the user code in title style with text selection enabled (id `TxtXaiUserCode`), caption "Waiting for you to finish sign-in in the browser…", spinner.
3. API key section: header "API key", hint "Create a key at console.x.ai. This is billed separately from SuperGrok.", password box with placeholder "xAI API key" and peek reveal (id `BoxXaiApiKey`), button "Save API key" (id `BtnXaiSaveApiKey`). Both disabled while busy.
4. Error InfoBar, severity Error, open when an error is set, message = error text.

Behavior:

- **Sign in with SuperGrok**: cancel any previous poll, create a fresh cancellation source, hide the error, set busy. Request a device code (6.x of 3.7). Show the user code and the panel. Open the verification URI in the default browser (the result of the launch is ignored). Poll for the token until success, denial, or expiry. On success: save OAuth credentials through the auth session (this replaces any API key), mark `Succeeded`, raise `Completed` (host hides). `OperationCanceledException` is swallowed silently. Any other exception: show `ex.Message` in the error bar. In all cases clear busy; clearing busy also hides the device-code panel.
- **Save API key**: trim the draft. Blank gives error "Paste an API key first." (`XaiAuth_ApiKeyRequired`). Otherwise save through the session (replaces OAuth), clear the draft, mark `Succeeded`, raise `Completed`. Exceptions show `ex.Message`.
- Dialog closing (any way) cancels and disposes the polling source.
- `ShowAsync` returns `Succeeded`.

The same dialog is opened from Settings (sign-in button), from the xAI gate, and from the wizard.

### 2.9 Settings: summary provider section (`SummaryProviderSectionViewModel`)

State:

- `SelectedProviderKind` (default Local), CLI status text, xAI status text, status detail, signed-in flag, busy flag, models list, selected xAI model id, per-provider model and effort selections (defaults in 4.1), an API key draft (save enabled only when non-blank), a feedback toast (message plus open flag, auto-hide after 4 seconds, restarted on each new message).
- Flags `IsLocalSelected`, `IsClaudeCodeSelected`, `IsCodexSelected`, `IsXaiSelected` drive which sub-panel shows. `ShowCliProviderStatus` is true for ClaudeCode and Codex.

Catalogs offered (`InferenceCatalog`):

| Provider | Models | Efforts | Defaults |
|---|---|---|---|
| Claude Code | `sonnet`, `opus`, `haiku`, `fable` | `low`, `medium`, `high`, `xhigh`, `max` | model `sonnet`, effort `low` |
| Codex | `gpt-5.4`, `gpt-5.5`, `gpt-5.6`, `gpt-5.6-sol` | `low`, `medium`, `high`, `xhigh` | model `gpt-5.6`, effort `low` |
| xAI | live list from the API | `none`, `low`, `medium`, `high`, `xhigh` | model `grok-4.6`, effort `low` |

Actions:

- **Select provider** (no-op if unchanged): set the kind, save `SelectedSummaryProvider` as the enum name, and for xAI refresh the account. On kind change the CLI status text becomes `Status_CliOnPath` "Detected on PATH." or `Status_CliMissing` "Not found on PATH — install it before recording." for CLI kinds, empty otherwise.
- **Select Claude/Codex model or effort**: ignored while the page is loading, while restoring saved values, or for blank/unchanged values. Otherwise update, save the matching settings field, and show the toast `Xai_FeedbackModel` = `Saved. Using {0}.` with `"{model} · {effort}"` (the xAI-named key is reused for Claude and Codex).
- **Select xAI effort / model**: same guards (guard flag is the xAI one). Save, refresh the ready line, show the toast with `"{model} · {effort}"`.
- **Save xAI API key**: no-op while the draft is blank. Save through the session, clear the draft, refresh the account, toast `Xai_FeedbackApiKey` "API key saved.".
- **Sign out xAI**: clear credentials, refresh the account, toast `Xai_FeedbackSignedOut` "Signed out of Grok (xAI).".
- Sign in (from the settings page): opens the xAI dialog; on success refresh the account and toast `Xai_FeedbackSignedIn` "Signed in with SuperGrok.".
- **Apply loaded settings** (offline part of page load): resolve the kind; for xAI only apply the credential status, seed the model list with the saved model when signed in and the list is empty (so the combo box keeps its selection); set xAI model and effort; set Claude and Codex model and effort with the commit guard on. **Load xAI account** (network part): only when xAI is the selected kind.
- **Refresh xAI account**: apply credential status first. Signed out: clear the model list and stop. Signed in: set busy, get an access token (this may refresh OAuth), list models, load settings, `resolved = ResolveModelId(saved, models)`, merge the list in place (keep order, keep the resolved id even if not listed), select the resolved id, and if it differs from the saved id write it back to settings, mark models loaded and set the ready line `Xai_StatusReady` = `Ready. Using {0}.` with `"{model} · {effort}"`. Any exception: models-loaded false, status text `Xai_StatusErrorTitle` "Could not reach Grok", detail = exception message. Always clears busy.
- Credential status text: OAuth gives `Xai_StatusSuperGrok` "Signed in with SuperGrok", API key gives `Xai_StatusApiKey` "API key saved", none gives `Xai_StatusSignedOut` "Not signed in". Signed out detail: `Xai_StatusSignedOutDetail` "Sign in with SuperGrok, or paste an API key below.". Signed in with no loaded list yet: `Xai_StatusLoadingModels` "Loading your Grok models…" (kept as "ready" once loaded).

The local-model management list (download, delete, set active, in Settings) lives in `LocalModelSectionViewModel` (Settings module). It shares `ModelOption`, `ILocalLlmModelManager`, and the settings field `SelectedSummaryModelId` with this module. Deleting the active model clears `SelectedSummaryModelId`.

#### String keys used by this module (English, from `App/Strings/en-us/Resources.resw`)

Status and errors: `Status_GeneratingSummary` "Generating summary...", `Status_SummaryGenerated` "Summary generated.", `Status_SetupCancelled` "Setup cancelled.", `Status_DoneWithSummary` "Done. Transcript and summary available.", `Status_DoneNoSummary` "Done. Transcript available (no summary).", `Status_CliOnPath`, `Status_CliMissing`, `Error_GenerateSummary` "Error generating the summary: {0}", `Error_SaveActionItem` "Error saving the action item: {0}", `Error_DownloadModel` "Error downloading the model: {0}", the six `Error_Cli*` keys in 2.5.

Wizard and CLI: `Setup_*` (Title, ChooseEngine, ChooseEngineHint, Claude/Codex/Local/Xai Name and Hint, CheckAgain, Back, DetectingHardware, ChooseModel, ChooseModelHint, DownloadModel, Done.Title, Done.Message), `Cli_SetupTitle`, `Cli_NotFound`, `Cli_NotFoundCheckAgain`, `Cli_StillMissing`, `Cli_ClaudeHint`, `Cli_CodexHint`, `Cli_ClaudeName`, `Cli_CodexName`, `CliSetup.PrimaryButtonText`, `CliSetup.CloseButtonText`, `CliSetup_NotFound.Title`.

Models: `Fit_Recommended`, `Fit_MayBeSlow`, `Fit_NotRecommended`, `Model_Downloaded`, `Model_SpeedQuality`, `Hardware_WithGpu`, `Hardware_NoGpu`, `Download_ModelProgress`.

xAI: `Xai_ProviderName` "Grok (xAI)", `Xai_Status*`, `Xai_Feedback*`, `XaiAuth.*`, `XaiAuth_*`.

Templates and page: `NoteTemplate_*`, `CustomTemplate_*`, `NotesMode_*`, `SummaryPage_*`, `SummaryRegenerate_*`, `NoSummariesYet`.

Core (English and Spanish in `CoreStrings*.resx`): `CliFailure*` (six), `ModelSpeedVeryFast` "Very fast", `ModelSpeedFast` "Fast", `ModelSpeedMedium` "Medium", `ModelSpeedSlowWithoutGpu` "Slow without GPU", `ModelQualityGood` "Good", `ModelQualityVeryGood` "Very good", `ModelQualityExcellent` "Excellent", `ModelUseCaseModestPcs` "Modest PCs / laptops without a GPU", `ModelUseCaseRecommendedDefault` "Recommended default balance", `ModelUseCasePc16GbOrGpu` "PC with 16GB+ RAM or a dedicated GPU", `ModelUseCaseGpuOnly` "GPU only (8GB+ VRAM), current state of the art in its class". Spanish equivalents exist for all (for example "Muy rápido", "Rápido", "Medio", "Lento sin GPU", "Buena", "Muy buena", "Excelente").

The port must keep key parity between the English and Spanish catalogs. The selected UI language comes from `AppSettings.UiLanguage` (settings module).

### 2.10 Title-only suggestion (consumer in the session page)

`SessionPageViewModel.SuggestTitleAsync` (other module) calls `provider.SuggestTitleAsync(transcript, recordedAt, outputLanguage)` and then `SuggestedMeetingTitle.FromModelResponse(raw)`. Null result gives message `SessionSuggestTitle_Empty`; otherwise it renames the meeting. Unlike summarize, it always applies the title (does not check for a placeholder). Provider errors surface through `CliFailureUserMessage.Format`. This module owns the prompt (3.2) and the normalization (3.8).

---

## 3. Domain rules

### 3.1 Summary prompt (`CliSummaryPromptBuilder.Build`)

Used verbatim by Local (direct path and final map-reduce step), Claude Code, Codex, and xAI. Inputs: title, recordedAt, transcript, outputLanguage, endedAt, enhancement.

Derived values:

- `languageName = ToEnglishLanguageName(code)`: null/blank gives `Spanish`; otherwise trim and lowercase: `es` Spanish, `en` English, `pt` Portuguese, `fr` French, `de` German, `it` Italian, `nl` Dutch, `ja` Japanese, `zh` Chinese, anything else `Spanish`.
- `IsEnglish(code)` = trimmed code equals `en` (case-insensitive). Subheadings: English `What this was` / `Key points` / `Decisions` / `Open questions`. Every non-English code (including `fr`, `de`) uses Spanish: `Qué fue esto` / `Puntos clave` / `Decisiones` / `Preguntas abiertas`.
- Action examples: English `- [ ] Send the revised deck — Owner: Ana — Due: Friday` and `- [ ] Review the API contract` (two lines). Non-English: `- [ ] Enviar el deck revisado — Owner: Ana — Due: viernes` and `- [ ] Revisar el contrato de la API`.
- `endedAtBlock`: when `endedAt` is set, a newline, 12 spaces, `<ended_at>` + ISO 8601 round-trip string (`O` format, invariant culture, for example `2026-11-02T15:30:00.0000000-05:00`) + `</ended_at>`. Else empty.

Prompt text. `{languageName}`, `{headings.*}`, `{actionExamples}`, `{title}`, `{recordedAt}`, `{endedAtBlock}`, `{transcript}` are the substitutions. The en dash in "3–8" is U+2013. Verbatim:

```text
# Identity

You extract meeting and lecture notes from an automatic-speech-recognition transcript.
The transcript may contain ASR errors, false starts, and filler. You are a note-taker,
not a novelist.

# Instructions

Respond with exactly three Markdown sections, in this order, and nothing else
(no preamble, no code fences, no closing commentary):

## Title

One short title, about 3–8 words. No quotes, no trailing period, no markdown.
Write the title in {languageName}. If the recording is an informal ASR test, say so
plainly (e.g. "Microphone test"). Do not copy <meeting_title> unless it already
describes the content. Ground it in the transcript; do not invent.

## Summary

Use these subheadings inside the Summary body, verbatim (omit a subheading if that
content is not in the transcript):

### {headings.WhatThisWas}
One or two sentences: meeting, class, informal test, or unclear.

### {headings.KeyPoints}
Bullet list of substantive points actually said.

### {headings.Decisions}
Bullet list of decisions that were explicitly made. If none, omit this subheading.

### {headings.OpenQuestions}
Unresolved questions or disagreements. If none, omit this subheading.

## Action Items

Each follow-up as a Markdown checkbox. Include owner and due date only when the
transcript states them. If priority was stated, append it. Examples:
{actionExamples}

If there are no action items, leave this section empty (keep the heading).

Rules:
- Ground every sentence in the transcript. Do not invent attendees, dates, companies, or tasks.
- If the recording is an informal ASR test or rambling, say so in "{headings.WhatThisWas}". Do not dress it up as a formal meeting.
- If a name or number is unclear because of ASR noise, paraphrase without guessing the spelling.
- Transcript lines are stamped [mm:ss.ff-mm:ss.ff] elapsed ranges from recording start, with optional [ Speaker-N ] labels. When placing a key point, decision, or quote in time, use that elapsed range (and Recorded/Ended for wall-clock meeting bounds).
- Transcript may start with Recorded and Ended local stamps (yyyy-MM-dd HH:mm). Use those / <ended_at> as the meeting end. Never write that the end time was not recorded when Ended or <ended_at> is present. If missing, omit end time (do not invent, do not say "not recorded").
- Write the Title, the Summary body, and action-item text in {languageName}.
- Use the ### subheadings above verbatim — do not translate them.
- Keep the Markdown headings exactly "## Title", "## Summary", and "## Action Items" in English.

# Context

<meeting_title>{title}</meeting_title>
<recorded_at>{recordedAt O-format}</recorded_at>{endedAtBlock}
<transcript>
{transcript}
</transcript>
```

Note: the last rule contradicts "Use the ### subheadings above verbatim — do not translate them" when combined with `{languageName}`; the subheadings are already localized by the substitution, so the two rules are consistent only for `es` and `en`.

**Enhancement suffix** (`enhancement` present and `HasAny`): the final string is `prompt + "\n" + rules + blocks`, with no trailing newline on `prompt`.

Rules text (the raw-notes line is present only when `HasRawNotes`; in the original it is preceded by a newline and 12 literal spaces, which is a harmless indentation artefact that the port may normalize):

```text
Extra rules for the supplied context:
- Do not invent attendees, dates, quotes, or tasks that are not in the transcript or the supplied context.
- Still emit exactly "## Title", "## Summary", and "## Action Items" in that order, and nothing else.
- Treat the raw notes as important. Include those points. Fix typos. Fill structure from the transcript.
```

Blocks, appended in this order, each only when present, each preceded by a blank line (except that the first block directly follows the rules line), and each tag line indented by 12 spaces in the original:

1. `<raw_notes>` + trimmed raw notes + `</raw_notes>`.
2. `<attendees>` + non-blank names, trimmed, joined by `, ` + `</attendees>`.
3. `<agenda>` + trimmed agenda + `</agenda>`.
4. `<template_instructions>` + trimmed instructions + `</template_instructions>`.

`SummaryEnhancementContext` flags: `HasRawNotes`, `HasAgenda`, `HasTemplateInstructions` are non-blank checks; `HasAttendees` is true when at least one attendee is non-blank; `HasAny` is the OR of the four. Line breaks inside blocks are the platform newline (CRLF on Windows). The port should pick one newline style and apply it consistently (LF recommended); the model is insensitive to it.

### 3.2 Title-only prompt (`CliMeetingTitlePromptBuilder.Build(transcript, recordedAt, outputLanguage)`)

Verbatim, with `{languageName}` from the same mapping and `{recordedAt}` in `O` format:

```text
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

### 3.3 Response splitter (`SummaryMarkdownSplitter.Split(raw)`)

Returns `(summaryMarkdown, actionItems, suggestedTitle)`. Algorithm:

1. Normalize `\r\n` to `\n`, split on `\n`.
2. `suggestedTitle`: find the first line whose trimmed text equals `## Title`. If none, null. Otherwise collect following lines until the first line whose trimmed text starts with `## `; keep non-empty trimmed lines; join with a single space; null when nothing collected. (Not normalized here. See 3.8. Wrapping quotes are preserved, covered by `Split_WhenTitleHasWrappingQuotes_KeepsQuotesForNormalize`.)
3. `splitIndex`: first line whose trimmed text equals `## Action Items` (exact, case-sensitive). If none, the first line matching `^\s*-\s\[( |x|X)\]\s+` (a checkbox line).
4. If `splitIndex < 0`: all lines are summary and the item list is empty. Else summary lines are `lines[0..splitIndex)` and items are `ActionItemParser.Parse(lines[splitIndex..] joined by "\n")`. (Everything after the header goes to the parser, including text under later `##` headings; only checkbox lines yield items.)
5. Remove the title block from the summary lines: from the `## Title` line up to (not including) the next line whose trimmed text starts with `## `, or to the end.
6. Join with `\n`, trim. If the result starts with `## Summary` (ordinal, case-sensitive), drop that header and trim again.

Edge: when the response has no `## Title` and no `## Summary`, the whole response is the summary.

### 3.4 Action item parser (`ActionItemParser`)

`Parse(sectionBody)`: blank input gives an empty list. For each line (after `\r\n` to `\n`) matching `^\s*-\s\[( |x|X)\]\s+(.*)$` (invariant culture): item text is group 2 trimmed, `IsDone` is true when the mark is `x` or `X`. Non-matching lines are ignored. Exactly one space between `-` and `[` is required. `* [ ]`, `- [] `, `1. [ ]`, and checkboxes without text after the box do not match.

`Render(items)`: empty list gives empty string. Else for each item `- [x] text\n` or `- [ ] text\n`. Always lowercase `x`.

Used by the splitter, the meeting Markdown formatter and parser (persistence module), and the copy action.

### 3.5 Local LLM provider (`LocalLlmSummaryProvider`, `LocalLlmSummaryMapReduce`)

Constants:

| Name | Value |
|---|---|
| Context window (`ContextTokens`) | 4096 tokens, set as `ContextSize` when loading |
| Final output cap (`FinalMaxOutputTokens`) | 1024 |
| Notes output cap (`NotesMaxOutputTokens`) | 640 |
| Safety margin | 128 tokens (chat template and counting drift) |
| `MaxParts` | 64 |
| `MaxMergePasses` | 8 (loop runs passes 0 through 8, so 9 checks) |
| Summary temperature | 0.3 |
| Prompt and stream temperature | 0.2 |
| Prompt and stream output cap (`PromptMaxTokens`) | 512 |
| Title output cap | 80 |

Other sampler values (top-k, top-p, min-p, repeat penalty, seed) are left at the LLamaSharp 0.27.0 `DefaultSamplingPipeline` defaults. They are not set in this repository. The port must pick explicit values and record them. Inference runs through a stateless executor with the model's chat template applied (`ApplyTemplate = true`); no conversation state is kept between calls.

Loading: before any inference, `File.Exists(modelPath)` is checked; if absent throw `FileNotFoundException` with message `The selected local summary model has not been downloaded yet. Download it from Settings first.` Weights are loaded lazily once per provider instance under a semaphore (double-checked), and kept for later calls on that instance. `Dispose` releases the weights and the semaphore.

`Infer`: concatenate streamed tokens, trim; empty result throws `InvalidOperationException("The local model did not return any content.")`.

`SummarizeAsync`: ensure the model is ready, run map-reduce (below) using the model tokenizer as the token counter (tokenize with BOS added and special tokens parsed, UTF-8) and `Infer(prompt, maxTokens, 0.3)` as the inference function, then run the splitter on the raw text.

`SuggestTitleAsync`: builds the title prompt (3.2) and infers with cap 80, temperature 0.3. No budget check (bug B8). `CompletePromptAsync`: cap 512, temperature 0.2, no budget check. `StreamPromptAsync`: same parameters, yields tokens as they arrive.

**Map-reduce (`LocalLlmSummaryMapReduce.SummarizeAsync`)**

Definitions: `RoomFor(prompt, maxOut) = 4096 - 128 - maxOut - tokens(prompt)`. `Fits(prompt, maxOut)` = `RoomFor >= 0`.

1. Throw if already cancelled.
2. `direct = BuildFinalPrompt(request, transcript)` (the summary prompt of 3.1 with the real transcript and the enhancement). If it fits with `maxOut = 1024`: infer once with cap 1024 and return the raw text.
3. Otherwise check the empty-transcript final prompt: if `RoomFor(finalPrompt with empty transcript, 1024) < 640`, throw `InvalidOperationException`: `The meeting notes, agenda, or template are too long for the local summary model. Shorten them or use another summary provider.` (A single merged note must always fit.)
4. `language = ToEnglishLanguageName(outputLanguage)`.
5. Split the transcript into parts with budget `RoomFor(BuildPartPrompt("", 64, 64, language), 640)` using `SplitToBudget` (below). If more than 64 parts, throw: `The transcript is too long for the local summary model ({n} parts, limit 64). Use another summary provider.`
6. For each part in order (checking cancellation first): infer `BuildPartPrompt(part, i+1, total, language)` with cap 640; collect the notes.
7. `MergeUntilFinalFits`: `mergeRoom = RoomFor(BuildMergePrompt("", language), 640)`. For `pass` in 0..8: build `BuildFinalPrompt(request, notes joined by "\n\n")`; if it fits at cap 1024, return that prompt. Else group notes with `GroupToBudget(notes, mergeRoom)`. If the number of groups equals the number of notes, stop looping (no progress). Else replace each group with its single note, or with one inference of `BuildMergePrompt(group joined by "\n\n", language)` at cap 640 for groups of two or more (checking cancellation per group), and continue.
8. If the loop ends without a fitting prompt, throw: `The local summary model could not condense this meeting enough to summarize it. Use another summary provider.`
9. Check cancellation, then infer the final prompt at cap 1024 and return the raw text.

`SplitToBudget(text, maxTokens)`: greedy line packing.

- Split on `\r\n` or `\n` (keeping empty lines).
- Per line: `cost = tokens(line) + 1` (the +1 is the line break put back).
- If `cost > maxTokens`: flush the buffer, then add the pieces of `SplitLongLine(line, maxTokens - 1)` as separate chunks, continue.
- Else if `used + cost > maxTokens`: flush. Then append `\n` if the buffer is non-empty, append the line, add `cost` to `used`.
- At the end flush. `Flush` adds the buffer as a chunk only if it is not whitespace, then clears buffer and `used`.

`SplitLongLine(line, maxTokens)`: from `start = 0` while `start < len`: `end = start + LongestPrefixWithin(...)`; if `end < len`, `end = BackOffToBoundary(line, start, end)`; yield `line[start..end]`; `start = end`.

`LongestPrefixWithin(line, start, maxTokens)`: binary search over prefix length in `[1, len - start]` for the largest length whose token count is at most `maxTokens`; returns at least 1.

`BackOffToBoundary(line, start, end)`: scan `i` from `end - 1` down while `i > start + (end - start) / 2`; if `line[i]` is whitespace return `i + 1`. If none: if `line[end]` is a low surrogate and `end - 1 > start`, return `end - 1`; else `end`. This prefers a whitespace cut in the second half of the piece and never splits a surrogate pair.

`GroupToBudget(notes, maxTokens)`: iterate notes; `cost = tokens(note) + 2` (the blank line between notes); start a new group when there is none yet or `used + cost > maxTokens`; append the note to the last group; add cost. A single oversized note ends up alone in its own group.

`BuildPartPrompt(part, number, total, language)` verbatim:

```text
You take notes on part {number} of {total} of an automatic-speech-recognition transcript.
Another step combines the notes from all parts, so anything you leave out is lost.

Respond only with Markdown bullets in {language}, about 300 words at most, with no preamble:
- The substantive points actually said.
- Decisions explicitly made, starting with "Decision:".
- Unresolved questions, starting with "Question:".
- Follow-ups as "- [ ] task", with an owner and a due date only when stated.

Keep the [mm:ss.ff-mm:ss.ff] range on decisions and follow-ups, and any Recorded or Ended stamp.
Ground every bullet in the text. Do not invent names, dates, or tasks.
If this part has nothing substantive, respond with one bullet that says so.

<transcript_part>
{part}
</transcript_part>
```

`BuildMergePrompt(notes, language)` verbatim:

```text
These are consecutive notes on a recording, in time order. Combine them into one shorter set.

Respond only with Markdown bullets in {language}, about 300 words at most, with no preamble.
Remove repetition and minor detail. Keep every decision, open question, and follow-up,
with their "Decision:", "Question:", and "- [ ]" forms and their time ranges.
Do not invent anything that is not in the notes.

<notes_part>
{notes}
</notes_part>
```

Token counting quirk: each counted string is tokenized with a BOS token, so every line adds at least one extra token. This over-estimates and is conservative. The port may use its own tokenizer but must keep every prompt inside the budget.

Catalog hardware gating: see 3.6 and 4.5.

### 3.6 Model catalog (`ModelCatalog.SummaryModels`)

Ordered by ascending `MinRamGb`. All Q4_K_M GGUF. `FileName` is the stable id and the on-disk file name. URLs were probed with an HTTP HEAD request on 2026-11-02 and all four redirect to a 200 response.

| FileName | Display name | Size GB | Min RAM GB | Speed key | Quality key | Use case key | Download URL |
|---|---|---|---|---|---|---|---|
| `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | Llama 3.2 1B Instruct | 0.81 | 4 | `ModelSpeedVeryFast` | `ModelQualityGood` | `ModelUseCaseModestPcs` | `https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf` |
| `gemma-4-E2B-it-Q4_K_M.gguf` | Gemma 4 E2B Instruct | 3.11 | 6 | `ModelSpeedFast` | `ModelQualityVeryGood` | `ModelUseCaseRecommendedDefault` | `https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf` |
| `gemma-4-E4B-it-Q4_K_M.gguf` | Gemma 4 E4B Instruct | 4.98 | 8 | `ModelSpeedMedium` | `ModelQualityExcellent` | `ModelUseCasePc16GbOrGpu` | `https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf` |
| `gemma-4-12b-it-Q4_K_M.gguf` | Gemma 4 12B Instruct | 7.12 | 16 | `ModelSpeedSlowWithoutGpu` | `ModelQualityExcellent` | `ModelUseCaseGpuOnly` | `https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf` |

Speed, quality and use-case labels are resolved from the Core string catalog at read time, in the current UI culture (so the list is built once per process in the culture active at first access, bug B20).

### 3.7 CLI providers (`ClaudeCodeCliSummaryProvider`, `CodexCliSummaryProvider`, `CliToolProviderBase`, `CliInvocation`)

Both providers extend one base that supplies four values: executable name, timeout, argument string, display name. They run `RunRequiredStdoutAsync` (2.5) with the prompt on stdin.

| | Claude Code | Codex |
|---|---|---|
| Provider id | `claude-code` | `codex` |
| Executable | `claude` | `codex` |
| Timeout | 5 minutes | 5 minutes |
| Display name | `Claude Code` | `Codex` |

Summarize: build the summary prompt (3.1), run, split (3.3), return the result with the provider id. SuggestTitle: title prompt (3.2), run, return raw trimmed stdout. CompletePrompt: run the given prompt. Streaming: default single-chunk behavior.

Argument strings:

- `ClaudePrint(model, effort, webSearch)`: start `-p`. If `model` is not blank: append ` --model ` + trimmed model, wrapped in double quotes only if it contains a space (no escaping of embedded quotes). If `effort` is not blank: append ` --effort ` + trimmed effort. If `webSearch`: append ` --tools WebSearch --allowedTools WebSearch`. Example: `-p --model sonnet --effort low`.
- `CodexExec(model, effort, webSearch)`: start `exec -` (the lone `-` makes codex read the prompt from stdin); with `webSearch` start `--search exec -` (the flag is top-level and must precede `exec`). If `model` is not blank: append ` -m ` + quoted-if-spaced model. If `effort` is not blank: append ` -c model_reasoning_effort="` + trimmed effort + `"`. Example: `exec - -m gpt-5.6 -c model_reasoning_effort="low"`.

Process runner contract (`ICliProcessRunner`, implemented by `CliProcessRunner`):

- `IsOnPath(fileName)`: split `PATH` on the platform separator; skip blank entries. On Windows, candidate extensions come from `PATHEXT` (default `.EXE;.CMD;.BAT`); on other platforms the single empty extension. True when `Path.Combine(dir, fileName + ext)` exists as a file. Only the existence of a file is tested.
- `RunAsync(file, args, stdin?, timeout, ct)`: start the child with stdout and stderr redirected and decoded as UTF-8, stdin redirected (and encoded as UTF-8) only when `stdin` is not null, no shell, no window. A start failure with Win32 native error 2 or 3 becomes `FileNotFoundException("The executable '<file>' was not found.")`. Stdout, stderr, stdin writing, and process exit are all awaited concurrently under one token that combines the caller token and the timeout, so large prompts and large outputs cannot deadlock on pipe buffers.
  - Stdin writer: write all, flush, then close. A closed pipe (IOException or ObjectDisposedException) during write or close means "not fully delivered" and is not an error by itself. A cancellation during the write returns "not delivered" without closing.
  - On timeout or cancellation: kill the whole process tree (best effort), swallow late task exceptions. If the timeout fired and the caller did not cancel: throw `TimeoutException("'<file>' did not exit within <timeout>.")`; otherwise rethrow the cancellation.
  - After normal completion: if the stdin was not fully delivered **and** the exit code is 0, throw `IOException("'<file>' exited before reading all of its input.")` (a success with unread input may answer only part of the prompt). A non-zero exit with undelivered stdin returns normally so the real exit code and stderr drive the classification.
  - Return `{ ExitCode, StandardOutput, StandardError }`.

Prompts are sent whole; there is no chunking or budget for CLI providers.

### 3.8 Suggested title (`SuggestedMeetingTitle`)

Constants: max length 80. Placeholder pattern `^Meeting\s+\d` (case-insensitive, invariant).

- `Normalize(raw)`: null for blank. Take the first non-blank line, trimmed. `TrimStart('#')` then trim. If the value is at least 2 chars and wrapped by `"..."` or by curly `“...”` (U+201C and U+201D), strip the wrapping pair and trim (only these two pairs, not single quotes or guillemets). `TrimEnd('.')` then trim. If longer than 80, cut to 80 and trim. Empty gives null.
- `FromModelResponse(raw)`: blank gives null. If no line equals `## Title` after trim, return `Normalize(raw)`. Else collect the non-empty trimmed lines after it until a line starting with `## `, join with a single space, return null when none else `Normalize(joined)`. A response that is only `## Title` returns null.
- `LooksLikePlaceholder(title)`: blank, or matches the placeholder pattern after trim.
- `Resolve(current, suggested)`: normalize `suggested`; null gives `current`; if `current` looks like a placeholder return the normalized suggestion, else return `current`.

Auto-generated meeting titles come from `MeetingTitleFormat`, which is "Meeting {0}" in English and "Reunión {0}" in Spanish (bug B10).

### 3.9 Hardware profile and fit rating

`HardwareProfile(TotalRamGb, GpuName?, GpuVramGb?)`:

- `HasDedicatedGpu` = `GpuVramGb > 0`.
- `HasNvidiaGpu()` = name is non-blank and contains (case-insensitive) `NVIDIA`, `GeForce`, `Quadro`, or `Tesla`. A bare `RTX` does not count. Used by the ASR backend selection (another module).

`SummaryModelInfo.RateFor(hardware)`:

1. `Recommended` if `TotalRamGb >= MinRamGb` **or** (`HasDedicatedGpu` and `GpuVramGb >= MinRamGb / 2`).
2. Else `MayBeSlow` if `TotalRamGb >= MinRamGb * 0.75`.
3. Else `NotRecommended`.

### 3.10 xAI rules

HTTP client settings: timeout 5 minutes, `User-Agent: MeetingLive`.

**Model id resolution** (`XaiApiClient.ResolveModelId(selected, listed)`): if `selected` is non-blank and present in `listed` (case-insensitive), return it (as typed in `selected`). If `listed` is empty return `grok-4.6`. Else the first of the preference list present in `listed`: `grok-4.6`, `grok-4.7`, `grok-4.3`, `grok-4.5`, `grok-4-fast`. Else `listed[0]`. Default id constant: `grok-4.6`.

**Model list filter** (`IsSummaryChatModel`): id must start with `grok` (case-insensitive) and, in lowercase, must not contain `imagine`, `image`, `video`, `multi-agent`, or `build`; ids ending in `-reasoning` are dropped, but `-non-reasoning` is kept. `ListModels` also drops blank ids, de-duplicates case-insensitively, sorts by preference rank (index in the preference list, others after), then by id case-insensitively.

**Chat request** (`POST https://api.x.ai/v1/chat/completions`, JSON, camelCase DTOs with explicit snake_case names, nulls omitted):

```json
{
  "model": "grok-4.6",
  "messages": [{ "role": "user", "content": "<prompt>" }],
  "temperature": 0.3,
  "reasoning_effort": "low",
  "stream": true
}
```

`reasoning_effort` is omitted when blank (the trimmed effort otherwise). `stream` is present only for streaming (omitted, not false, otherwise). A blank model id is replaced by `grok-4.6`. Header `Authorization: Bearer <token>`. A blank token throws the not-signed-in error before any request.

**Non-streaming response**: `choices[0].message.content`; blank content throws `EmptyOutput` ("Grok (xAI) did not return any content."). Returned trimmed. Malformed JSON throws `RequestFailed` ("Grok (xAI) returned an unexpected response.").

**Streaming**: request with response-headers-read. Read lines; only lines starting with `data:` count; payload after the prefix is trimmed; `[DONE]` ends; empty payload is skipped; each payload is parsed as `choices[0].delta.content` and non-empty content is yielded (malformed JSON throws `RequestFailed` as above). If no non-whitespace content arrived at all, throw `EmptyOutput` at the end.

**Models request** (`GET https://api.x.ai/v1/models`): response `{ "data": [ { "id": "..." } ] }`. Malformed JSON throws `RequestFailed` "Grok (xAI) returned an unexpected model list.".

**HTTP errors** (`EnsureSuccess`): the body is read and discarded (never surfaced). 401 gives `NotSignedIn`. 402 or 429 gives `SubscriptionOrQuota` ("Grok (xAI) quota or subscription limit reached. Try again later, or check your xAI account."). Any other status gives `RequestFailed` ("Grok (xAI) could not complete that request.").

`XaiException(kind, message)`: kinds `NotSignedIn`, `SubscriptionOrQuota`, `AccessDenied`, `ExpiredToken`, `EmptyOutput`, `RequestFailed`. Messages never contain tokens.

`XaiSummaryProvider`: summarize = summary prompt (3.1) → chat → split; title = title prompt → chat; prompt = chat; stream = streaming chat. Each call first obtains a fresh access token from the auth session, so a long run does not hold a stale token. Constructed with the model id and effort; it re-runs `ResolveModelId(modelId, [])` before each call (bug B1).

**Device-code OAuth** (`XaiOAuthClient`, RFC 8628, against `auth.x.ai`). Constants:

| Name | Value |
|---|---|
| Client id | `b1a00492-073a-47ea-816f-4c329264a828` (the public Grok-CLI client id; xAI may revoke it) |
| Device authorization URL | `https://auth.x.ai/oauth2/device/code` |
| Token URL | `https://auth.x.ai/oauth2/token` |
| Scope | `openid profile email offline_access grok-cli:access api:access` |
| Referrer | `meetinglive` |
| Device grant type | `urn:ietf:params:oauth:grant-type:device_code` |
| Default poll interval | 5 s |
| Minimum interval | 1 s |
| Default device lifetime | 5 minutes |
| `slow_down` bump | +5 s |

- `RequestDeviceCode`: POST form `client_id`, `scope`, `referrer` to the device URL. Non-2xx, unparsable JSON, missing `device_code` or `user_code`, or a missing/invalid absolute `verification_uri_complete` (preferred) / `verification_uri` throws `RequestFailed` "Grok (xAI) could not start SuperGrok sign-in.". `interval` defaults to 5 s (floored to 1 s), `expires_in` defaults to 300 s (minimum 1 s). Response fields: `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, `interval`.
- `PollDeviceCodeToken(device)`: `interval = floor(device.Interval)`, `deadline = now + ExpiresIn` (or 5 minutes when `ExpiresIn <= 0`). While `now < deadline`: POST form `grant_type`, `device_code`, `client_id` to the token URL (no wait before the first attempt). A response with an `access_token` returns credentials. Else switch on the `error` field: `authorization_pending` waits `interval` and continues; `slow_down` raises `interval` by 5 s (floored) and waits; `access_denied` or `authorization_denied` throws `AccessDenied` "Sign-in was denied."; `expired_token` throws `ExpiredToken` "The sign-in code expired. Try again."; anything else (including an unparsable body, error `invalid_response`) throws `RequestFailed` "Grok (xAI) sign-in failed.". Falling out of the loop throws `ExpiredToken` "The sign-in code expired. Try again.". The wait function and the clock are injectable (tests use fake ones).
- `RefreshAccessToken(refreshToken)`: blank gives `NotSignedIn`. POST form `grant_type=refresh_token`, `refresh_token`, `client_id`. Outcome mapping: HTTP 429 or any 5xx gives `RequestFailed` with `RefreshUnavailableMessage`; a 2xx with an access token returns new credentials (keeps the old refresh token when the response has none); HTTP 401, or `error` in `invalid_grant`, `invalid_client`, `unauthorized_client`, gives `NotSignedIn`; anything else gives `RequestFailed` with the refresh-unavailable message. Network errors (`HttpRequestException`, `IOException`) and `HttpClient` timeouts (a cancellation the caller did not request) give `RequestFailed` with the same message. A cancellation requested by the caller propagates.
- Token response → credentials: `expiresAt` = now + `expires_in` seconds if present, else the `exp` claim of the access token if it is a JWT (`XaiJwt`), else null.
- Messages: `NotSignedInMessage` = `You're not signed in to Grok (xAI). Sign in with SuperGrok or save an API key in Settings.` and `RefreshUnavailableMessage` = `Grok (xAI) could not renew your sign-in right now. You are still signed in, so try again in a moment.`

**JWT peek** (`XaiJwt.TryReadExpiry`): split on `.`; need at least 2 parts; base64url-decode part 2 (replace `-` with `+`, `_` with `/`, pad with `=`), parse JSON, read numeric `exp` as Unix seconds. Any decode, parse, or range failure gives null. Not a trust decision.

**Auth session** (`XaiAuthSession`): holds credentials in the store and serializes refreshes.

- Refresh skew: 120 s. `NeedsRefresh` = (stored `ExpiresAt` or JWT `exp`) is known and `expiresAt - now <= 120 s`. Unknown expiry never refreshes.
- `GetAccessToken`: load; missing/blank token → `NotSignedIn`. API-key credentials are returned as is. OAuth credentials that do not need refresh are returned. Otherwise take the refresh lock, read the credential version and reload under a short gate lock; re-check (signed out → `NotSignedIn`; became API key or no longer needs refresh → return). No refresh token → `NotSignedIn`. Call refresh **outside** the gate lock. Under the gate lock again: if the version is unchanged, save the refreshed credentials and return its token; if it changed (the user signed out, signed in, or saved a key during the refresh), discard the refreshed result and return the current stored token, or `NotSignedIn` if none.
- `SaveApiKey(key)`: blank → `ArgumentException`; stores `{Kind: ApiKey, AccessToken: key.Trim(), RefreshToken: null, ExpiresAt: null}`, bumps the version. `SaveOAuth(credentials)` stores with kind forced to OAuth, bumps the version. `SignOut` clears the store and bumps the version. `HasCredentials` = stored token non-blank. `CredentialKind` = stored kind or null. Saving one kind replaces the other.
- `XaiCredentials.ToString()` prints only kind and expiry (secrets are hidden from default dumps).

### 3.11 Download rules (`LocalLlmModelManager`, `ResumableFileDownloader`)

- Model path = `<SummaryModelsDirectory>/<FileName>`. Downloaded = the file exists (no size or hash check). Delete = remove the file if present, otherwise nothing.
- Download: create the directory, GET with response-headers-read, require a success status, stream into `<final>.part` in 81,920-byte chunks, report progress `read * 100 / contentLength` (0 to 100) only when the length header is known and positive, then atomically move over the final path (overwrite). Any failure or cancellation deletes the `.part` file and rethrows. Despite its name the downloader never resumes a partial file and sends no `Range` header. The HTTP client for model downloads has no timeout (`Timeout.InfiniteTimeSpan`).

---

## 4. Persistence and wire formats

All paths below are relative to the app data root. In the .NET app, `RootDirectory` is `%LOCALAPPDATA%\MeetingLive`, and meeting files live under `Documents\MeetingLive` (`UserDataDirectory`). The port must keep the on-disk formats readable by both apps but must use its own isolated data folder during development.

### 4.1 Settings fields owned by this module (`settings.json`)

Written by `AppSettingsService` with `JsonSerializerDefaults.Web` (camelCase keys), indented, whole-file overwrite, one process-wide semaphore per operation. Example fragment:

```json
{
  "selectedSummaryModelId": "gemma-4-E2B-it-Q4_K_M.gguf",
  "selectedSummaryProvider": "Xai",
  "selectedXaiModelId": "grok-4.6",
  "selectedXaiEffort": "low",
  "selectedClaudeModelId": "sonnet",
  "selectedClaudeEffort": "low",
  "selectedCodexModelId": "gpt-5.6",
  "selectedCodexEffort": "low",
  "summaryLanguage": "es"
}
```

| Field | Type | Meaning and default |
|---|---|---|
| `selectedSummaryProvider` | string, enum name | `Local`, `ClaudeCode`, `Codex`, `Xai` (case-sensitive match on parse). Null, unknown, or numeric strings fall back to `Local`. Note `Enum.TryParse` also accepts numeric text such as `"7"` as a valid undefined value; the port should reject unknown names. |
| `selectedSummaryModelId` | string? | catalog `FileName` of the active local model |
| `selectedXaiModelId` | string? | xAI model id; null/empty means `grok-4.6` |
| `selectedXaiEffort` | string? | one of `none`, `low`, `medium`, `high`, `xhigh`; null means `low` |
| `selectedClaudeModelId` / `selectedClaudeEffort` | string? | null means `sonnet` / `low` |
| `selectedCodexModelId` / `selectedCodexEffort` | string? | null means `gpt-5.6` / `low` |
| `summaryLanguage` | string? | `es` or `en`; null/blank means `es` |

Settings are read-modify-write by several callers; each call reloads, mutates one field, and saves the whole object (see bug B19).

### 4.2 Meeting file fields written by this module

Defined by the meeting persistence module (`MeetingMarkdownFormatter`); this module only supplies the values.

- Frontmatter line `summaryProvider: <id>` when set (`local`, `claude-code`, `codex`, `xai`).
- Frontmatter line `noteTemplateId: <id>` when set (`one-on-one`, `standup`, `sales`, `user-interview`, `custom`; `auto` is never stored).
- Section `## Summary` followed by a blank line and the summary body. Omitted when the summary is empty.
- Section `## Action Items` followed by a blank line and the checklist. Omitted when there are no items.

```markdown
## Summary

### What this was
A planning meeting about the Q4 launch.

### Key points
- The beta moves to November 14.

## Action Items

- [ ] Send the revised deck — Owner: Ana — Due: Friday
- [x] Review the API contract
```

Headers inside the summary body that would collide with a section header are escaped by the formatter (a header-escaping scheme owned by the persistence module). Because model output often contains `## Decisions` style headings, that module must keep them inside the Summary section.

### 4.3 Custom note template file

Path `custom-note-template.json`. Written with `JsonSerializerDefaults.Web` and indentation (camelCase). Single object:

```json
{
  "name": "Board update",
  "instructions": "Shape the enhanced notes as a board update. Lead with metrics, then risks and asks."
}
```

Load deserializes case-insensitively under the Web defaults. A malformed file throws (it is not caught, bug B21). Writes truncate the file in place (not atomic).

### 4.4 xAI credentials file

Path `xai-credentials.bin`. Content: DPAPI (`CurrentUser` scope, no entropy) encryption of this UTF-8 JSON, written with Web defaults (camelCase). Enum values serialize as numbers (`0` = `ApiKey`, `1` = `OAuth`) because no string-enum converter is configured. `expiresAt` is an ISO 8601 string or null:

```json
{
  "kind": 1,
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "expiresAt": "2026-11-02T20:15:00+00:00"
}
```

API key form: `{"kind":0,"accessToken":"xai-...","refreshToken":null,"expiresAt":null}`.

Behavior: `Load` returns null for a missing file, an empty file, a decryption failure, a JSON failure, an I/O error, an access error, or a blank access token. `Save` throws for a blank access token, creates the directory, and overwrites the file in place. `Clear` deletes the file and ignores I/O and access errors. File access is serialized by a lock around load, write, and clear. The file was chosen over the Windows PasswordVault because xAI JWTs exceed its 512-character limit. The port needs an OS-credential-backed encryption (Electron `safeStorage`, which uses DPAPI on Windows and Keychain on macOS). The old DPAPI blobs are not readable by another encryption scheme, so existing sign-ins will not migrate (the user signs in again).

### 4.5 Model files

Directory `SummaryModels`, one file per downloaded catalog entry, file name = catalog `FileName`. In-progress downloads use `<FileName>.part`. A killed process can leave a stale `.part` file; the next download of that model overwrites it.

### 4.6 Wire formats summary

- Claude Code: `claude -p [--model m] [--effort e] [--tools WebSearch --allowedTools WebSearch]`, prompt on stdin (UTF-8), answer on stdout.
- Codex: `codex [--search] exec - [-m m] [-c model_reasoning_effort="e"]`, prompt on stdin (UTF-8), answer on stdout.
- xAI chat: section 3.10. OAuth: section 3.10. All JSON uses UTF-8.

---

## 5. Native and OS dependencies

### 5.1 Table

| Dependency | Where | Classification | Port guidance |
|---|---|---|---|
| llama.cpp inference via LLamaSharp 0.27.0, CPU backend only (`LLamaSharp.Backend.Cpu`) | `LocalLlmSummaryProvider` | Portable library, native binary per OS | The .NET app never offloads to the GPU, even though the catalog rates models by GPU VRAM. GPU offload is new capability in the port (see `docs/port/research/local-inference.md`). |
| GGUF tokenizer for budgeting | `weights.Tokenize` | Portable | Port needs a token counter from the same runtime that does inference. |
| WMI queries `Win32_ComputerSystem.TotalPhysicalMemory` and `Win32_VideoController` (Name, AdapterRAM) | `HardwareDetectionService` | Windows-only | Replace with `os.totalmem()` for RAM and a GPU probe (DXGI or `nvidia-smi` on Windows, Metal on macOS) behind a `HardwareDetection` interface. |
| DPAPI (`ProtectedData`, CurrentUser) | `FileDpapiXaiCredentialStore` | Windows-only | Use Electron `safeStorage` behind a credential-store interface. |
| `Process` spawn, PATH lookup with `PATHEXT`, process-tree kill | `CliProcessRunner` | Portable concept, Windows specifics | Node `child_process.spawn` with `shell: false`; resolve `.cmd`/`.exe` explicitly on Windows (see bug B11); kill the tree with `taskkill /T /F` on Windows and a process-group kill on macOS. |
| Windows `Launcher.LaunchUriAsync` | `XaiAuthDialogViewModel` | Windows-only | `shell.openExternal`. |
| Windows clipboard (`DataPackage`) | `SummaryPageViewModel` | Windows-only | Electron `clipboard.writeText`. |
| WinUI ContentDialog, SelectorBar, InfoBar, ComboBox, MarkdownTextBlock (CommunityToolkit) | all UI | Windows-only | Re-implement in the renderer; Markdown rendering with a sanitizing renderer. |
| System brushes `SystemFillColor{Success,Caution,Critical}Brush` | `FitRatingPresentation` | Windows-only | Map to brand tokens. Do not use the live-recording red for "Not recommended". |
| HTTPS to `huggingface.co` (follows redirects) | model download | Portable | Main-process download with progress events. |
| HTTPS to `api.x.ai` and `auth.x.ai` | xAI | Portable | Main process only; tokens must never reach the renderer. |
| Embedded resources (`ResourceManager`) and `.resw` | strings | Portable concept | JSON catalogs per locale with the same keys. |

### 5.2 Process and credential boundaries

The user's Claude Code, Codex, and xAI accounts are not used while porting; those paths are tested with doubles (`FakeCliProcessRunner`, in-memory credential store, fake HTTP handlers) and must be flagged as pending real validation.

### 5.3 Cross-module dependencies

- Meeting persistence: `IMeetingRepository` (`GetByIdAsync`, `GetAllAsync`, `SaveAsync`) and the `MeetingRecord` fields `Title`, `Transcript`, `Summary`, `ActionItems`, `SummaryProvider`, `NoteTemplateId`, `Notes`, `Attendees`, `RecordedAt`, `EndedAt`, `Id`.
- Workspace/navigation: `Workspace.SelectMeeting`, `NotifyMeetingChanged`, `LastProcessedMeeting`, `OpenSession(TabSummary)`, `NavigateTo(Recording)`, `SelectedMeetingId`.
- Recording pipeline (`RecordingPipelineOrchestrator`) and re-transcription (`MeetingRetranscriptionRunner`): call `SummarizeAsync` with the agenda and template instructions, then `SuggestedMeetingTitle.Resolve`. They use the same resolver gate.
- Chat, personal tasks, live copilot, brief: `CompletePromptAsync` and `StreamPromptAsync`; live answer path uses the web-search variant.
- Jev analysis (`MeetingJevRunner`, TypeSafe API): runs after each manual summary.
- Transcript polishers (`LocalLlmTranscriptPolisher`, Claude, Codex, xAI): share `CliToolProviderBase`, `ICliProcessRunner`, `XaiApiClient`, and the model id and effort resolution.
- Settings page: hosts the provider section, the local model list (`LocalModelSectionViewModel`), and the xAI dialog.
- ASR: `HardwareDetectionService` and `HasNvidiaGpu()` are also used by the transcription backend selection.
- Related meetings: `RelatedMeetings.Find` and `RelatedMeetingItem`.
- Strings: `AppStrings`, `CoreStrings`, and the `MeetingTitleFormat` key.
- Path layout: `AppPaths.SummaryModelsDirectory`, `CustomNoteTemplateFilePath`, `XaiCredentialsFilePath`, `SettingsFilePath`.

---

## 6. Existing test coverage (`MeetingLive.Core.Tests`)

The listed cases must carry over, translated to the port's test framework. Nothing in `MeetingLive.App` (view models, resolvers, dialogs) has automated tests in this repository.

| Test class | Cases that must carry over |
|---|---|
| `Models/HardwareProfileTests` | `HasNvidiaGpu` true for NVIDIA/GeForce/Quadro/Tesla tokens; false for non-NVIDIA names, null, and a bare "RTX". |
| `Models/SummaryModelInfoTests` | `RateFor`: RAM meets minimum gives Recommended; RAM between 75% and 100% gives MayBeSlow; far below gives NotRecommended; GPU VRAM covering half the minimum gives Recommended. |
| `Services/ModelCatalogTests` | Four curated entries; ordered by ascending `MinRamGb`; all https URLs and positive file sizes. |
| `Services/HardwareDetectionServiceTests` | Second call returns the cached instance. |
| `Services/LocalLlmModelManagerTests` | Path combine; not downloaded when missing; download writes the response bytes to the path; a failed request leaves no partial file; delete removes the file; delete of a missing file does not throw. |
| `Services/ResumableFileDownloaderTests` | Part file exists mid-download but the final path does not; completion moves the part file with content intact; cancellation deletes the part file and throws. |
| `Services/LocalLlmSummaryProviderTests` | Summarize, CompletePrompt, and StreamPrompt throw `FileNotFoundException` when the model file is missing; Dispose before load does not throw. |
| `Services/LocalLlmSummaryMapReduceTests` | Fits goes through in one call; long transcripts keep every prompt inside the context; no line is lost; final prompt is the full contract; notes that do not fit are merged within budget; a line longer than a chunk is split without losing words; cancellation stops before the next call; over-limit transcript fails before any inference; supplied notes that leave no room fail before inference; a failing chunk surfaces its error; `SplitToBudget` keeps lines together in order, keeps every character when there is no whitespace, and never splits a surrogate pair. |
| `Services/CliSummaryPromptBuilderTests` | `ended_at` tag present when set and the "never not recorded" rule present; tag absent when omitted; raw notes block present with the output contract intact; no raw notes block without enhancement. |
| `Services/SummaryMarkdownSplitterTests` | Both headers; no headers falls back to the first checkbox; no action items returns the whole response; empty action section returns empty list; title extracted and stripped from the body; missing title gives null and an unchanged two-header body; blank lines in the title joined; wrapping quotes kept for later normalization. |
| `Services/SuggestedMeetingTitleTests` | Normalize: null/blank, first non-empty line, leading hashes, wrapping quotes (straight and curly), trailing period, 80-char truncation, empty after cleaning; `LooksLikePlaceholder` for auto titles; `FromModelResponse`: plain, wrapped in heading, title block then summary, quoted, empty, heading-only; `Resolve`: null suggestion, placeholder current, empty current, user-named current, suggestion that normalizes to null. |
| `Services/NoteTemplateCatalogTests` | Auto and unknown give null; built-ins name the required shape; `NormalizeId` omits auto and blank. |
| `Services/JsonCustomNoteTemplateStoreTests` | Override path never writes to app paths; save then load round-trips; missing file returns null; blank name or instructions throws. |
| `Services/CliInvocationTests` | Claude bare `-p`; model and effort flags; web-search tool flags and their order after the model; Codex bare `exec -`; model and effort flags; `--search` prefix before `exec`. |
| `Services/CliFailureMapperTests` | Exit code and stream matrix to kind; not on PATH gives NotInstalled; credential text is not misread as subscription; `TimeoutException`, `FileNotFoundException` mapping; friendly text without exit code; Unknown includes a sanitized snippet with no secrets and no exit code; `Wrap` of a timeout. |
| `Services/CliToolProviderBaseTests` | Success invokes the right executable, arguments, and stdin and returns trimmed stdout; not on PATH gives NotInstalled with the provider display name; non-zero exit gives a classified exception; empty stdout gives EmptyOutput. |
| `Services/CliProcessRunnerTests` | PATH lookup true and false; exit code and stdout capture; stdin delivery; Spanish UTF-8 round trip; missing executable gives `FileNotFoundException`; timeout kills the process and throws; child that fails without reading stdin reports its exit code and stderr; early auth failure is classified from the real failure; success without reading all stdin is not reported as success; full-pipe echo does not deadlock; hang without reading stdin times out; caller cancellation while stdin is blocked throws cancellation. |
| `Services/ClaudeCodeCliSummaryProviderTests` | Invocation and parse; suggested title set; classified failure; empty output; title-only prompt returns a normalized title; English output language; Spanish subheadings; `ended_at` present and absent; `CompletePrompt` sends stdin; web search on and off arguments. |
| `Services/CodexCliSummaryProviderTests` | Invocation (`exec -`) and parse; classified failure; empty output; `CompletePrompt`; web search on and off. |
| `Services/XaiApiClientTests` | Bearer plus JSON body; 401 gives not-signed-in; no stream flag on non-streaming; stream flag and delta parsing until `[DONE]`; stream 401; stream with no content gives EmptyOutput; model list filtering; `IsSummaryChatModel` matrix; `ResolveModelId` matrix (saved, preferred, first, default, ignores unknown saved id). |
| `Services/XaiAuthSessionTests` | Expired token refreshes and rotated refresh token persists; API key never refreshes; saving an API key replaces OAuth; missing `expires_in` uses the JWT `exp`; sign-out during refresh persists nothing; API key saved during refresh is kept; sign-out does not wait for the network; transient refresh failures keep stored credentials. |
| `Services/XaiOAuthClientTests` | Device request form fields; pending then success; access denied throws; refresh posts the token and returns new access; non-auth failure gives RequestFailed; auth rejection gives NotSignedIn; network error and `HttpClient` timeout give RequestFailed; caller cancellation still cancels. |
| `Services/XaiSummaryProviderTests` | Summary and action items parsed; title prompt used; prompt sent in the chat body; stream yields chunks. |
| `Services/FileDpapiXaiCredentialStoreTests` | In-memory store round trip; the file store protects and restores. |

Gaps (no tests exist): `ActionItemParser` directly (only through the splitter), `NoteTemplateInstructions.ResolveAsync`, `XaiJwt` directly, the xAI auth dialog view model, the setup wizard view model, the resolvers, the settings section view model, the summary page view model, and `CliFailureUserMessage`. The port should add tests for each of these.

---

## 7. Bugs, races, and uncovered cases

Each item gives the evidence and the proposed handling in the port. "Confirmed" means shown by code reading; "suspected" needs a runtime check.

**B1. The saved xAI model is never used for summaries (confirmed).** `AppServices.ResolveXaiModelId` calls `XaiApiClient.ResolveModelId(saved, [])` (`App/Services/AppServices.cs:180`). With an empty list the function returns `grok-4.6` regardless of `saved`. `XaiSummaryProvider` then calls `ResolveModelId(modelId, [])` again before every request (`Core/Services/XaiSummaryProvider.cs:53`, `:67`; the polisher at `XaiTranscriptPolisher.cs:21` does the same). The test `ResolveModelId_PicksSavedThenPreferredThenFirst` confirms that an empty list returns the default (`XaiApiClientTests.cs:173`). Result: every xAI call uses `grok-4.6` even when the user chose another model in Settings. Port: pass the saved model through unchanged and let the API reject an unknown id with a readable error.

**B2. Claude, Codex, and xAI model and effort settings are likely ignored (confirmed by static reading).** `LoadSettingsSnapshot` deserializes `settings.json` with `JsonSerializer.Deserialize<AppSettings>(json)` and default options (`App/Services/AppServices.cs:194`). The file is written with Web defaults, which produce camelCase keys (`Core/Services/AppSettingsService.cs`, `JsonSerializerDefaults.Web`). Default `System.Text.Json` matching is case-sensitive, so `selectedClaudeModelId` does not bind to `SelectedClaudeModelId` and the snapshot returns defaults: `sonnet`/`low`, `gpt-5.6`/`low`, xAI effort `low`. The failure is silent because the broad `catch` returns defaults. Runtime check pending. Port: one settings reader used everywhere.

**B3. Local model weights are never released (confirmed).** `AppServices.CreateSummaryProvider(Local, ...)` creates a new `LocalLlmSummaryProvider` per resolve (`AppServices.cs:107`) and no caller in `MeetingLive.App` disposes it (no `Dispose`, no `using`). The provider owns up to 7 GB of native weights and reloads them on every summary. Port: keep one loaded model per path, dispose on model change and on app exit.

**B4. Stale-record overwrite (confirmed).** The Summary page loads the record once (`SummaryPageViewModel.LoadAsync`) and later saves that same object after a generation that can take minutes (`SaveAsync(_record)` at `ViewModels/SummaryPageViewModel.cs:237`) and after every checkbox toggle (`:405`). Any edit made elsewhere in between (rename in the session page, folder filing, notes saved through another path) is overwritten. `SaveNotesAsync` already reloads before writing to avoid exactly this; generate and toggle do not. Port: apply field-level patches (summary, action items, provider, template id, title) onto a freshly loaded record.

**B5. Action item toggle saves are fire-and-forget and unordered (suspected).** `OnActionItemChanged` is `async void` and saves the whole record per toggle (`:398-405`); two fast toggles can race two writes. Port: queue patches per meeting.

**B6. Model download cannot be cancelled and survives the dialog (confirmed).** `DownloadSelectedModelAsync` passes no token (`ViewModels/SummaryModelSetupDialogViewModel.cs:210`), the dialog offers only "Cancel" which hides it, and the task continues. When it ends it saves `SelectedSummaryModelId` and `SelectedSummaryProvider` to settings and raises `Completed` on a closed dialog, after the caller already received null (`ShowForLocalModelAsync`) and aborted. Settings then change silently. Port: cancellable download tied to the dialog, with explicit "Cancel download".

**B7. Download error is invisible (confirmed).** After a failure the view model sets `DownloadStatusText` and returns to `SelectingModel`, but only the `Downloading` panel binds that text (`Dialogs/SummaryModelSetupDialog.xaml`). The user sees the list again with no message. Port: render the error in the selection state with a retry.

**B8. Local title, chat, and stream prompts are unbudgeted (suspected).** Only `SummarizeAsync` measures prompts (`LocalLlmSummaryMapReduce`). `SuggestTitleAsync` sends the full transcript (`Core/Services/LocalLlmSummaryProvider.cs:46-53`) and `CompletePromptAsync`/`StreamPromptAsync` send whatever the caller built, into a 4096-token context. The map-reduce header says the overflow behavior of LLamaSharp "was not verified and must not be relied on". A long meeting's title regeneration may fail or produce garbage. Port: measure and truncate or map-reduce those prompts, and fail with a readable message.

**B9. Local chat answers are capped at 512 tokens (confirmed, design limit).** `PromptMaxTokens = 512` (`LocalLlmSummaryProvider.cs:62`) truncates long chat or checklist answers without a signal. Port: raise the cap based on remaining context and signal truncation.

**B10. Spanish UI never gets AI titles on summarize (confirmed).** `SuggestedMeetingTitle.Resolve` replaces the title only if it matches `^Meeting\s+\d` (`Core/Services/SuggestedMeetingTitle.cs:15`). Auto titles come from `MeetingTitleFormat` (`App/AppStrings.cs:18`), which is `Reunión {0}` in Spanish (`App/Strings/es/Resources.resw:290`). Those titles are not recognized as placeholders, so summarize never renames them. Port: recognize every localized placeholder, or mark placeholder titles with a flag in the record.

**B11. A CLI found on PATH may not be launchable on Windows (suspected).** `IsOnPath` accepts `.CMD`/`.BAT` through `PATHEXT` (`CliProcessRunner.cs` `IsOnPath`), but `Process.Start` with `UseShellExecute = false` and a bare name resolves only `.exe` through `CreateProcess`. An npm-installed `codex.cmd` would pass the check and then fail with Win32 error 2, mapped to "not installed". Port: resolve the full path of the match found on PATH and launch that (use a shell or `cmd /c` for `.cmd`/`.bat`).

**B12. Failure classification can misfire (confirmed mechanism, suspected impact).** `Classify` searches `stdout + " " + stderr` (`CliFailureMapper.cs:31`) and checks "not installed" first. A non-zero exit whose stdout contains words from a meeting summary (`billing`, `quota`, `credit`, `payment`) is reported as a subscription problem; stderr such as "model not found" or "404 Not Found" is reported as "not installed"; the whole word `auth` or `token expired` in an unrelated message maps to "not signed in". Port: classify on stderr first, and match on structured exit codes and known CLI messages; only fall back to stdout for known sentinel strings.

**B13. Summary generation cannot be cancelled (confirmed).** The page passes no token to `SummarizeAsync` (`SummaryPageViewModel.cs:220`) and shows only a spinner. A five-minute CLI run or a long local run blocks regenerate and cannot be stopped; leaving the page does not stop it. Port: a Cancel button and a token that reaches the provider and kills the CLI.

**B14. xAI sign-in aborts on a transient error (confirmed).** `TryExchangeDeviceCodeAsync` has no error handling (`XaiOAuthClient.cs:177-190`): an `HttpRequestException` during polling propagates raw (its English text goes to the dialog), and any non-JSON or 5xx response yields `invalid_response`, which hits the `default` branch (`:120`) and throws `RequestFailed` immediately. A single dropped packet cancels a login that has up to five minutes left. Port: retry transient network and 5xx/429 responses within the device lifetime, and wrap errors in `XaiException`.

**B15. Action items refresh waits for Jev (confirmed).** After the summary is saved, the view model awaits `MeetingJevRunner.TryAnalyzeAndSaveAsync` with no token and only then rebuilds the checklist (`SummaryPageViewModel.cs:254-255`). The spinner keeps running and a regenerate shows stale checkboxes for the duration of a call that can take up to the TypeSafe client timeout (2 minutes). Port: refresh the list immediately and run analysis in the background.

**B16. The draft InfoBar shows an error title on success (confirmed).** The InfoBar always uses `SummaryPage_DraftError.Title` = "Could not create the draft" (`SummaryPage.xaml:150`) even for the success message "Action items copied to the clipboard.". The message also never clears except on load. Port: no title for success, auto-dismiss.

**B17. Hardware detection can misreport and can fail permanently (confirmed, failure suspected).** `AdapterRAM` is a 32-bit WMI field (the code comment says it misreports above 4 GB), and any adapter with a non-zero value counts as "dedicated" (`HardwareDetectionService.cs:42-43`, `HardwareProfile.HasDedicatedGpu`), so an integrated GPU with a 1 GB aperture is rated as dedicated, and an 8 GB card reports at most 4 GB. The fit rating then lets GPU memory satisfy the model's RAM need (`RateFor`) although the Local provider has only the CPU backend (`MeetingLive.Core.csproj:13`), so the 12B model can be rated Recommended on a machine that will run it on CPU. The `Lazy` that caches the profile also caches an exception from a failed WMI call for the process lifetime (`HardwareDetectionService.cs:10`, thread-safety mode `ExecutionAndPublication`). Port: rate by what the chosen runtime can actually use; detect VRAM through a reliable probe; do not cache failures.

**B18. Downloads have no integrity check and no resume (confirmed).** `ResumableFileDownloader` is not resumable (no `Range`), checks no hash or expected size, and "downloaded" means "file exists". Two downloads of the same model (wizard and Settings list) write the same `.part` file (suspected race). A truncated body without a length mismatch error would be accepted. Port: verify size or hash, true resume, one download per model.

**B19. Settings read-modify-write races (suspected).** Each mutation does `LoadAsync` then `SaveAsync` as two separately locked operations (`SettingsSectionViewModelBase.SaveSettingsAsync`). Two concurrent mutators can lose one update. The wizard, the Settings section, and the model list all use this pattern. Port: a single serialized settings update function.

**B20. Catalog labels are resolved once (confirmed).** `ModelCatalog.SummaryModels` is a `static readonly` list whose labels come from `CoreStrings.Get` at type initialization, in the culture active then. Changing the UI language later leaves the model speed, quality and use-case labels stale until restart. Port: resolve labels at render time.

**B21. A corrupt custom template file breaks the template list (confirmed).** `JsonCustomNoteTemplateStore.LoadAsync` does not catch `JsonException`; `NoteTemplateOption.LoadAsync` awaits it with no handler, so a bad file makes the Summary page fail to load the combo box and generation fail to resolve `custom`. Port: treat unreadable as absent and keep a backup.

**B22. xAI credentials file is not written atomically (suspected).** `File.WriteAllBytes` over the live file (`FileDpapiXaiCredentialStore.cs:69`). A crash mid-write leaves a truncated blob, which `Load` reports as null, signing the user out silently. Same pattern for `custom-note-template.json` and `settings.json`. Port: write to a temp file and rename.

**B23. OAuth refresh only happens on a known expiry (confirmed).** `NeedsRefresh` returns false when neither `ExpiresAt` nor a JWT `exp` is known (`XaiAuthSession.cs:127-133`), and a 401 from the API is mapped to "not signed in" with no refresh-and-retry (`XaiApiClient.EnsureSuccessAsync`). An opaque access token without `expires_in` is therefore never renewed even with a valid refresh token. Port: on 401 with a refresh token, refresh once and retry.

**B24. Stdin BOM risk for CLI input (suspected).** `StandardInputEncoding = Encoding.UTF8` (`CliProcessRunner.cs:53`) may prefix the prompt with a UTF-8 byte order mark. The Spanish round-trip test passes, but the test child may tolerate a BOM. Port: write UTF-8 bytes without a BOM.

**B25. Splitter header matching is brittle (suspected).** Only an exact trimmed `## Action Items` and `## Title` are recognized (`SummaryMarkdownSplitter.cs:28`). A reply in a code fence (the prompt forbids it, models still do it), `## Action items`, or `**Action Items**` falls to the checkbox fallback and leaves the header or fence in the summary body. A leading code fence also prevents the `## Summary` header from being stripped. Port: tolerate fences and case differences in headers.

**B26. Action item parser is narrow (confirmed).** Requires `- [ ] ` with exactly one space before `[` and at least one space after `]`; `* [ ]`, `-  [ ]`, `- [ ]` with empty text, and numbered lists are dropped silently (`ActionItemParser.cs:14`). The splitter's fallback regex has the same shape. Port: accept `*` and `+` bullets and flexible spacing.

**B27. Non-English output language mismatch (confirmed).** Only `en` gets English subheadings; `fr`, `de`, and every other code get Spanish subheadings and Spanish action examples while the body language follows `ToEnglishLanguageName` (`CliSummaryPromptBuilder.cs`). The language options currently offered are `es` and `en`, so it is latent. Port: localize headings per language or restrict codes.

**B28. English error text in a Spanish UI (confirmed).** Local-model messages, `FileNotFoundException` text, all `XaiException` messages, and `RefreshUnavailableMessage` are hard-coded English in Core and are shown verbatim (`CliFailureUserMessage.Format` returns `ex.Message` for non-CLI exceptions). Port: error codes in Core, text in the UI layer.

**B29. xAI model combo can overwrite the saved choice with the default (confirmed).** If the live model list comes back empty (`data` missing, or every id filtered out), `RefreshXaiAccountAsync` resolves against `[]`, gets `grok-4.6`, selects it, and writes it to settings (`SummaryProviderSectionViewModel.cs:~289-298`). The user's earlier choice is lost.

**B30. CLI model and effort values go into the command line unvalidated (suspected, low).** `Quote` wraps in quotes only when there is a space and does not escape embedded quotes; the effort is appended raw (`CliInvocation.cs:32`). The values come from a settings file the user can edit, so a crafted value changes the command line. Port: allow-list the values or pass them as separate argv items.

**B31. Fixed 5-minute CLI timeout and no large-transcript handling (confirmed, design).** Claude, Codex, and xAI receive the whole transcript; there is no length check or chunking. Very long meetings can exceed the timeout or the model's context.

**B32. Wizard CLI path never checks sign-in (confirmed, design).** `CheckCli` accepts any executable on PATH and completes. A not-signed-in CLI fails later at summarize time with the "session expired" message.

**B33. `ShowForLocalModelAsync` flash (confirmed, cosmetic).** The dialog shows the engine chooser until `Loaded` triggers local initialization (`SummaryModelSetupDialog.xaml.cs:19-20`).

**B34. Wizard status text for the "setup cancelled" case is shared with failures (confirmed).** `Status_SetupCancelled` is shown whenever the gate returns null, including when the model download failed after the user tried.

**B35. `Enum.TryParse` accepts numeric strings (confirmed).** `AppSettings.ResolveSummaryProviderKind` (`AppSettings.cs`) returns any integer string as a valid `SummaryProviderKind`; a value like `"9"` then reaches the factory and throws `ArgumentOutOfRangeException` ("Unknown summary provider kind."). Port: strict name matching.

---

## 8. Parity checklist

Tick each line when the port reproduces the behavior (or when a deliberate, documented fix replaces it). Items tagged `FIX Bn` implement the corrected behavior from section 7 and are part of parity.

### Provider contract and results

1. `ISummaryProvider` offers summarize, suggest title, complete prompt, and stream prompt, with the parameter set in 2.1.
2. `SummaryResult` carries the summary Markdown, the parsed action items, the provider id, and an optional suggested title.
3. Provider ids are exactly `local`, `claude-code`, `codex`, `xai`.
4. Stream prompt defaults to one chunk equal to the full completion; Local and xAI stream for real; chunks concatenate to the full answer.
5. The suggested title comes from the same model response as the summary; no second inference on the summarize path.
6. All four providers use the same prompt builder and the same splitter.

### Prompts

7. Summary prompt text matches 3.1 verbatim, including the en dash in "3–8".
8. Language name mapping: blank or unknown gives Spanish; `es en pt fr de it nl ja zh` map as listed; input is trimmed and lowercased.
9. Subheadings and action examples are English only for `en` (trimmed, case-insensitive), Spanish otherwise.
10. `<ended_at>` is emitted only when an end time exists, in ISO 8601 round-trip form.
11. `<recorded_at>` is always emitted in ISO 8601 round-trip form.
12. Enhancement suffix is added only when at least one of raw notes, attendees (non-blank), agenda, template instructions is present.
13. Enhancement rules text matches 3.1; the raw-notes rule line appears only with raw notes.
14. Enhancement blocks appear in the order raw notes, attendees, agenda, template instructions; values are trimmed; attendees are comma-space joined and blank names dropped.
15. Title-only prompt matches 3.2 verbatim.
16. Local part prompt matches 3.5 verbatim.
17. Local merge prompt matches 3.5 verbatim.

### Splitter and action items

18. Split normalizes CRLF to LF.
19. Title is the first `## Title` block, non-empty lines joined by a space, null when empty or absent, and is not normalized by the splitter.
20. Action section starts at the first exact `## Action Items` line; fallback is the first checkbox line.
21. With no action section and no checkbox line the whole reply is the summary and the item list is empty.
22. Title block is removed from the summary; a leading `## Summary` header is removed; the result is trimmed.
23. Action item regex and rules match 3.4 (FIX B26 allows `*` and `+` bullets and flexible spacing).
24. Parsed text is trimmed; done is true for `x` and `X`.
25. Render emits `- [x] ` or `- [ ] ` per item with a newline each, empty for no items.
26. FIX B25: splitter tolerates code fences and header case differences.

### Title handling

27. `Normalize` follows 3.8 step by step (first non-blank line, strip leading `#`, strip wrapping straight or curly double quotes, strip trailing periods, cap 80, null if empty).
28. `FromModelResponse` follows 3.8, heading-only gives null.
29. `Resolve` replaces only placeholder titles; blank counts as a placeholder.
30. FIX B10: every localized placeholder title is recognized.
31. Summary page applies `Resolve`; explicit title suggestion always applies `FromModelResponse`.
32. A changed title updates the page title, the last-processed meeting title, and notifies the workspace.

### Local provider

33. Context window 4096; final cap 1024; notes cap 640; safety margin 128; max parts 64; max merge passes 8.
34. Summary temperature 0.3; prompt and stream temperature 0.2; prompt cap 512; title cap 80 (FIX B9 and B8 define the replacement).
35. Chat template applied; stateless inference per call.
36. Missing model file throws with the exact message in 3.5 before any load.
37. Weights load lazily once per instance under a lock.
38. Empty generation throws "The local model did not return any content.".
39. Token counting uses the model tokenizer with BOS and special tokens.
40. Direct path used when the full prompt fits (`RoomFor >= 0` at cap 1024).
41. Too-long notes/agenda/template error raised before any inference when the empty-transcript prompt leaves less than 640 tokens.
42. Part budget computed from the empty part prompt at cap 640.
43. More than 64 parts raises the exact error with the part count.
44. Each part summarized in order with cancellation checks; prompt numbering is 1-based.
45. Notes merged in passes until the final prompt fits; grouping budget from the empty merge prompt at cap 640; +2 tokens per note; single-note groups pass through unchanged.
46. No-progress detection (groups equal notes) stops the loop; the failure message is the exact "could not condense" text.
47. Final prompt inferred at cap 1024; cancellation checked before it.
48. `SplitToBudget` rules: +1 per line, flush on overflow, long lines split, whitespace-only chunks dropped.
49. Long-line splitting by binary search, prefers whitespace in the second half, never splits a surrogate pair, always makes progress.
50. Every prompt (part, merge, final) fits in the context with the safety margin.
51. No transcript line or word is lost in map-reduce.
52. FIX B3: model weights are released on provider disposal and reused across calls.
53. FIX B8: title, prompt, and stream prompts are budgeted.
54. Sampling parameters other than temperature are chosen explicitly and recorded.

### CLI providers

55. Claude and Codex executables are `claude` and `codex`; display names `Claude Code` and `Codex`; timeout 5 minutes.
56. Claude arguments: `-p`, `--model`, `--effort`, `--tools WebSearch --allowedTools WebSearch` in that order; model quoted only when it has a space.
57. Codex arguments: `exec -`, `-m`, `-c model_reasoning_effort="…"`, with `--search` before `exec` for web search.
58. Prompt goes to stdin as UTF-8 (FIX B24: no BOM); answer is trimmed stdout.
59. Not on PATH throws NotInstalled before spawning.
60. Non-zero exit throws a classified exception; empty stdout with exit 0 throws EmptyOutput.
61. `OperationCanceledException` is never wrapped.
62. Other exceptions are wrapped with the right kind; a `CliToolException` passes through.
63. Timeout kills the process tree and throws a timeout error.
64. Caller cancellation kills the process tree and rethrows the cancellation.
65. Stdout, stderr, and stdin run concurrently (no pipe deadlock) under one timeout.
66. A closed stdin pipe is not an error by itself; success with undelivered stdin is an error.
67. Spawn failure for a missing executable maps to NotInstalled.
68. PATH lookup uses the platform separator, ignores blank entries, uses `PATHEXT` on Windows.
69. FIX B11: the resolved executable path is what gets launched.
70. FIX B30: model and effort values are validated or passed as separate arguments.
71. Web-search variants are created only for the live-answer path.

### Failure classification and messages

72. Classification order and keyword lists match 2.5 (FIX B12 narrows the input).
73. Each kind maps to its message key with the provider display name inserted.
74. Unknown failures append a sanitized snippet (secrets redacted, whitespace collapsed, 120 chars with an ellipsis) and never the exit code.
75. Redaction pattern matches 2.5.
76. UI mapping from kind to `Error_Cli*` keys; non-CLI exceptions show their message.
77. FIX B28: error text is localized in the UI layer.

### Summary tab

78. Page resolves the meeting from the navigation id, else the workspace selection, else the most recent by recorded time.
79. Loading selects the meeting in the workspace and clears status and draft messages.
80. Title shows "No summaries yet" when no meeting exists.
81. Derived flags (`HasSummary`, `CanGenerate`, `CanRegenerate`, `IsEmpty`, `ShowNoteTemplate`, `ShowSummaryActionBar`, `ShowDraftActions`) follow 2.2.
82. Layout, element visibility, sizes, and automation ids match 2.2.
83. Mode bar has "My notes" and "Enhanced", default Enhanced, visible only with a meeting.
84. Empty state text and "Record a meeting" navigation.
85. Summary rendered as sanitized Markdown, action items listed below it under "Action items".
86. Generate runs only with a transcript and not while generating.
87. Regenerate asks for confirmation with the exact dialog text and only the primary button proceeds.
88. Provider kind resolved from settings; readiness gate runs before generation; failure sets "Setup cancelled.".
89. Summary language from settings (default `es`).
90. Template id normalized; instructions resolved; enhancement built from notes, attendees, null agenda, template instructions.
91. Generation passes record title, recorded time, end time, language, enhancement (only when non-empty).
92. On success the record gets summary, action items, provider id, template id, and a resolved title, then is saved.
93. Status messages: generating, generated, error with formatted failure.
94. Buttons and commands disabled while generating.
95. FIX B13: generation can be cancelled.
96. FIX B4: saves apply field patches to a fresh record.
97. FIX B15: action items refresh immediately; Jev runs in the background.
98. Action item toggle persists immediately; failure shows `Error_SaveActionItem`. FIX B5: ordered saves.
99. Copy action items: no items gives the error message; success copies rendered lines without the trailing newline and shows the success message; clipboard failure shows the failure text.
100. FIX B16: success draft message has no error title and dismisses itself.
101. Raw notes editor mirrors edits into the in-memory record, saves on blur, on mode switch, and on page unload, comparing to the stored value and writing null for blank.
102. Notes save reloads the record first and skips the write when unchanged.
103. Related meetings (max 5) listed and clickable to open that meeting's Summary tab.
104. Copy command returns notes or summary depending on the mode, null when blank.
105. Combo box selection is restored from the record's template id after load without writing back.

### Templates

106. Built-in ids and display names as in 2.3, in that order, custom last when it has a name.
107. Built-in instruction texts match 2.3 verbatim.
108. `NormalizeId` and `InstructionsFor` follow 2.3 (case rules included).
109. `NoteTemplateInstructions.ResolveAsync` follows 2.3.
110. Custom template dialog matches 2.4 (fields, labels, buttons, disabled-until-valid behavior, trimmed result).
111. "Save as custom template" prefills from the stored template and selects `custom` after saving.
112. Store rejects blank name or instructions with the exact messages, trims, creates the directory, serializes access.
113. Store load returns null when absent. FIX B21: unreadable file treated as absent.
114. Only one custom template exists.

### Hardware, catalog, models

115. Hardware profile exposes RAM, GPU name, VRAM; `HasDedicatedGpu` rule; `HasNvidiaGpu` rule with the four tokens.
116. Hardware profile detected once and cached. FIX B17: failures are not cached; GPU memory and dedicated status come from a reliable probe.
117. Fit rating rules and thresholds as in 3.9 (0.75 factor, half-minimum VRAM rule). FIX B17: rating reflects what the runtime can use.
118. Catalog entries, order, sizes, minimum RAM, URLs, and label keys as in 3.6.
119. FIX B20: labels resolved at render time.
120. Model path is `<models dir>/<FileName>`; downloaded means the file exists. FIX B18: verified size or hash.
121. Download streams to `.part`, reports 0 to 100 only with a known length, moves into place on success, deletes the part file on failure or cancellation.
122. Download client has no timeout.
123. FIX B18: true resume, one download per model.
124. Delete removes the file if present and ignores a missing file.
125. Deleting the active model clears the selected model id.

### Setup wizard

126. Dialog title, cancel button, size, and state panels as in 2.6.
127. Engine buttons in the order Claude Code, Codex, Grok (xAI), Local with the exact names and hints.
128. Local choice runs hardware detection, builds options with fit ratings and downloaded flags, picks the default selection (first downloaded, else first recommended, else first).
129. Hardware summary strings with and without GPU.
130. Model rows: display name with "(downloaded)", use case, speed/quality/size line, fit badge with label and color.
131. Selecting a downloaded model finishes immediately.
132. Download state shows progress bar and percent text. FIX B6: cancellable. FIX B7: errors visible in the selection state.
133. Finishing with a local model saves model id and provider `Local`, sets the result path, and closes.
134. CLI choice checks PATH; found saves the provider kind and closes; missing shows the not-found text with the install hint; Check again and Back as specified.
135. Install hints and executable names for both CLIs as in 2.6.
136. xAI choice finishes immediately when credentials exist, otherwise hands off to the sign-in dialog; success saves provider `Xai`; cancel returns to a fresh chooser; unresolved without a pending sign-in returns null.
137. Local-only entry skips the chooser. FIX B33: no flash of the chooser.
138. Wizard settings writes are read-modify-write of the full object. FIX B19: serialized updates.

### CLI setup and gates

139. CLI setup dialog title, body, InfoBar, Retry/Cancel behavior as in 2.7.
140. Retry stays open with the "still missing" message while the executable is absent.
141. Local gate reuses the saved model when its file exists, else opens the local-only wizard.
142. xAI gate passes when saved credentials exist, else opens the sign-in dialog.
143. Resolver returns nothing when a gate fails; web search is honored only for the live-answer path.
144. Provider factory builds a fresh provider per call from the current settings.
145. Local factory requires a model path.

### xAI

146. Constants: API base `https://api.x.ai/v1`, default model `grok-4.6`, preference list order, 5 minute client timeout, `User-Agent: MeetingLive`.
147. Chat request body fields, temperature 0.3, optional reasoning effort, stream flag only when streaming, bearer header.
148. Blank token fails before any request with the not-signed-in message.
149. Non-streaming parse and trim; empty content raises EmptyOutput; malformed JSON raises RequestFailed.
150. Streaming parse of `data:` lines, `[DONE]` stop, blank skip, empty-stream failure.
151. HTTP status mapping 401, 402/429, other, with the exact messages; bodies never surfaced.
152. Model list request, filter rules, de-duplication, ordering.
153. `ResolveModelId` rules as in 3.10. FIX B1: the saved model is honored by the provider.
154. Each provider call fetches a fresh token from the session.
155. Device-code request fields, defaults (5 s interval, 300 s lifetime, 1 s floor), preferred `verification_uri_complete`.
156. Polling rules: pending, slow-down bump of 5 s, denied, expired, unknown error, deadline expiry, injectable clock and sleep.
157. FIX B14: transient errors during polling are retried and wrapped.
158. Refresh request fields and outcome mapping (429/5xx, 401, `invalid_grant`, `invalid_client`, `unauthorized_client`, network, timeout, caller cancellation) as in 3.10.
159. Token response mapping: `expires_in` first, JWT `exp` second, refresh token carried over when absent.
160. JWT expiry peek rules.
161. Session refresh skew 120 s; unknown expiry never refreshes. FIX B23: refresh and retry once on 401.
162. Refresh happens under one lock; stale refresh results are discarded when credentials changed meanwhile.
163. Sign-out does not wait for an in-flight refresh network call.
164. Saving an API key replaces OAuth and vice versa; API keys are trimmed and never refreshed.
165. Credentials are never logged or printed (`ToString` hides secrets); not stored in `settings.json`.
166. Credential store contract: load returns null on any failure; save rejects a blank token; clear ignores errors. Encrypted with an OS-backed mechanism. FIX B22: atomic write.
167. Credential file format as in 4.4.
168. xAI sign-in dialog layout, texts, busy handling as in 2.8.
169. SuperGrok flow: request code, show code, open browser, poll, save, close; cancellation is silent; errors show the message; closing cancels polling.
170. API key flow: blank gives the required message; save replaces OAuth.
171. Dialog result is true only when credentials were saved.

### Settings section

172. Provider choice persists the enum name; xAI selection triggers an account refresh.
173. CLI status text "Detected on PATH." or "Not found on PATH — install it before recording.".
174. Claude, Codex, and xAI model and effort selectors with the catalogs and defaults in 2.9; guards against writes while loading or restoring.
175. Each selection saves its own settings field and shows the toast "Saved. Using {model} · {effort}." for 4 seconds.
176. FIX B2: one settings reader; chosen model and effort reach the providers.
177. xAI status line texts for signed out, SuperGrok, API key, loading models, ready, error.
178. xAI account refresh flow including the in-place model list merge that keeps the selection stable.
179. FIX B29: an empty model list never overwrites the saved model.
180. API key save and sign out actions with their toasts; sign-in success toast.
181. Offline part of settings load seeds the model list so the selection never flashes.
182. FIX B35: unknown provider names fall back to Local.

### Persistence

183. `settings.json` fields and defaults as in 4.1.
184. Meeting file fields `summaryProvider`, `noteTemplateId`, `## Summary`, `## Action Items` as in 4.2.
185. `custom-note-template.json` format as in 4.3.
186. Model files directory and `.part` convention as in 4.5.

### Localization

187. All keys in 2.9 exist in English and Spanish with the same keys.
188. Core label keys for model speed, quality, use case, and CLI failures exist in both languages.
189. Fit badge colors map to brand tokens, with the live-recording red reserved for recording.

### Tests to port

190. Port every test case listed in section 6.
191. Add the missing tests listed under "Gaps" in section 6.
