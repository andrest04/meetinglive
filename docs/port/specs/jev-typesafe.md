# Spec: TypeSafe / Jev module

Status: behavior spec for the Electron port. Source of truth is the C# in `MeetingLive.Core` and `MeetingLive.App` on branch `feat/electron-port`. Written without reading any user data.

Notation: `file:line` refers to the C# files named in section 1. "Confirmed" means verified by reading the code; "suspected" means inferred from code plus well-known framework behavior and not exercised.

---

## 1. Purpose

TypeSafe is a third-party HTTP API (`https://api.typesafe.ai/v1`) that exposes a model called Jev. Jev does not generate prose. It answers typed questions about a JSON "state" document: `noul` (a 0..1 probability for a yes/no question), `choice` (one of a fixed set of options plus per-option probabilities), and `score` (a position on an ordered scale). Vozella uses it for four things:

1. **Post-summary meeting analysis** (silent). After a summary is produced, one request classifies the meeting (type, language, urgency, decisions, commitments, PII risk, summary faithfulness, best folder, and whether each action item is supported or contradicted by the transcript). Two outcomes mutate the meeting: contradicted action items are dropped and a confident folder suggestion re-files the meeting. The whole analysis is stored on the meeting record.
2. **"What do I need to do" personal-tasks dialog** (interactive). Jev picks transcript lines that are requests or commitments for the listener (optionally restricted to a topic). The user's chosen summary provider (a different module) then writes a Markdown checklist from only those lines.
3. **Settings section** to enable or disable Jev and to save, test, and clear the API key (key stored encrypted per user, never in `settings.json`).
4. **Shared infrastructure** (`TypeSafeApiClient`, `TypeSafeQuestion`, credential store) that other modules also use. `LiveQuestionJevJudge` (live-question detection during recording) is in another module's spec but uses this client and this key gate.

Also in the module but not reachable from the UI: `MeetingJevAsk.AskAsync` (semantic "find the line that answers a query"). The only part of it that is used is `MeetingJevAsk.VerdictFor` and the `MeetingJevAskVerdict` enum, by the personal-tasks flow.

Everything is optional and fails soft: with Jev off, no key, no transcript, or any error, the meeting keeps its transcript and summary unchanged.

Assigned source files: Core `MeetingJevAnalyzer.cs`, `MeetingJevAsk.cs`, `MeetingJevPersonalTasks.cs`, `MeetingJevPresentation.cs`, `MeetingJevService.cs`, `PersonalTasksPromptBuilder.cs`, `TypeSafeApiClient.cs`, `TypeSafeCredentials.cs`, `TypeSafeException.cs`, `TypeSafeQuestion.cs`, `ITypeSafeCredentialStore.cs`, `FileDpapiTypeSafeCredentialStore.cs`; `Models/MeetingJevAnalysis.cs`; App `Services/MeetingJevRunner.cs`, `ViewModels/TypeSafeSectionViewModel.cs`, `Dialogs/PersonalTasksDialog.xaml(.cs)`, `ViewModels/PersonalTasksDialogViewModel.cs`, `Controls/TypeSafeIcon.xaml(.cs)`.

---

## 2. User-facing features

String keys are WinUI `.resw` keys, in `MeetingLive.App/Strings/en-us/Resources.resw` (lines 430-456, 526-527) and `.../es/Resources.resw`. English and Spanish values are both listed. Strings that are NOT resource keys (hard-coded English in Core) are marked HC.

### 2.1 Settings section "TypeSafe (Jev)"

Location: Settings page, a block titled with `TypeSafeIcon` (16x16) + `Settings_TypeSafe.Text`. It is explicitly not a summary provider.

Controls and automation ids:

| Control | Id | Resource key |
|---|---|---|
| Enable toggle card | `ToggleTypeSafe` (toggle) | `Settings_TypeSafeEnabled.Header` / `.Description` |
| Status card (header = status text, description = status detail, trailing busy ring) | `CardTypeSafeStatus` | dynamic |
| API key card (vertical layout) | | `Settings_TypeSafeApiKey.Header` / `.Description` |
| Password box | `BoxSettingsTypeSafeApiKey` | `Settings_TypeSafeApiKeyBox.PlaceholderText` |
| Save button | `BtnTypeSafeSaveApiKey` | `Settings_TypeSafeSaveApiKey.Content` |
| Clear button | `BtnTypeSafeClearApiKey` | `Settings_TypeSafeClearApiKey.Content` |
| Feedback info bar | `InfoTypeSafeFeedback` | dynamic |

Strings (en / es):

- `Settings_TypeSafe.Text`: "TypeSafe (Jev)" / "TypeSafe (Jev)"
- `Settings_TypeSafeEnabled.Header`: "Check action items with Jev" / "Verificar elementos de acción con Jev"
- `Settings_TypeSafeEnabled.Description`: "Sends the transcript to TypeSafe to check action items. Off by default until you save a key." / "Envía la transcripción a TypeSafe para verificar los elementos de acción. Desactivado de forma predeterminada hasta que guardes una clave."
- `Settings_TypeSafeApiKey.Header`: "API key" / "Clave de API"
- `Settings_TypeSafeApiKey.Description`: "Stored on this PC with Windows encryption. Never written to settings.json." / "Se almacena en este PC con el cifrado de Windows. Nunca se escribe en settings.json."
- `Settings_TypeSafeApiKeyBox.PlaceholderText`: "TypeSafe API key" / "Clave de API de TypeSafe"
- `Settings_TypeSafeSaveApiKey.Content`: "Save" / "Guardar"
- `Settings_TypeSafeClearApiKey.Content`: "Clear" / "Borrar"
- `TypeSafe_StatusNotConfigured`: "Not configured" / "No configurado"
- `TypeSafe_StatusApiKeySaved`: "API key saved" / "Clave de API guardada"
- `TypeSafe_StatusReady`: "Ready. Using Jev." / "Listo. Usando Jev."
- `TypeSafe_StatusErrorTitle`: "Could not reach TypeSafe" / "No se pudo conectar con TypeSafe"
- `TypeSafe_FeedbackApiKey`: "API key saved." / "Clave de API guardada."
- `TypeSafe_FeedbackCleared`: "TypeSafe API key cleared." / "Se borró la clave de API de TypeSafe."

View-model state (`TypeSafeSectionViewModel.cs`): `IsEnabled` (initial `true`), `StatusText`, `StatusDetail`, `ApiKeyDraft`, `HasApiKey`, `IsBusy`, `IsFeedbackOpen`, `FeedbackMessage`. Derived: `CanSaveApiKey = !IsNullOrWhiteSpace(ApiKeyDraft) && !IsBusy`; `CanClearApiKey = HasApiKey && !IsBusy`. These raise change notifications when `ApiKeyDraft`, `HasApiKey`, `IsBusy` change.

Behaviors:

1. **Load** (`LoadAsync(settings)`, TypeSafeSectionViewModel.cs:46): `IsEnabled = settings.TypeSafeEnabled`; then refresh status from the credential store.
2. **Refresh status from store** (:123): load credentials; `HasApiKey = credentials != null && key not blank`. If has key: `StatusText = TypeSafe_StatusApiKeySaved`, `StatusDetail = ""`. Else `StatusText = TypeSafe_StatusNotConfigured`, `StatusDetail = ""`.
3. **Toggle** (`ToggleEnabledAsync(bool)`, :53): if the new value equals `IsEnabled`, do nothing. Otherwise set `IsEnabled`, then persist `settings.TypeSafeEnabled = value` through the shared settings save path (`SaveSettingsAsync` in `SettingsSectionViewModelBase`, another module). The toggle's `Toggled` handler forwards `toggleSwitch.IsOn` (SettingsPage.xaml.cs:147-151). Persisted setting: `AppSettings.TypeSafeEnabled`, default `true` (`AppSettings.cs:106`). The toggle alone does not require a key.
4. **Password changed**: SettingsPage code-behind copies `PasswordBox.Password` (or "" when null) into `ApiKeyDraft` (SettingsPage.xaml.cs:153-160).
5. **Save key** (`SaveApiKeyAsync`, :60), button enabled only when `CanSaveApiKey`:
   1. Guard `CanSaveApiKey` again.
   2. `apiKey = ApiKeyDraft.Trim()`.
   3. **Persist immediately** to the credential store (before any validation).
   4. Clear `ApiKeyDraft`; `HasApiKey = true`.
   5. `IsBusy = true`; call `ListModelsAsync(apiKey)` on the shared API client (a cheap authenticated GET; the returned model list is ignored).
   6. On success: `StatusText = TypeSafe_StatusReady`, `StatusDetail = ""`, show feedback `TypeSafe_FeedbackApiKey`.
   7. On `TypeSafeException` or any other exception: `StatusText = TypeSafe_StatusErrorTitle`, `StatusDetail = ex.Message` (English HC text, see 2.5). The key stays saved. No feedback bar.
   8. Finally `IsBusy = false`.
   After the click, SettingsPage code-behind also empties the password box UI (`ApiKeyDraft = ""`, SettingsPage.xaml.cs:162-171).
6. **Clear key** (`ClearApiKey`, :109): clear the store, `ApiKeyDraft = ""`, refresh status from store (status becomes "Not configured", detail empty), show feedback `TypeSafe_FeedbackCleared`. Code-behind empties the password box. Does not touch `IsEnabled`.
7. **Feedback** (`ShowFeedback`, :119): set `FeedbackMessage`, `IsFeedbackOpen = true`, and (re)start a single non-repeating 4-second UI timer that sets `IsFeedbackOpen = false`. A second feedback restarts the 4 s. The info bar is two-way bound, so the user can also close it manually.

### 2.2 Silent post-summary analysis (Jev analysis)

Triggers (both call `MeetingJevRunner.TryAnalyzeAndSaveAsync(record, meetings, token)`):

- After the recording pipeline saves a processed meeting with a summary (`RecordingPipelineOrchestrator.cs:163`). `OperationCanceledException` is caught there and ignored ("Summary is already saved; do not take the summary-failed path").
- After the user generates or regenerates a summary on the summary page (`SummaryPageViewModel.cs:254`), called with `CancellationToken.None`, followed by `LoadActionItems()`. That call is inside the page's generic `try`/`catch (Exception)` that writes `Error_GenerateSummary`.

Runner algorithm (`MeetingJevRunner.cs`), strictly in order. Any early exit is silent, with no UI and no status:

1. Load settings. `OperationCanceledException` is rethrown; any other exception returns silently.
2. If `!settings.TypeSafeEnabled` return.
3. Load credentials; if null or blank key return.
4. If `record.Transcript` is blank return.
5. Load all folders (`AppServices.Folders.GetAllAsync(token)`).
6. Call `MeetingJevService.TryAnalyzeAsync(record, folders, inboxLabel = localized string `Library_Inbox` ("Inbox" in en), enabled = settings.TypeSafeEnabled, token)`.
7. If the returned analysis is non-null: `meetings.SaveAsync(record, token)` then `AppServices.Workspace.NotifyMeetingChanged(record.Id)`.
8. `OperationCanceledException` is rethrown; `TypeSafeException` and any other exception are swallowed.

Service algorithm (`MeetingJevService.TryAnalyzeAsync`, MeetingJevService.cs):

1. Re-checks `enabled`, key present, transcript not blank (returns null otherwise; these duplicate the runner's checks).
2. Builds a `MeetingJevRequest`: `Title = record.Title`, `Transcript`, `Summary`, `ActionItems = record.ActionItems.Select(i => i.Text)`, `FolderPathItems = FolderPathList.Flatten(folders, inboxLabel)`.
3. Creates `MeetingJevAnalyzer(api, key)` and calls `AnalyzeAsync` (section 3.2).
4. **Mutations on success**:
   - `record.ActionItems = FilterOutContradicted(record.ActionItems, analysis.ActionItems)` (3.3).
   - If `TryGetSuggestedFolderId(analysis, record.FolderId, out id)` then `record.FolderId = id`.
   - `record.JevAnalysis = analysis`.
5. `TypeSafeException` is caught and returns null. Other exceptions (HTTP errors, timeouts, cancellation) propagate.

No UI displays any verdict directly. The only user-visible effects are fewer action items, a meeting that appears in a different folder, and (in the Markdown/JSON meeting file) a `## Jev` section. `ChatContextPacker` explicitly never reads `JevAnalysis`.

### 2.3 "What do I need to do" dialog

Entry point: a button `BtnMeetingChatPersonalTasks` (TypeSafeIcon 16x16) in the meeting chat recipe area (MainPage.xaml:332-339). Its visibility is `Chat.ShowPersonalTasksRecipe = scope is a single Meeting && _personalTasksAvailable` (MeetingChatViewModel.cs:100). `_personalTasksAvailable = settings.TypeSafeEnabled && credentials non-null && key non-blank`, recomputed on each scope refresh (:423-430) and after a chat send (:731). Tooltip and accessible name: `Chat_PersonalTasks.*` = "What do I need to do" / "Qué necesito hacer".

Click handler (MainPage.xaml.cs:133-148): re-entrancy guard `_personalTasksDialogOpening`; `PersonalTasksDialog.ShowAsync(XamlRoot, Chat.CurrentMeetingId)`; guard cleared in `finally`.

`PersonalTasksDialog.ShowAsync` creates the dialog, awaits `ViewModel.LoadAsync(meetingId)`, **then** shows it. On `Loaded` it wires three setup callbacks used by the shared summary-provider resolver: `EnsureSummaryModelAsync`, `EnsureCliProviderAsync(kind)`, `EnsureXaiProviderAsync` (other modules' setup UIs).

Dialog layout (`PersonalTasksDialog.xaml`): a content dialog, width exactly 440 (Min and Max), default button Close, one Close button. Title and close text from `PersonalTasks_Title.Title` ("What do I need to do" / "Qué necesito hacer") and `PersonalTasks_Title.CloseButtonText` ("Close" / "Cerrar"). Four rows, 12 spacing:

1. Topic text box (`BoxAskTopic`, single line, two-way bound updating on every keystroke). Header `PersonalTasks_Topic.Header` "Topic (optional)" / "Tema (opcional)"; placeholder `PersonalTasks_Topic.PlaceholderText` "e.g. Agile" / "p. ej. Agile".
2. Action row: button `BtnAskJev` (command = Ask; content: TypeSafeIcon 16x16 + text `PersonalTasks_Do.Text` "What do I need to do" / "Qué necesito hacer"); a 20x20 progress ring active and visible while asking; a status text block (secondary foreground, wrapping) bound to `StatusText`.
3. Info bar `InfoAskVerdict`: open state two-way bound to `IsVerdictOpen`, severity bound to `VerdictSeverity` (always Informational in practice), message `VerdictMessage`, closable.
4. Results grid (3 rows) with a 32x32 centered progress ring spanning all rows bound to `IsLoading`:
   - Row 0: scroll viewer, max height 280, no horizontal scroll, visible when `HasChecklist`, containing a Markdown renderer (`TxtAskChecklist`, wrap whole words, transparent) bound to `ChecklistMarkdown`.
   - Row 1: caption label `PersonalTasks_FromTranscript.Text` "From the transcript" / "De la transcripción", secondary foreground, top margin 8, visible when `HasHits`.
   - Row 2: list `ListAskHits`, max height 240, single selection, item click enabled, visible when `HasHits`. Each item: line text (wrapping) and below it the score as a caption in secondary foreground (`Score.ToString("P0", CurrentCulture)`, i.e. a percent with no decimals, culture formatting). Item padding 0,8. Items stretch horizontally.

Item click copies the line text to the clipboard (see Copy below).

View-model (`PersonalTasksDialogViewModel.cs`) state: `Topic`, `IsLoading`, `IsAsking`, `HasTranscript`, `StatusText`, `IsVerdictOpen`, `VerdictMessage`, `VerdictSeverity`, `HasHits`, `ChecklistMarkdown`, `HasChecklist`, `Hits` (list of {LineId, Index, Text, Score, ScorePercent}), plus cached private `_transcript`, `_typeSafeEnabled`, `_hasApiKey`. `CanAsk = HasTranscript && !IsAsking && _typeSafeEnabled && _hasApiKey`. Changing `IsAsking` or `HasTranscript` re-evaluates the Ask command.

**Load(meetingId?)** (:78):
1. `IsLoading = true`; clear results.
2. Record = the meeting with that id, or when `meetingId` is null the most recent meeting by `RecordedAt` descending (or none).
3. If a record was found: `AppServices.Workspace.SelectMeeting(record.Id)` (side effect: changes app selection).
4. `_transcript = record.Transcript ?? ""`; `HasTranscript = !IsNullOrWhiteSpace`.
5. Refresh gate: reload settings (`_typeSafeEnabled`) and credentials (`_hasApiKey`).
6. Apply empty status (below).
7. `finally`: `IsLoading = false`, re-evaluate Ask command.

**Empty status** (`ApplyEmptyStatus`, :272): if no transcript then `StatusText = PersonalTasks_EmptyTranscript`; else if no key or not enabled then `StatusText = PersonalTasks_NoApiKey`; else `StatusText = ""`.

**Ask** (:105), enabled only when `CanAsk`:
1. `topic = null` if blank else `Topic.Trim()`. Snapshot `_transcript`.
2. Refresh gate again. If `!HasTranscript || !_hasApiKey || !_typeSafeEnabled`: apply empty status, re-evaluate command, stop.
3. Load credentials; if key blank: `StatusText = PersonalTasks_NoApiKey`, stop.
4. `IsAsking = true`, `StatusText = PersonalTasks_StatusFinding`, clear results.
5. Call `MeetingJevPersonalTasks.FindAsync(api, key, transcript, topic)` (3.5). No cancellation token is passed.
6. If `Verdict == Absent`: `ShowAbsent(topic)`; stop.
7. Show evidence (fills `Hits`, `HasHits = Hits.Count > 0`). If evidence is empty: `ShowAbsent(topic)`; stop.
8. `StatusText = PersonalTasks_StatusWriting`. Load settings, resolve the summary provider for `settings.ResolveSummaryProviderKind()` through `SummaryProviderResolver.ResolveAsync(kind, EnsureSummaryModelAsync, EnsureCliProviderAsync, EnsureXaiProviderAsync)`. This can open setup dialogs. If it returns null: `StatusText = Status_SetupCancelled` ("Setup cancelled."), stop. Evidence stays visible.
9. Build the prompt (3.6) from the evidence lines, topic, and `settings.ResolveSummaryLanguage()`.
10. `markdown = await Task.Run(() => provider.CompletePromptAsync(prompt))` (no token).
11. `ApplyChecklist(markdown, topic)`.
12. `catch TypeSafeException`: `StatusText = ex.Message` (HC English), `IsVerdictOpen = false`. `catch Exception`: `StatusText = CliFailureUserMessage.Format(ex)` (other module), `IsVerdictOpen = false`. Hits that were already shown remain visible on these errors.
13. `finally`: `IsAsking = false`, re-evaluate command.

**ApplyChecklist** (:200): `trimmed = markdown.Trim()`. If `trimmed` equals "NONE" ignoring case then `ShowAbsent(topic)`. Else `ChecklistMarkdown = trimmed`, `HasChecklist = trimmed.Length > 0`, `StatusText = ""`, `IsVerdictOpen = false`. Hits remain shown under the checklist.

**ShowAbsent(topic)** (:213): `HasChecklist = false`, clear markdown, clear hits and `HasHits = false`, `VerdictMessage = topic == null ? PersonalTasks_NothingAsked : Format(PersonalTasks_TopicAbsent, topic)`, severity Informational, `IsVerdictOpen = true`, `StatusText = ""`.

**Copy** (`CopyHit`, :188): if hit text blank do nothing; else put the text on the clipboard and set `StatusText = PersonalTasks_Copied`.

Strings (en / es):

- `PersonalTasks_EmptyTranscript`: "This meeting has no transcript to ask yet." / "Esta reunión todavía no tiene transcripción para preguntar."
- `PersonalTasks_NoApiKey`: "Save a TypeSafe API key in Settings to ask this meeting." / "Guarda una clave de API de TypeSafe en Configuración para preguntarle a esta reunión."
- `PersonalTasks_NothingAsked`: "Nothing was asked of you" / "No se te pidió nada"
- `PersonalTasks_TopicAbsent` (one `{0}` = topic): "This meeting did not cover {0}" / "Esta reunión no trató {0}"
- `PersonalTasks_StatusFinding`: "Finding what you need to do..." / "Buscando lo que necesitas hacer..."
- `PersonalTasks_StatusWriting`: "Writing your checklist..." / "Escribiendo tu lista de tareas..."
- `PersonalTasks_Copied`: "Copied." / "Copiado."
- `Status_SetupCancelled`: "Setup cancelled." (en; owned by another module)

Visual states: idle / loading ring (see bug 15) / asking (ring + "Finding..." then "Writing...") / verdict bar (absent) / checklist plus hits / error shown as the status text.

### 2.4 TypeSafe icon

`TypeSafeIcon`: a self-contained control, an eight-pointed star in a 24x24 canvas, scaled uniformly (`Viewbox Stretch=Uniform`), single color from the theme primary text color (monochrome, follows light/dark theme). Path data (non-zero fill):

`M12,2 L13.531,8.304 L19.071,4.929 L15.696,10.469 L22,12 L15.696,13.531 L19.071,19.071 L13.531,15.696 L12,22 L10.469,15.696 L4.929,19.071 L8.304,13.531 L2,12 L8.304,10.469 L4.929,4.929 L10.469,8.304 Z`

Used at 16x16 in the Settings header, the chat recipe button, and the dialog button.

### 2.5 Error messages (TypeSafe API failures)

All are HC English strings in `TypeSafeApiClient` (not localized, never contain the key or response bodies):

| Kind | Message |
|---|---|
| Unauthorized | `TypeSafe API key is missing or invalid.` |
| RateLimited | `TypeSafe rate limit reached. Try again later.` |
| Overloaded | `TypeSafe is temporarily overloaded. Try again later.` |
| RequestFailed | `TypeSafe could not complete that request.` |
| EmptyOutput | `TypeSafe did not return any answers.` |

Shown in: Settings status detail (after save), personal-tasks dialog status text. Silent in the post-summary analysis and live-question judge.

---

## 3. Domain rules

### 3.1 API client (`TypeSafeApiClient`)

Constants: base URL `https://api.typesafe.ai/v1`; default model id `jev-latest`; `User-Agent: MeetingLive` (added without validation); max attempts 3. The shared HTTP client has a 2-minute total timeout per request (`AppServices.cs:21-24`).

Headers on every request: `Authorization: Bearer <apiKey>`, `User-Agent: MeetingLive`. If the key is null or whitespace, header construction throws `TypeSafeException(Unauthorized, ...)` before any network call.

**Evaluate** (`EvaluateAsync(apiKey, state, questions)`): `POST {base}/systemone`, body JSON built with System.Text.Json "Web" defaults (camelCase property names, nulls written, dictionary keys not renamed): property order `state`, `model`, `questions`. `state` is any JSON value (string, object, array). `model` is always `"jev-latest"`. `questions` is a map id -> question. Content type `application/json; charset=utf-8`.

Response handling:
1. Send with retry (below).
2. Non-2xx mapping (body is drained, never surfaced): 401 -> Unauthorized; 429 -> RateLimited; 529 -> Overloaded; anything else -> RequestFailed.
3. Parse JSON; a parse failure -> RequestFailed. Property matching is case-insensitive (Web defaults).
4. If `answers` is missing, null, or has zero entries -> `EmptyOutput`.
5. Result: `Model = response.model` or `jev-latest` when blank; `Answers` = map id -> answer. Extra fields such as `usage` are ignored.

**List models** (`ListModelsAsync(apiKey)`): `GET {base}/models`, same headers, retry, and error mapping. Parse `{"models":[{"name":"..."}]}`; return names that are non-blank, de-duplicated case-insensitively (first spelling kept), in order. Missing `models` -> empty list. Parse failure -> RequestFailed. Used only to validate a freshly saved key.

**Retry** (`SendWithRetryAsync`): up to 3 attempts. Only HTTP 429 and HTTP 529 are retried. After a retryable response (not on the last attempt): compute the delay, read and discard the body, wait the delay if greater than zero, then rebuild the request and resend. The last attempt's response is returned whatever its status. Network exceptions are not caught or retried. Delay rule (`GetRetryDelay`): if `Retry-After` has a delta greater than zero use it; else if it has a date and that date is in the future use `date - now (UTC)`; else exponential backoff `200 ms * 2^attempt` (attempt 0 -> 200 ms, attempt 1 -> 400 ms). There is no upper bound on a server-provided delay.

Answer object (`TypeSafeAnswer`), all optional on the wire: `type` (string, default ""), `noul` (number, 0 default), `choice` (string or null), `score` (number, 0 default), `confidence` (number, 0 default), `probabilities` (map string->number or null), `legend` (map string->string or null).

Question object (`TypeSafeQuestion`): `type` ("noul" | "choice" | "score"), `instructions` (a string, or a JSON object for the per-line questions), `criteria` (omitted when null):
- noul: `criteria` is `{"true": "...", "false": "..."}`, containing only the keys that were provided; omitted if neither was provided.
- choice: `criteria` is a map option-id -> description (description may be null, serialized as `null`).
- score: `criteria` is an ordered array of strings (scale labels low to high).

Credentials value (`TypeSafeCredentials(ApiKey)`): `ToString()` prints only `HasApiKey = True|False`. The key must never be logged or written to settings.

### 3.2 Meeting analysis (`MeetingJevAnalyzer`)

Constants: `AutoAcceptConfidence = 0.8`; `MaxTranscriptCharacters = 48_000`; `MaxActionItems = 20`; `MaxFolderOptionsIncludingInbox = 254` (plus "none" gives at most 255 choice options).

**State document** (JSON object):
```
{
  "meeting": { "title": <title or ""> },
  "transcript": <transcript, cut to the first 48000 UTF-16 chars>,
  "summary": <summary or null>,
  "action_items": [ {"index": 0, "text": "..."}, ... ],   // first 20 only
  "transcript_truncated": true,                          // only when cut
  "folders": [ {"id":"inbox","path":"Inbox"}, {"id":"<guid D>","path":"A / B"} ]  // only when folder list non-empty
}
```
Folder state: first entry is `{"id":"inbox","path":P}` where P is the path of the item whose `FolderId` is null (the localized Inbox label), or `"Inbox"` if none. Then every item in order: stop when 254 entries are reached, skip duplicate ids, id = GUID "D" format (lowercase, hyphenated) or `"inbox"` for the null id; `path` is the slash path.

**Folder paths** (`FolderPathList.Flatten`): Inbox first (`FolderId = null`, label = inboxLabel, required non-blank), then a depth-first walk from root folders; siblings ordered by name using culture-aware, case-insensitive comparison; path = names joined with `" / "`.

**Questions** (ids and types are the wire contract; texts below are verbatim):

`meeting_type` (choice), instructions: ``Which meeting type best matches `meeting.title` and `transcript`?`` options:
- `standup`: A recurring status sync: yesterday/today/blockers, short updates from several people.
- `one_on_one`: A conversation between two people about work, feedback, or career — not a panel interview.
- `interview`: A hiring or candidate interview, including screening or debrief of a candidate.
- `planning`: Planning upcoming work: roadmap, sprint planning, scoping, or prioritization.
- `review`: A retrospective, demo, design review, or performance/code review of work already done.
- `lecture`: One person presenting or teaching; others mostly listen.
- `sales`: A sales call, pitch, or commercial negotiation with a customer or prospect.
- `support`: Troubleshooting, incident response, or helping someone unblock a problem.
- `other`: None of the other types is a reasonable fit.

`spoken_language` (choice), instructions: ``What language is primarily spoken in `transcript`?`` options: `es` "Primarily Spanish."; `en` "Primarily English."; `mixed` "Substantial amounts of more than one language."; `other` "Primarily a language that is neither Spanish nor English."

`urgency` (score), instructions: ``How time-critical is the work discussed in `transcript`?`` criteria array (in order):
1. Routine: no deadline and no blocker; delaying follow-up would not harm in-progress work.
2. Time-sensitive: a deadline or follow-up is expected soon, but nobody is currently blocked.
3. Blocking: someone cannot proceed until a decision, approval, or deliverable from this meeting lands.

`contains_decisions` (noul): ``Does `transcript` contain at least one decision that was actually made, not merely discussed as a possibility?`` true: "Someone chose an option, approved a plan, or settled a question." false: "Topics were discussed but no decision was reached."

`contains_commitments` (noul): ``Does `transcript` contain at least one commitment — a person agreeing to do specific work?`` true: "Someone accepted an action, deadline, or deliverable." false: "No one agreed to do specific work."

`pii_present` (noul): ``Does `transcript` contain credentials, government identification numbers, API keys, passwords, or similar secrets? Ordinary names of people in the meeting, company names, and job titles do not count.`` true: "Credentials, government IDs, or secrets are present." false: "No credentials, government IDs, or secrets. Ordinary meeting names are fine."

`summary_faithful` (noul; only when `summary` is non-blank): ``Is `summary` faithful to `transcript`? Judge only whether the summary invents facts, decisions, or action items that are absent from the transcript.`` true: "The summary stays within what the transcript supports." false: "The summary invents facts, decisions, or action items not in the transcript."

`folder` (choice; only when the folder list is non-empty): ``Which Library folder should this meeting be filed in, based on `meeting.title` and `transcript`? Choose `none` if no listed folder is a good fit.`` options: `inbox` = the Inbox item's path (or the fallback `"Inbox — unfiled meetings."` if no null-id item exists); then each other item (stop when option count reaches 254, skip an id equal to `none` case-insensitively, skip duplicates) with option id = GUID "D" and description = path; finally `none` = "None of the listed folders is a reasonable filing location."

`item_{i}_relation` (choice) for i in 0..n-1 where n = min(action items, 20): ``Does `transcript` support, contradict, or say nothing about the claim in `action_items[{i}].text`?`` options:
- `supports`: The transcript contains evidence that this action item was actually agreed or assigned.
- `contradicts`: The transcript conflicts with this action item (it was rejected, assigned to someone else, or stated as not happening).
- `says_nothing`: The transcript does not mention this action item in a way that confirms or denies it.

**Composition** (`Compose`): an answer is read only if present and its `type` equals the expected type, case-insensitively; otherwise treated as missing.
- `MeetingType` / `MeetingTypeConfidence` = choice and confidence of `meeting_type` (null if missing).
- `SpokenLanguage` = choice of `spoken_language`.
- `UrgencyScore` = `urgency.score` (0 if missing); `UrgencyConfidence` = its confidence (null if missing). Score is a continuous position on the 0..2 scale (e.g. 1.05).
- `ContainsDecisions`, `ContainsCommitments`, `PiiRisk` = the noul values (0 if missing).
- `SummaryFaithful` = noul of `summary_faithful` if a summary was sent, else null (null also if the answer is missing).
- `SuggestedFolderId` / `FolderConfidence` = choice/confidence of `folder` if folders were sent, else null.
- `ActionItems`: for each i with a `choice` answer that has a non-null `choice`, add `{Text: original item text, Relation: choice, Confidence}`. Missing answers are skipped.
- `Model` = response model; `AnalyzedAt` = current UTC time.

### 3.3 Confidence gates (`MeetingJevPresentation`)

- **Drop contradicted action items**: if there are no items or no verdicts return the same list. Contradicted texts = verdicts with `Confidence >= 0.8` (null counts as false) and `Relation` equal to "contradicts" ignoring case, collected as an ordinal string set. If empty return the same list. Otherwise return a new list of the items whose `Text` is not in the set (ordinal match, so duplicate texts are all removed).
- **Suggested folder**: returns a folder id only when ALL hold: `FolderConfidence` is non-null and `>= 0.8`; `SuggestedFolderId` is non-blank and not "inbox"/"none" (case-insensitive); it parses as a GUID (any GUID text form); and it differs from the record's current folder id. The record is never moved to Inbox by Jev, and the folder's existence is not checked.
- Nothing gates on `ContainsDecisions`, `ContainsCommitments`, `PiiRisk`, `SummaryFaithful`, urgency, or type; they are stored only.

### 3.4 Transcript line index (shared, `TranscriptLineIndex`)

- Split on `\r\n` or `\n` only (a lone `\r` is not a separator); trim each line; drop empty lines; assign index = position among kept lines (0-based) and id = `L` + 3-digit zero-padded index (`L000`, `L001`, ..., `L1000` after 999). Blank/whitespace transcript -> no lines.
- Tagged document: lines joined with `\n`, each formatted `"{id}| {text}"`.
- Truncate to complete lines (maxChars): if the tagged document fits return all; else keep leading lines while running length (each tagged line plus 1 for each separator after the first) stays within `maxChars`; if not even one fits keep the first line (so it may exceed the limit). `maxChars <= 0` or no lines -> none.
- `MaxChoiceOptions = 255`.

### 3.5 Personal-tasks search (`MeetingJevPersonalTasks.FindAsync`)

Constants: `MaxStateCharacters = 48000`, `BatchNouls = 40`, `MaxEvidence = 15`, `MinKeepScore = 0.65`.

1. `topic` trimmed; blank -> none.
2. Blank transcript or no lines -> `{Exists 0, Verdict Absent, Evidence []}` with no network calls.
3. Parse and truncate to complete lines at 48000 tagged characters; `tagged` = tagged document.
4. **Exists call**: state `{"transcript": tagged}`, one noul `exists`. `Exists` = its noul value or 0.
   - Instructions with no topic: ``Does `transcript` contain work the listener should do?`` true: "The transcript records a request or commitment the listener should act on" false: "Nothing in the transcript asks the listener to do work".
   - With topic T: ``Does `transcript` contain work the listener should do about `T`?`` true: "The transcript records a request or commitment the listener should act on about T" false: "The transcript does not cover work for the listener about T".
5. **Line scoring**: always runs after step 4, regardless of `Exists`. `noulsPerLine = topic ? 2 : 1`; `linesPerBatch = 40 / noulsPerLine` (40 or 20). For each consecutive batch send one request with state `{"transcript": tagged}` (the entire tagged document every time) and per-line noul questions, sequentially:
   - id `line_{lineId}_task`, instructions an OBJECT `{"line": <line text>, "question": "Is this line a request or commitment the listener should act on?"}`, criteria true: "The line asks the listener to do something or records a commitment they should act on", false: "The line is not a request or commitment for the listener".
   - with topic, also id `line_{lineId}_topic`, instructions object `{"line": <text>, "topic": T, "question": "Is this line about `T`?"}` (backticks around T), criteria true: "The line is about T", false: "The line is not about T".
   Per-line scores: `Task` = task noul or 0; `Topic` = (no topic ? 1 : topic noul or 0).
6. **Rank**: for each line (in transcript order) take `Score = Task`; keep when `Score >= 0.65` and, if a topic was given, `Topic >= 0.65`; stable sort by score descending (ties keep transcript order); take 15.
7. Result verdict = `VerdictFor(Exists)`.

`VerdictFor(e)` (`MeetingJevAsk.VerdictFor`): `e >= 0.7` -> Answered; `e < 0.35` -> Absent; otherwise Partial. The dialog treats Absent as "nothing", while Partial and Answered continue to evidence.

### 3.6 Checklist prompt (`PersonalTasksPromptBuilder.Build(evidenceLines, topic, outputLanguage)`)

`languageName` = `ToEnglishLanguageName(outputLanguage)`: blank -> "Spanish"; case-insensitive trimmed code map `es` Spanish, `en` English, `pt` Portuguese, `fr` French, `de` German, `it` Italian, `nl` Dutch, `ja` Japanese, `zh` Chinese; any other code -> "Spanish".
`topicBlock` = empty if topic blank, else `"\n            <topic>" + topic.Trim() + "</topic>"` (a newline, then 12 spaces of indentation that come from the source layout; they are inside the interpolated value and are NOT stripped).
`evidenceBlock` = `(none)` when there are no lines, else lines joined by `\n`, each `"- " + line.Text`.

Final prompt text, exactly (the leading 12-space source indentation of the template is stripped by the C# raw string; blank lines are real):

```
# Identity

You write a short personal checklist of work the listener should do after a meeting.
You only use the evidence lines. You do not invent tasks.

# Instructions

Respond with Markdown only, in this shape, and nothing else
(no preamble, no code fences, no closing commentary):

## What you need to do

- [ ] first task
- [ ] second task

Rules:
- Use only the evidence lines. Do not invent work, owners, dates, or topics.
- If the evidence is empty, output NONE and nothing else.
- Write checkbox item text in {languageName}.
- Keep the heading exactly "## What you need to do" in English.
- No extra chatter.

# Context
{topicBlock}
<evidence>
{evidenceBlock}
</evidence>
```

So with no topic the Context section is `# Context`, an empty line, `<evidence>`; with a topic it is `# Context`, an empty line, `            <topic>T</topic>` (12 leading spaces), `<evidence>`. Evidence line text is the transcript line text without the `Lnnn|` tag.

### 3.7 Semantic find (`MeetingJevAsk.AskAsync`, unused by the UI)

Constants: `MaxStateCharacters = 48000`, `WindowSize = 200`, `MaxHits = 5`, `MinHitScore = 0.02`, `AnsweredExists = 0.7`, `AbsentExists = 0.35`, `WindowPreviewChars = 80`. Blank query or transcript or no lines -> Absent with no hits and no calls.

- One pass when lines <= 255: state is the raw tagged string; questions `exists` (noul) and `where` (choice over all line ids with null descriptions).
  - `exists` instructions: `Does any line address or answer "{query}"?` true: "At least one line of the document states or directly implies the answer" false: "No line of the document addresses this".
  - `where` instructions: `Which line contains the answer to "{query}"?`
- Two passes when lines > 255: windows of 200 consecutive lines (at most 255 windows); pass 1 sends the full tagged text with `exists` and a choice `where` whose instructions are `Which window contains the answer to "{query}"?` and options `W00`, `W01`, ... (format `W` + 2-digit index) with description = first 80 chars of the first line of that window. Best window = highest probability for its id (missing counts 0; first wins on ties; window 0 when no probabilities). Pass 2 sends only that window's tagged text (truncated to 48000) with the line-level `where` question. `Exists` and the verdict come from pass 1.
- Hits: for each candidate line, score = `where.probabilities[lineId]` (0 if absent); keep score `> 0.02`; sort descending; take 5. No probabilities -> no hits.

### 3.8 Gating summary

Jev features run only when ALL are true: `AppSettings.TypeSafeEnabled` (default true), a credentials file that decrypts to a non-blank key, and a non-blank transcript. A saved key is therefore the practical on-switch; the toggle is an off-switch that keeps the key.

---

## 4. Persistence and wire formats

### 4.1 Credentials file

- Path: `%LOCALAPPDATA%\MeetingLive\typesafe-credentials.bin` (`AppPaths.TypeSafeCredentialsFilePath`). Directory created on save.
- Content: Windows DPAPI `ProtectedData.Protect(utf8(json), entropy none, scope CurrentUser)` of the JSON `{"apiKey":"<key>"}` (Web camelCase naming of the record property `ApiKey`).
- Load: missing file -> null; zero-length -> null; any `CryptographicException`, `JsonException`, `IOException`, `UnauthorizedAccessException` -> null (silently treated as "no key"); null credentials or blank key -> null.
- Save: null credentials -> `ArgumentNullException`; blank key -> `ArgumentException("API key is required.")`; write the whole file (overwrite, not atomic). Encryption happens outside the lock; the write is inside the lock.
- Clear: delete the file if it exists; `IOException`/`UnauthorizedAccessException` swallowed.
- Load, write, and delete are guarded by one in-process lock. The file is bound to the Windows user, so it cannot be copied across machines or users.
- Interface `ITypeSafeCredentialStore`: `Load() -> credentials?`, `Save(credentials)`, `Clear()`.
- For the port, the observable contract is: encrypted at rest per user, never in settings, never logged, same Load/Save/Clear semantics. The on-disk format does not need to be byte-compatible unless migration of existing keys is wanted (reading requires DPAPI; see section 5).

### 4.2 Settings

`settings.json` (`AppPaths.SettingsFilePath`) holds `TypeSafeEnabled` (bool, default true). The key is never stored there.

### 4.3 Meeting record

`MeetingRecord.JevAnalysis` (nullable), `ActionItems` and `FolderId` are mutated as in 2.2. `MeetingJevAnalysis` JSON (Web camelCase), example:

```json
{
  "meetingType": "planning",
  "meetingTypeConfidence": 0.91,
  "spokenLanguage": "es",
  "urgencyScore": 1.05,
  "urgencyConfidence": 0.88,
  "containsDecisions": 0.97,
  "containsCommitments": 0.93,
  "piiRisk": 0.02,
  "summaryFaithful": 0.9,
  "suggestedFolderId": "0b3f6f1e-3c2a-4d0e-9a54-6c2b1b6f9d10",
  "folderConfidence": 0.84,
  "actionItems": [
    { "text": "Send the deck", "relation": "supports", "confidence": 0.95 },
    { "text": "Book the room", "relation": "contradicts", "confidence": 0.86 }
  ],
  "model": "jev-1.13.0",
  "analyzedAt": "2026-11-02T14:03:11.2210000+00:00"
}
```

Field types: `meetingType` string|null; `meetingTypeConfidence` number|null; `spokenLanguage` string|null; `urgencyScore` number; `urgencyConfidence` number|null; `containsDecisions`, `containsCommitments`, `piiRisk` numbers; `summaryFaithful` number|null; `suggestedFolderId` string|null (a folder GUID, `"inbox"`, or `"none"`); `folderConfidence` number|null; `actionItems` array of {text, relation, confidence|null}; `model` string; `analyzedAt` ISO-8601 offset timestamp.

The Markdown meeting file (`MeetingMarkdownFormatter`) writes a `## Jev` section (header constant `## Jev`) containing this JSON when `JevAnalysis` is non-null, and reads it back on load; invalid JSON in that section makes the whole file load fail with `FormatException("Meeting file '<path>' has an invalid Jev section.")` (MeetingMarkdownFormatter.cs:187-197). The meetings store (`meetings.json`) also carries the property. Both belong to the meeting-storage module.

### 4.4 API wire examples

Evaluate request (post-summary analysis, abbreviated):

```json
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <key>
User-Agent: MeetingLive
Content-Type: application/json; charset=utf-8

{
  "state": {
    "meeting": { "title": "Roadmap sync" },
    "transcript": "...",
    "summary": "...",
    "action_items": [ { "index": 0, "text": "Send the deck" } ],
    "folders": [ { "id": "inbox", "path": "Inbox" }, { "id": "0b3f6f1e-3c2a-4d0e-9a54-6c2b1b6f9d10", "path": "Clients / Acme" } ]
  },
  "model": "jev-latest",
  "questions": {
    "meeting_type": { "type": "choice", "instructions": "Which meeting type ...", "criteria": { "standup": "A recurring status sync: ...", "other": "None of the other types is a reasonable fit." } },
    "urgency": { "type": "score", "instructions": "How time-critical ...", "criteria": [ "Routine: ...", "Time-sensitive: ...", "Blocking: ..." ] },
    "contains_decisions": { "type": "noul", "instructions": "Does `transcript` contain ...", "criteria": { "true": "Someone chose an option, ...", "false": "Topics were discussed but no decision was reached." } },
    "item_0_relation": { "type": "choice", "instructions": "Does `transcript` support, contradict, or say nothing about the claim in `action_items[0].text`?", "criteria": { "supports": "...", "contradicts": "...", "says_nothing": "..." } }
  }
}
```

Per-line question (personal tasks) with object instructions:

```json
"line_L012_task": {
  "type": "noul",
  "instructions": { "line": "Please send the TV1 deck tomorrow.", "question": "Is this line a request or commitment the listener should act on?" },
  "criteria": { "true": "The line asks the listener to do something or records a commitment they should act on", "false": "The line is not a request or commitment for the listener" }
}
```

Semantic-find line choice options have null descriptions: `"criteria": { "L000": null, "L001": null }`. The semantic-find state is a bare JSON string, e.g. `"state": "L000| hello\nL001| world"`.

Response (from the test fixture):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "is_urgent": { "type": "noul", "noul": 0.95 },
    "department": { "type": "choice", "choice": "billing", "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 }, "confidence": 0.81 },
    "frustration": { "type": "score", "score": 1.05, "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" }, "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 }, "confidence": 0.92 }
  },
  "usage": { "input_tokens": 10, "output_tokens": 5 }
}
```

Models response: `{"models":[{"name":"jev-latest","description":"flagship","release_date":"2026-01-01"}]}`; only `name` is read.

Error bodies are never parsed or shown.

---

## 5. Native and OS dependencies

| Item | Where | Windows-only or portable |
|---|---|---|
| DPAPI encryption (`ProtectedData`, CurrentUser) | `FileDpapiTypeSafeCredentialStore` | Windows-only. Replace behind `ITypeSafeCredentialStore` with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Existing `.bin` files can only be read via DPAPI; migration is optional. |
| Store path under `%LOCALAPPDATA%` | `AppPaths` | Windows path convention; use the Electron per-user data directory. |
| HTTPS client, 2-minute timeout, JSON | `TypeSafeApiClient`, `AppServices.cs:21` | Portable. |
| Retry timers (`Task.Delay`) | client | Portable; keep the delay injectable for tests. |
| Clipboard (`Windows.ApplicationModel.DataTransfer`) | `PersonalTasksDialogViewModel.CopyHit` | Windows-only API; Electron `clipboard.writeText` is portable. |
| WinUI UI: `ContentDialog`, `InfoBar`, `ProgressRing`, `SettingsCard`, `PasswordBox`, `DispatcherQueueTimer`, `MarkdownTextBlock` (CommunityToolkit) | App layer | Windows-only; reimplement in the renderer. The checklist must render Markdown including task-list checkboxes. |
| `TypeSafeIcon` vector path | Control | Portable (SVG path, same coordinates). |
| Culture formatting for `P0` percent, culture-aware folder sort | Core / VM | Platform-neutral intent; use `Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:0})` and `Intl.Collator(locale, {sensitivity:'accent'})`-like case-insensitive ordering. |
| `AppStrings` / `.resw` localization | App | Windows resource system; port to the app's i18n catalog (en, es). |
| Core logic (analyzer, presentation gates, personal tasks, prompt builder, transcript index) | Core | Portable; no OS dependency. |

---

## 6. Existing test coverage (`MeetingLive.Core.Tests`)

All under `Services/` unless noted. Cases that must carry over:

**TypeSafeApiClientTests** (4)
- `EvaluateAsync_SendsBearerAndJsonBody_ReturnsNoulChoiceAndScore`: POST to `.../v1/systemone`; Bearer header; `User-Agent` contains "MeetingLive"; body has `model = "jev-latest"`, `state.ticket`, each question type; the key never appears in the body; the fixture response maps noul 0.95, choice "billing" with confidence 0.81, score 1.05, and the model is `jev-1.13.0`.
- `EvaluateAsync_WhenUnauthorized_ThrowsUnauthorizedWithoutLeakingBodyOrKey`: 401 -> `Unauthorized`; message contains neither the key nor body content.
- `EvaluateAsync_WhenRateLimitedThenOk_RetriesAndSucceeds`: 429 then 200 -> 2 requests, success; body text does not leak.
- `ListModelsAsync_ReturnsModelNames`: GET `.../v1/models`, Bearer header, names returned in order.
Missing today: 529 mapping, retry exhaustion (3 x 429 -> RateLimited), Retry-After handling, non-JSON body, empty answers, blank key, de-duplication of model names, network exceptions.

**MeetingJevAnalyzerTests** (3)
- `AnalyzeAsync_BuildsFanOutRequest_ContainsExpectedQuestionIdsAndState`: question ids (`meeting_type`, `spoken_language`, `urgency`, `contains_decisions`, `contains_commitments`, `pii_present`, `summary_faithful`, `folder`, `item_N_relation`) and state keys.
- `AnalyzeAsync_WhenSummaryEmpty_OmitsSummaryFaithfulAndMapsVerdicts`.
- `AnalyzeAsync_WhenMoreThan20ActionItems_CapsRelationQuestionsAt20`.
Missing: transcript truncation and the `transcript_truncated` flag, 254-folder cap, `none`/duplicate-id handling, wrong-type answers, no-folder case.

**MeetingJevPresentationTests**: contradicted with high confidence removed; low confidence kept; relation other than contradicts kept (theory); no verdicts returns the same list instance; folder suggestion true for a confident, different GUID; false for `inbox`/`none` (theory); false when equal to the current folder.
Missing: exactly 0.8 boundary, null confidence, duplicate texts, unparseable GUID.

**MeetingJevServiceTests** (7): disabled -> no HTTP; no key -> no HTTP; empty transcript -> no HTTP; `TypeSafeException` -> null without throwing; success sets `record.JevAnalysis`; contradicted action item removed; confident folder suggestion files the record.

**MeetingJevPersonalTasksTests** (5): empty transcript sends no HTTP; keeps only task noul >= 0.65; with topic requires both task and topic; `exists = 0.1` -> Absent even with a high-scoring line; more than 40 lines are batched into several requests.
Missing: 20-line batches with a topic, max 15 evidence cap, ordering by score, `exists` boundary values.

**MeetingJevAskTests** (6): sends `exists` + `where` and maps hits to original text; `exists = 0.14` -> Absent; `0.98` -> Answered; empty query/transcript send no HTTP; more than 255 lines -> window request then line request.
Missing: Partial band (0.35-0.7), MinHitScore 0.02 and MaxHits 5 cut-offs.

**PersonalTasksPromptBuilderTests** (2): empty evidence yields `(none)`, no `<topic>`, "Do not invent", "No extra chatter", default language Spanish; evidence + topic yields line text, `<topic>TV1</topic>`, "in English", "- [ ]".

**FileDpapiTypeSafeCredentialStoreTests** (2): in-memory round trip; file store round trip: file exists, the key is not present in the raw bytes, loaded value equals saved value, `ToString()` hides the key, `Clear` removes the file and Load returns null.

Helper types: `TestHelpers/InMemoryTypeSafeCredentialStore`, `FakeHttpMessageHandler`.

Related suites outside this module that touch it: `TranscriptLineIndexTests`, `FolderPathListTests`, `CliSummaryPromptBuilderTests`, `ChatContextPackerTests`, `MeetingMarkdownFormatterTests` (`## Jev` round trip), `AppSettingsTests` (TypeSafeEnabled), `LiveQuestionJevJudgeTests`.

There are no tests for the App layer (view models, runner, dialog).

---

## 7. Bugs, races, and uncovered cases

Confirmed = verified by reading the code. Suspected = depends on framework behavior or timing not exercised.

1. **Confirmed. Timeouts and network failures are not wrapped as `TypeSafeException`.** `_http.SendAsync` (TypeSafeApiClient.cs:~136) throws `HttpRequestException` or `TaskCanceledException` (an `OperationCanceledException`). `MeetingJevService` only catches `TypeSafeException` (MeetingJevService.cs:53). `MeetingJevRunner` rethrows every `OperationCanceledException` (MeetingJevRunner.cs:28, 63), so an HTTP timeout is treated as user cancellation. On the summary page this lands in the generic catch and shows `Error_GenerateSummary` even though the summary was produced and saved (SummaryPageViewModel.cs:254). In the recording pipeline it is swallowed silently.
2. **Confirmed. The API key is saved before it is validated.** TypeSafeSectionViewModel.cs:70 persists the draft, then validates. A wrong key remains saved, `HasApiKey` stays true, the Jev gates (chat recipe, live questions, post-summary) all think a key exists, and every later call fails with Unauthorized. `Save` also runs outside the `try` (:70), so an encryption or disk failure becomes an unhandled exception in the async command.
3. **Confirmed. Clear failures are invisible.** `Clear()` swallows `IOException`/`UnauthorizedAccessException` (FileDpapiTypeSafeCredentialStore.cs:80-83), and the view model then shows "TypeSafe API key cleared." while the status refresh may still say "API key saved".
4. **Confirmed. Settings description contradicts behavior.** `Settings_TypeSafeEnabled.Description` says "Off by default until you save a key" (en and es), but `TypeSafeEnabled` defaults to true (AppSettings.cs:106) and the key is the only real gate.
5. **Confirmed. Unbounded `Retry-After`.** GetRetryDelay (TypeSafeApiClient.cs:177-190) honors any server value. The delay is outside the 2-minute `HttpClient` timeout, so a large value can stall analysis (and the Settings busy ring) for a long time.
6. **Confirmed. 502/503/504 and network errors are not retried**; only 429 and 529 are (TypeSafeApiClient.cs:~170). Transient gateway failures surface as RequestFailed immediately.
7. **Confirmed. Transcript truncation can split a surrogate pair** (`transcript[..48000]`, MeetingJevAnalyzer.cs:63). The truncation also drops the end of long meetings, where decisions and commitments often are; only the state flag `transcript_truncated` tells Jev the transcript is cut, no question text does.
8. **Confirmed. No cap on summary or action-item text length.** Only the transcript is capped (MeetingJevAnalyzer.cs:69). Action items beyond 20 are never verified yet are kept.
9. **Confirmed. Personal-tasks scoring is wasteful.** `FindAsync` runs the line-scoring loop even when `exists` already indicates Absent (MeetingJevPersonalTasks.cs:50-51); every batch re-uploads the whole tagged transcript (up to 48 KB) for every 20-40 lines, sequentially, with no cancellation token (PersonalTasksDialogViewModel.cs:143). A 2000-line transcript can mean 50+ requests. Closing the dialog does not stop them.
10. **Confirmed. Prompt injection and format breakage.** Topic and evidence text are placed into the checklist prompt unescaped (PersonalTasksPromptBuilder.cs). A topic containing `</topic>` or newlines, or a transcript line imitating prompt rules, alters the prompt. Backticks in the topic also break the instruction quoting in the Jev questions.
11. **Confirmed. Unknown output languages fall back to Spanish.** `ToEnglishLanguageName` returns "Spanish" for blank and for any code not in its 9-entry list (CliSummaryPromptBuilder.cs:174-187), so a user whose summary language is outside the list gets a Spanish checklist.
12. **Confirmed. Jev can override a user-chosen folder.** `record.FolderId` is replaced when the suggestion is confident and different (MeetingJevService.cs:48), including a folder the user picked before recording, and again on every summary regeneration. The suggested id is not checked against the folder list.
13. **Suspected. Duplicate action-item texts.** Removal is by text, so if two items share text and Jev contradicts only one, both are dropped (MeetingJevPresentation.cs). Verdicts are keyed by text, not index.
14. **Suspected. Lost update.** The analysis can take minutes (retries, 2-minute timeout) while the shared record is mutated and then saved whole (MeetingJevRunner.cs:~55); edits the user made to the meeting in the meantime can be overwritten.
15. **Confirmed. The dialog's load ring never shows.** `ShowAsync` awaits `LoadAsync` before showing the dialog (PersonalTasksDialog.xaml.cs:30), so `IsLoading` is already false when the dialog first appears.
16. **Confirmed. Opening the dialog changes global selection.** `LoadAsync` calls `Workspace.SelectMeeting` (PersonalTasksDialogViewModel.cs:96) just to read a transcript; with a null id it also selects the newest meeting.
17. **Confirmed. TypeSafe error text is English only and not a resource key** (TypeSafeApiClient.cs consts; shown through `ex.Message` at TypeSafeSectionViewModel.cs and PersonalTasksDialogViewModel.cs:180). Spanish users see English errors.
18. **Confirmed. `MeetingJevAsk.AskAsync` is dead code** for the app (only `VerdictFor` is used, by personal tasks). Its two-pass path is tested but unreachable from the UI.
19. **Suspected. Non-atomic key write.** `File.WriteAllBytes` (FileDpapiTypeSafeCredentialStore.cs:67) can leave a truncated file on a crash; `Load` then returns null (corrupt data is silently treated as "no key") so the user loses the key without notice.
20. **Confirmed. Wasted work on the post-summary path.** It always sends all questions, including `summary_faithful`, `pii_present`, decisions and commitments, urgency, type and language, but only two verdict kinds ever change anything (contradicted items, folder). The rest is stored and never read.
21. **Confirmed. Failed runs leave stale data.** If a later analysis fails, the previous `JevAnalysis` stays on the record with its old `analyzedAt`, and nothing indicates it is stale.
22. **Confirmed. Evidence ordering.** The 15 evidence lines passed to the checklist prompt are ordered by score, not transcript order (MeetingJevPersonalTasks.cs RankEvidence), so the checklist is not chronological.
23. **Confirmed. Uncovered cases with no tests or handling:** `exists` exactly 0.35 or 0.7; scores of exactly 0.65 (kept, since the comparison is `>=`); a transcript with a single very long line (kept even if it exceeds 48000); folder names that contain " / "; a topic with only punctuation.
24. **Suspected. Settings toggle optimism.** `ToggleEnabledAsync` sets `IsEnabled` before the save completes and does not revert if the save fails.

Totals: 20 confirmed entries (1-12, 15-18, 20-23), 4 suspected (13, 14, 19, 24).

---

## 8. Parity checklist

Tick each item when the Electron implementation matches.

### API client
1. Base URL `https://api.typesafe.ai/v1`; evaluate = `POST /systemone`; models = `GET /models`.
2. Model id sent is always `jev-latest`.
3. Request body property order `state`, `model`, `questions`; JSON, UTF-8.
4. Headers `Authorization: Bearer <key>` and `User-Agent: MeetingLive` on every request.
5. Blank or missing key raises Unauthorized before any network call.
6. Request timeout 2 minutes per HTTP request.
7. Retry only on HTTP 429 and 529, at most 3 attempts total, body drained between attempts.
8. Retry delay: positive `Retry-After` seconds, else future `Retry-After` date, else `200 ms * 2^attempt`.
9. Final attempt's response is mapped to an error as-is.
10. 401 -> Unauthorized; 429 -> RateLimited; 529 -> Overloaded; other non-2xx -> RequestFailed.
11. Exact error messages from section 2.5 (consider localizing; keep the English default).
12. Error messages never include the key or any response body text.
13. Invalid JSON response -> RequestFailed.
14. Missing, null, or empty `answers` -> EmptyOutput.
15. Result model = response `model`, or `jev-latest` when blank.
16. Extra response fields (such as `usage`) ignored; property names case-insensitive.
17. Answer fields: type, noul, choice, score, confidence, probabilities, legend, defaulting to ""/0/null.
18. Question JSON: `type`, `instructions` (string or object), `criteria` omitted when null.
19. Noul criteria include only the provided `true`/`false` keys; omitted when neither.
20. Choice criteria is a map id -> description (null descriptions serialized as null); score criteria is an ordered string array.
21. List-models returns non-blank names, de-duplicated case-insensitively, in order; missing `models` -> empty.
22. Network exceptions are handled (decide the mapping; the C# leaks them, see bug 1).

### Credentials
23. Key stored encrypted per OS user, outside `settings.json`.
24. Load returns null for missing, empty, corrupt, undecryptable, or blank-key data, never throwing.
25. Save rejects a blank key; creates the parent directory; overwrites.
26. Clear deletes the file and ignores IO and permission errors.
27. Store access is serialized (single lock).
28. The credential value never prints the key in logs, string conversion, or debug output.
29. Same `Load/Save/Clear` interface so the macOS store can plug in.

### Settings section
30. Section header: icon + "TypeSafe (Jev)".
31. Enable toggle persists `TypeSafeEnabled` (default true); no-op when the value is unchanged.
32. Toggle description string (en/es) as in 2.1 (fix the "off by default" wording or keep it per bug 4).
33. Status card shows "Not configured" without a key and "API key saved" with one, on load and after clear.
34. API key input is a masked field; its text mirrors `ApiKeyDraft`.
35. Save enabled only when the draft is non-blank and not busy; Clear enabled only when a key exists and not busy.
36. Save trims the key, persists it, empties the draft/field, sets `HasApiKey`.
37. Save then calls list-models with a busy indicator; success shows "Ready. Using Jev." plus the "API key saved." feedback.
38. Save failure shows "Could not reach TypeSafe" with the exception message as the detail; the key stays saved (or fix per bug 2).
39. Clear removes the key, empties the draft/field, resets status, shows "TypeSafe API key cleared."
40. Feedback bar auto-closes after 4 seconds; a new feedback restarts the timer; manually closable.
41. Automation/test ids kept: `ToggleTypeSafe`, `CardTypeSafeStatus`, `BoxSettingsTypeSafeApiKey`, `BtnTypeSafeSaveApiKey`, `BtnTypeSafeClearApiKey`, `InfoTypeSafeFeedback`.
42. All settings strings present in en and es.

### Post-summary analysis: triggers and gating
43. Runs after the recording pipeline saves a summarized meeting.
44. Runs after summary generation/regeneration on the summary page, then reloads action items.
45. Silent: no UI, no status, no errors surfaced.
46. Skips when the settings load fails, `TypeSafeEnabled` is off, no key, or the transcript is blank.
47. Folder list is loaded and flattened with the localized Inbox label.
48. On success: apply the contradicted-item filter, the folder gate, store `JevAnalysis`, save the record, notify the workspace that the meeting changed.
49. Nothing is saved when the analysis is null or fails.
50. Cancellation propagates; the recording pipeline ignores it after the summary is saved.

### Analysis request
51. Transcript truncated to the first 48,000 characters; `transcript_truncated: true` set only when cut.
52. At most 20 action items, sent as `{index, text}`.
53. `summary` is sent as given (null if absent); `meeting.title` is `""` when null.
54. `folders` state present only when the folder list is non-empty; first entry `{id:"inbox", path:<inbox path>}` (fallback path `Inbox`).
55. Folder ids are lowercase hyphenated GUIDs; the null-id item maps to `inbox`; duplicates skipped; max 254 entries including inbox.
56. Folder paths flattened: Inbox first, depth-first, siblings sorted by name case-insensitively and culture-aware, joined with `" / "`.
57. Questions `meeting_type`, `spoken_language`, `urgency`, `contains_decisions`, `contains_commitments`, `pii_present` always sent, with the exact verbatim texts and options of 3.2.
58. `summary_faithful` sent only when the summary is non-blank.
59. `folder` question sent only when folders exist; options `inbox`, folder GUIDs (skip id `none`, duplicates, stop at 254), then `none` last.
60. Inbox option description is the Inbox item's path (fallback `Inbox — unfiled meetings.`).
61. One `item_{i}_relation` choice question per action item (max 20) with `supports`/`contradicts`/`says_nothing` options and their exact descriptions.
62. All questions go in one request.

### Analysis composition
63. Answers are accepted only when their `type` matches the expected one (case-insensitive).
64. `MeetingType`/`MeetingTypeConfidence`/`SpokenLanguage` from choices (null when missing).
65. `UrgencyScore` from the score answer (0 when missing); `UrgencyConfidence` null when missing.
66. `ContainsDecisions`, `ContainsCommitments`, `PiiRisk` from noul answers (0 when missing).
67. `SummaryFaithful` set only when a summary was sent.
68. `SuggestedFolderId`/`FolderConfidence` set only when folders were sent.
69. Action-item verdicts carry the original text, relation, and confidence; items with no choice answer are skipped.
70. `Model` from the response; `AnalyzedAt` = current UTC time.
71. Persisted JSON shape and camelCase names per 4.3; the `## Jev` section round trip.

### Confidence gates
72. Threshold 0.8, inclusive (`>=`).
73. A contradicted item is removed only for relation `contradicts` (case-insensitive) with confidence `>= 0.8`; null confidence never qualifies.
74. Matching is by exact (ordinal) text; the same list instance is returned when nothing is removed.
75. Folder move requires confidence `>= 0.8`, a suggested id that is not blank/`inbox`/`none`, parseable as a GUID, and different from the current folder.
76. Jev never moves a meeting to Inbox.
77. Decisions, commitments, PII, faithfulness, urgency, type, and language are stored only, with no UI.
78. The chat context packer must not read `JevAnalysis`.

### Personal tasks: entry and gating
79. Chat recipe button visible only in single-meeting scope with Jev enabled and a key present; refreshed on scope change and after a send.
80. Button label/tooltip "What do I need to do" / "Qué necesito hacer", with the TypeSafe icon.
81. Re-entrancy guard against opening a second dialog.
82. Dialog loads the requested meeting, or the most recent by recorded date when no id is given.
83. Opening the dialog selects that meeting in the workspace (decide whether to keep; see bug 16).
84. Empty status order: no transcript -> "has no transcript"; else no key or Jev off -> "Save a TypeSafe API key..."; else empty.
85. Ask is enabled only with transcript, enabled flag, key, and not already asking.
86. Ask re-reads settings and credentials at click time and re-applies the empty status if the gate fails.

### Personal tasks: dialog UI
87. Fixed 440 width; title/close text from resources; Close is the default button.
88. Topic field: single line, updates on each keystroke, optional header/placeholder per resources.
89. Ask button (icon + label), spinner while asking, secondary-color wrapping status text.
90. Verdict info bar: informational severity, closable, two-way open state.
91. Checklist area: Markdown rendering with task-list checkboxes, max height 280, vertical scroll only.
92. "From the transcript" caption and hits list (max height 240) shown only when there are hits.
93. Each hit shows the line text and score as a percent with no decimals (culture formatting).
94. Clicking a hit copies its text to the clipboard and sets status "Copied."; blank text is ignored.
95. Loading indicator during load (make it actually visible, see bug 15).
96. Automation ids kept: `BoxAskTopic`, `BtnAskJev`, `InfoAskVerdict`, `TxtAskChecklist`, `ListAskHits`.

### Personal tasks: algorithm
97. Blank transcript -> Absent with zero requests.
98. Topic trimmed; blank means no topic.
99. Transcript split to non-empty trimmed lines with ids `L000`..., tagged as `Lnnn| text`, truncated to complete lines within 48,000 tagged characters.
100. Exists request: state `{"transcript": tagged}`, a single noul `exists` with the verbatim texts (with and without topic).
101. Scoring batches of 40 task questions (20 lines when a topic is given), sequential, each with state `{"transcript": tagged}`.
102. Task question ids `line_{id}_task` with object instructions `{line, question}` and the verbatim criteria.
103. Topic question ids `line_{id}_topic` with object instructions `{line, topic, question}` (question has the topic in backticks) and the verbatim criteria.
104. Missing task or topic answers count as 0; with no topic the topic score is 1.
105. Keep a line when task `>= 0.65` and (no topic or topic `>= 0.65`).
106. Sort kept lines by task score descending, ties in transcript order; keep at most 15.
107. Verdict: exists `>= 0.7` Answered; `< 0.35` Absent; else Partial.
108. Verdict Absent, or zero evidence, ends in the absent message (do not write a checklist).
109. Absent message: no topic -> "Nothing was asked of you"; topic -> "This meeting did not cover {topic}". Clears checklist and hits; opens the info bar; clears status.
110. Status text "Finding what you need to do..." during search and "Writing your checklist..." during composition.
111. Evidence (hits) is displayed as soon as the search finishes, before the checklist is written.

### Personal tasks: checklist
112. Resolve the summary provider from the user's selected summary provider kind; offer the provider's setup flows when needed.
113. Setup cancelled -> status "Setup cancelled." and the evidence stays visible.
114. Prompt built exactly as in 3.6 (including `(none)`, the topic block formatting, and the `- ` prefix on evidence lines).
115. Output language from the summary language setting through the 9-code map; fallback Spanish (decide whether to keep; see bug 11).
116. The prompt is completed through the provider's non-streaming "complete prompt" call, off the UI thread.
117. A trimmed response equal to `NONE` (case-insensitive) shows the absent message.
118. Otherwise the trimmed Markdown becomes the checklist; status and info bar cleared; hits remain visible.
119. `TypeSafeException` -> status shows its message and the info bar closes; any other exception -> status shows the standard CLI/provider failure message and the info bar closes.
120. Asking flag and button state are reset in a finally block on every path.

### Icon
121. Eight-pointed star SVG with the exact path from 2.4, monochrome, follows the theme text color, scales uniformly.

### Tests to port
122. Port all cases listed in section 6 (API client 4, analyzer 3, presentation, service 7, personal tasks 5, ask 6, prompt builder 2, credential store 2), and add the "missing" cases noted there.

### Bugs to decide on when porting
123. Wrap network and timeout errors so they cannot surface as cancellation (bug 1).
124. Validate the key before persisting it, or roll back on 401 (bug 2).
125. Report credential clear failures (bug 3).
126. Fix or confirm the "off by default" wording (bug 4).
127. Cap `Retry-After` and consider retrying 5xx gateway errors (bugs 5, 6).
128. Avoid splitting surrogate pairs when truncating (bug 7).
129. Skip line scoring when `exists` is already Absent, accept a cancellation token, and avoid re-uploading the entire transcript per batch (bug 9).
130. Escape or fence the topic and evidence in the checklist prompt (bug 10).
131. Decide whether Jev may override a user-chosen folder (bug 12).
132. Match contradicted items by index, not text (bug 13).
133. Merge into the latest saved record instead of overwriting it (bug 14).
134. Localize TypeSafe error messages (bug 17).
135. Decide whether to port `MeetingJevAsk.AskAsync` (bug 18).

Cross-module dependencies the port must expose: `TranscriptLineIndex`, `FolderPathList`, `CliSummaryPromptBuilder.ToEnglishLanguageName`, the summary provider abstraction (`CompletePromptAsync`) and resolver with setup flows, the meeting repository and workspace change notifications, the Markdown/JSON meeting serializers (`## Jev`), `AppSettings.TypeSafeEnabled`, the settings save base class, the chat view-model recipe gate, and the live-question judge that reuses this client and gate.
