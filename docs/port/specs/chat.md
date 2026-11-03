# Chat module behavior spec

Source of truth: MeetingLive.Core and MeetingLive.App at branch `feat/electron-port`. Line references are `file:line` relative to the repository root. "Confirmed" means the behavior follows directly from the cited lines. "Suspected" means it depends on runtime behavior that was not exercised.

Conventions used below:

- `NL` is `Environment.NewLine`, which is `\r\n` on Windows. `ChatContextPacker` and `ChatPromptBuilder` use `AppendLine`, so their output contains `\r\n` on Windows. The port may use `\n` everywhere as long as it does so consistently; no test asserts line endings.
- Lengths are UTF-16 code units (C# `string.Length`). A JavaScript `string.length` matches this. Do not use code-point counts.
- String keys beginning `Chat_`, `SummaryPage_`, `RecordPage_`, `Status_`, `History_` are in `MeetingLive.App/Strings/{en-us,es}/Resources.resw`. Keys beginning `Chat` (no underscore) or `Recipe` are in `MeetingLive.Core/Strings/CoreStrings{,.es}.resx`.

## 1. Purpose

The module is a private, read-only question-and-answer assistant over the user's own meeting notes. It has three parts.

1. A docked chat bar present on every page except Settings. It answers questions using a summary provider (local GGUF model, Claude Code CLI, Codex CLI, or xAI). Scope follows what the user is looking at: live capture, one meeting, one library folder, or all meetings. Threads persist locally. Reusable prompts ("recipes") exist as built-ins plus user-defined ones. Answers are Markdown and may cite meetings through clickable links.
2. A pre-meeting brief prompt (`MeetingBriefPromptBuilder`) used by the Record page for calendar events.
3. Two small helpers used by list UIs: `RelatedMeetings` (Summary page "Related meetings") and `MeetingSnippet` (Library list row preview).

Nothing in chat sends, posts, or writes meeting files. Drafts (email, Slack, plan) are text only.

## 2. User-facing features

### 2.1 Chat bar shell and visibility

- The bar is an `Expander` (`BarMeetingChat`, `x:Uid Chat_Bar`, AutomationId `BarMeetingChat`) in `MainPage.xaml:59-407`, docked below `ContentFrame`, `ExpandDirection=Up`, stretched full width. It belongs to the app shell, not to any page. `SessionPage` and `HistoryPage` contain no chat UI; they only publish scope inputs (section 3.2).
- Visible when `ChatScopeDecision.IsVisible` is true. Hidden (Collapsed) on the Settings surface only (`ChatScopeResolver.cs:32-33`).
- Collapsed by default (`MeetingChatViewModel.cs:49-50`). It collapses again every time the resolved scope changes (kind, folder id, or meeting id differs from the previous decision) (`:410-411`). It expands on New chat and on opening a thread (`:126`, `:281`). The user can toggle it by clicking the header.
- Header (always visible, left to right):
  1. Scope chip: rounded subtle border with a glyph and `ScopeLabel` text (`LblMeetingChatScope`, trimmed with ellipsis). Header minimum width 240.
  2. History button (`BtnMeetingChatHistory`, Segoe Fluent glyph U+E81C, tooltip and automation name `Chat_History`: "Chat history" / "Historial de chat").
  3. New chat button (`BtnMeetingChatNew`, glyph U+E710, `Chat_New`: "New chat" / "Nuevo chat"), bound to `NewChatCommand`.
- Scope glyphs (`MeetingChatViewModel.cs:460-466`): Live U+E720, Meeting U+E7C3, Folder U+E8B7, All meetings U+E8F1 (default). The port may substitute icons with the same meaning.
- Scope labels (`BuildScopeLabelAsync`, `:432-458`), empty when not visible:

| Kind | Condition | Key | en | es |
| --- | --- | --- | --- | --- |
| Live | always | `Chat_ScopeLive` | Live | En vivo |
| Meeting | title non-blank | `Chat_ScopeMeetingNamed` | Meeting: {0} | Reunión: {0} |
| Meeting | meeting not found or blank title | `Chat_ScopeMeeting` | Meeting | Reunión |
| Folder | name non-blank | `Chat_ScopeFolderNamed` | Folder: {0} | Carpeta: {0} |
| Folder | folder not found or blank name | `Chat_ScopeFolder` | Folder | Carpeta |
| AllMeetings | default | `Chat_ScopeAll` | All meetings | Todas las reuniones |

### 2.2 Body of the expanded bar

Layout (`MainPage.xaml:169-406`), a vertical stack with 8 px spacing and 12 px padding:

1. Transcript list `ChatTranscript` (AutomationId `ListMeetingChat`, name `Chat_Transcript` "Chat messages"/"Mensajes de chat"). Max height 420, no selection, visible only when `HasMessages`.
2. Error `InfoBar` (`InfoMeetingChatError`, title `Chat_Error` "Could not answer"/"No se pudo responder", severity Error, closable, bound two-way to `IsErrorOpen`, message `ErrorMessage`).
3. Scope-mismatch text (`Chat_ScopeMismatch`): en "This chat is from another scope. Sending starts a new chat." es "Este chat es de otro ámbito. Al enviar se iniciará un nuevo chat." Secondary foreground. Visible when `ShowScopeMismatch`.
4. Starter chips (`ListMeetingChatStarters`, name `Chat_Starters` "Suggested questions"/"Preguntas sugeridas"), wrap panel with 8 px gaps, visible when `ShowStarterRecipes`.
5. Composer row: text box, Send, Personal tasks (conditional), Recipes.

Message rows:

- User message: right-aligned bubble (grid columns weighted 1*:3*, bubble in the wide column, so at most 75% width), 12,8 padding, corner radius 8, card background and stroke. Plain `TextBlock`, wrapped, text selectable. No Markdown.
- Assistant message: caption role label ("Assistant"/"Asistente") above a Markdown block (CommunityToolkit `MarkdownTextBlock`, `TextWrapping=WrapWholeWords`, transparent background, `LinkClicked` handler). A copy button (32x32, glyph U+E8C8, `Chat_Copy` "Copy"/"Copiar") on the right, visible only for completed answers (`HasAnswer = IsAssistant && !IsPending`).
- Pending assistant row with no text yet ("thinking"): a 16 px indeterminate progress ring plus text `Chat_Thinking` ("Thinking…"/"Pensando…"). Markdown block shows as soon as `Text.Length > 0`.
- Role labels: `Chat_RoleUser` "You"/"Tú" (set on the item but not shown for user bubbles), `Chat_RoleAssistant` "Assistant"/"Asistente".
- Accessibility: each row's `ToString()` is `"{RoleLabel}: {Text}"`, or just `RoleLabel` while thinking (`ChatComposerItems.cs:41`).

### 2.3 Composer

- Multi-line text box (`TxtMeetingChat`, placeholder `Chat_Composer.PlaceholderText` "Ask about your meetings"/"Pregunta sobre tus reuniones", automation name "Message"/"Mensaje"). `AcceptsReturn`, wrapping, min height 32, max height 96, min width 180, vertical scrollbar auto. Two-way bound to `Draft`, updated on every keystroke.
- Enter sends. Shift+Enter inserts a newline (`MainPage.xaml.cs:97-109`). Ctrl+Enter also sends via a keyboard accelerator on the Send button (`:111-116`). Enter is checked in `PreviewKeyDown` so it fires before the text box inserts a newline; the event is marked handled even when sending is currently not possible (empty draft, already sending), so Enter on an empty draft does nothing and inserts no newline.
- Send button (`BtnMeetingChatSend`, accent style, glyph U+E724, `Chat_Send` name "Send"/"Enviar", tooltip "Send (Enter)"/"Enviar (Enter)"). Enabled iff `!IsSending && IsVisible && Draft is not blank` (`:376`).
- Personal tasks button (`BtnMeetingChatPersonalTasks`, TypeSafe icon, `Chat_PersonalTasks` "What do I need to do"/"Qué necesito hacer"). Visible iff scope kind is Meeting and the TypeSafe feature is available (setting `TypeSafeEnabled` true, default true, and stored credentials with a non-blank `ApiKey`) (`:100`, `:423-430`). Click opens `PersonalTasksDialog.ShowAsync(root, CurrentMeetingId)`; a re-entrancy flag ignores clicks while the dialog is opening (`MainPage.xaml.cs:133-147`). The dialog itself belongs to another module. The availability flag is re-read on every scope refresh and each time the bar expands (`:721-739`).
- Recipes button (`BtnMeetingChatRecipes`, glyph U+E8FD, `Chat_Recipes` "Recipes"/"Recetas") opens the recipes flyout (2.5).

### 2.4 Send flow (exact sequence, `MeetingChatViewModel.cs:129-236`)

Preconditions: `!IsSending`, `_decision.IsVisible`, `Draft.Trim()` non-empty; otherwise no-op.

1. `userMessage = Draft.Trim()` (internal line breaks kept). Remember `originalDraft` (untrimmed).
2. `IsSending = true`, clear error.
3. Optimistic UI: append a user row (new Guid, role `user`, text = userMessage) and a pending assistant row (`IsAssistant`, `IsPending`, empty text). `HasMessages = true`. Draft is cleared. (The starter chips hide while `IsSending` or `HasMessages`.)
4. Snapshot `decision = _decision`, `open = _openThread`. If `open` exists and does not match the decision (`MatchesOpenThread`, 3.2), treat as no open thread. `prior` = copy of `open.Messages` or empty.
5. Load all meetings and all folders from the repositories (every call; no caching).
6. `context = ChatContextPacker.Pack(kind, folderId, meetingId, Workspace.LiveTranscript, meetings, folders)` (3.3).
7. `prompt = ChatPromptBuilder.Build(kind, context, prior, userMessage)` (3.4).
8. Load settings; resolve the provider with `SummaryProviderResolver.ResolveAsync(settings.ResolveSummaryProviderKind(), EnsureSummaryModelAsync, EnsureCliProviderAsync, EnsureXaiProviderAsync)`. Each gate may prompt the user (local model download dialog, CLI availability check, xAI sign-in). If it returns null, show error `Status_SetupCancelled` ("Setup cancelled."/"Configuración cancelada.") and stop. The error text here has no "Could not answer" prefix.
9. Stream the answer off the UI thread (3.5). Result is `.Trim()`-ed.
   - `OperationCanceledException`: return silently (no message). Nothing passes a cancellation token, so this is unreachable today.
   - Any other exception: show `Chat_SendFailed` ("Could not answer. {0}"/"No se pudo responder. {0}") with the raw `ex.Message`.
10. If the trimmed answer is blank: show `Chat_EmptyAnswer` ("The answer came back empty."/"La respuesta llegó vacía.").
11. Otherwise persist on the UI thread (`PersistTurnAsync`, 4.1): append user message then assistant message to the thread, save, then re-render the whole transcript from the thread, set `_openThread`, recompute mismatch, refresh the thread list.
12. Any exception in steps 4-11 not already handled: show `Chat_SendFailed` with `ex.Message`.
13. `finally` (on the UI thread): roll back optimistic rows. If the pending row is still in the list it is removed; if the user row is still in the list it is removed, `HasMessages` is recomputed, and `Draft` is restored to `originalDraft` only if the draft is currently empty. (After a successful turn the list was rebuilt, so nothing is removed and nothing is restored.) Then `IsSending = false`. If marshalling to the UI thread fails, the rollback runs inline and shows `Chat_SendFailed`.
14. UI marshalling failure (no dispatcher queue or enqueue refused) throws `Chat_UiMarshalFailed` ("Could not show the answer in the window."/"No se pudo mostrar la respuesta en la ventana.").

Failure never persists anything: the user turn is dropped from history, and only the draft is restored.

### 2.5 Recipes

Recipe list shown to the user for a scope = built-ins for the scope's availability, then user recipes of that availability, excluding any user row whose id equals a built-in id (`ChatRecipeList.ForScope`, 3.7). The scope→availability map: Meeting and Live → `single`; Folder and AllMeetings → `multiple`.

Surfaces:

1. Starter chips: the first 4 items of the scope list (`StarterRecipeCount = 4`), shown when `StarterRecipes.Count > 0 && !HasMessages && !IsSending`. Chip text is the recipe name; tooltip is the prompt; automation name is the name. Clicking a chip fills the draft with the prompt and sends immediately (`SendRecipeAsync`: `ApplyRecipe`, then `SendCommand.ExecuteAsync` only if `CanExecute`). With built-ins first, Meeting/Live chips are: What's been discussed, Action items, Follow-up email, What should I do next. Folder/All chips are the three multi-meeting built-ins (user recipes only appear if built-ins are fewer than 4, which is never the case for single (5 built-ins) and always the case for multiple (3 built-ins + first user recipe)).
2. Recipes flyout (button `BtnMeetingChatRecipes`): 320 px wide, placement top-edge-aligned-right. Contains:
   - Empty text `Chat_NoRecipes` ("No recipes for this scope."/"No hay recetas para este ámbito."), shown when no suggestions.
   - List (`ListMeetingChatRecipes`, max height 240, item click): name (ellipsis) over prompt (caption, max 2 lines). A delete button (glyph U+E74D, `Chat_DeleteRecipe` "Delete recipe"/"Eliminar receta") is shown only for non-built-in recipes (`CanDelete`).
   - "New recipe" button (`Chat_CreateRecipe`, stretch).
   Clicking an item fills the draft with the prompt (does not send), closes the flyout, focuses the composer, puts the caret at the end. A flag suppresses re-opening the flyout from the resulting text change until the next dispatcher turn.
3. Slash filter: while the draft starts with `/`, the flyout opens automatically on each text change, filtered by `Draft[1..].Trim()`: case-insensitive (current culture) substring match against name OR prompt; an empty query shows all. When the draft does not start with `/` the flyout is hidden. Sending a draft that starts with `/` sends it literally; the slash text is never resolved to a recipe.
4. Opening the flyout from the button (not from slash) shows the full unfiltered list (`ShowAllRecipes`). A one-shot flag distinguishes slash-open from button-open (`MainPage.xaml.cs:149-158`).

Create recipe dialog (`MainPage.xaml.cs:206-266`): title `Chat_CreateRecipeTitle` "New recipe"/"Nueva receta"; fields: name (`Chat_RecipeName.Header` "Name"/"Nombre", placeholder "Recipe name"/"Nombre de la receta"), prompt (header "Prompt"/"Instrucción", placeholder "What should this recipe ask?"/"¿Qué debería preguntar esta receta?", multi-line, wrap, min height 80), radio group `Chat_RecipeAvailability.Header` ("Available for"/"Disponible para") with `Chat_RecipeSingle` ("This meeting"/"Esta reunión") at index 0 and `Chat_RecipeMultiple` ("Multiple meetings"/"Varias reuniones") at index 1. Default selection is index 1 when the current scope prefers multiple (Folder or AllMeetings) else index 0. Buttons: primary `Chat_CreateRecipePrimary` "Save"/"Guardar" (default), close `Chat_CreateRecipeCancel` "Cancel"/"Cancelar". The dialog refuses to close with Primary while the name or prompt is blank or whitespace. On save, `CreateRecipeAsync` trims both, silently returns if either is empty, saves a recipe with a new Guid, `CreatedAt = now (local offset)`, then refreshes the recipe lists.

Delete recipe dialog: title `Chat_DeleteRecipeTitle` "Delete recipe?"/"¿Eliminar receta?", content `Chat_DeleteRecipeContent` `Delete "{0}"? Built-in recipes stay.`/`¿Eliminar "{0}"? Las recetas integradas se conservan.`, primary "Delete"/"Eliminar", cancel "Cancel"/"Cancelar", default button Close. The name comes from the currently displayed suggestions. `DeleteRecipeAsync` is a no-op for built-in ids.

Errors from recipe operations show through `ShowSendError` ("Could not answer. {0}").

### 2.6 Threads: history, open, delete, new

- History flyout (320 px wide, top-edge-aligned-right). On opening it reloads threads (`ChatHistoryFlyout_Opening`; a failure shows the error bar). Empty text `Chat_HistoryEmpty` ("No chats yet."/"Todavía no hay chats."). List (`ListMeetingChatHistory`, max height 280, item click): title (ellipsis) over `UpdatedLabel`; a delete button (U+E74D, `Chat_DeleteThread` "Delete chat"/"Eliminar chat").
- Thread list shows every persisted thread regardless of current scope, ordered by `UpdatedAt` descending then `CreatedAt` descending then `Id` descending. Blank title shows `Chat_Untitled` ("Untitled chat"/"Chat sin título"). Updated label is `Chat_ThreadUpdated` ("Updated {0}"/"Actualizado {0}") with `UpdatedAt` converted to local time and formatted with .NET `"g"` in the current culture (short date plus short time).
- Opening a thread: closes the flyout, loads the thread by id, renders all its messages, expands the bar, scrolls the transcript to the end. If the thread is missing (deleted elsewhere): if it was the open thread, behave as New chat; refresh the list. Opening does not change the current scope.
- Mismatch banner: `ShowScopeMismatch = _openThread != null && decision.IsVisible && !MatchesOpenThread(_openThread, decision)`; recomputed after scope refresh (but not while sending), open, new chat, delete, and persist.
- Delete thread dialog: title `Chat_DeleteThreadTitle` "Delete chat?"/"¿Eliminar chat?", content `Chat_DeleteThreadContent` `Delete "{0}"? This cannot be undone.`/`¿Eliminar "{0}"? Esto no se puede deshacer.`, primary "Delete"/"Eliminar", cancel "Cancel"/"Cancelar", default button Close. On confirm, the thread is deleted; if it was open, the transcript is cleared and `_openThread = null`; the list is refreshed.
- New chat: `_openThread = null`, transcript cleared, `HasMessages = false`, draft cleared, error cleared, mismatch recomputed, bar expanded. The command has no `CanExecute`, so it is available during a send (see bug B1).
- Thread creation only happens at the first successful send; an empty "New chat" is never persisted.

### 2.7 Answer rendering, citations, links, copy

- Assistant text is rendered as Markdown. While streaming, the partial text is rendered live.
- Citation links have the form `[Title, readable date](https://meetinglive.local/meeting/<32-hex-id>)`. They use https because the Toolkit 7.1.2 Markdown parser only creates links for schemes in its allow-list, so a custom scheme would render as plain text (`odd/tasks/chat-ux.md` T7 deviation note). The host is never contacted.
- `ChatMarkdown_LinkClicked` (`MainPage.xaml.cs:337-364`):
  1. If the link parses as a meeting link (`TryParseMeetingLink`): look up the meeting; if not found, show `Chat_MeetingLinkMissing` ("That meeting no longer exists."/"Esa reunión ya no existe."); if found, `Workspace.SelectMeeting(id)` then `Workspace.OpenSession(Summary tab)`, which navigates the shell to the Session page on the Summary tab.
  2. Else if it is an absolute `http` or `https` URI, open it in the default browser (`Launcher.LaunchUriAsync`).
  3. Anything else is ignored silently.
  4. Any exception is shown through `ShowSendError`.
- Copy button copies the raw Markdown text (`item.Text`) as plain text to the clipboard. Blank text is ignored. Failure shows `Chat_CopyFailed` ("Could not copy. {0}"/"No se pudo copiar. {0}").
- Auto-scroll: when rows are added, the list scrolls to the last item at low dispatcher priority. For a pending (streaming) row, every change to its `Text` property schedules a layout update and scrolls the inner `ScrollViewer` to its full extent (because item scrolling stops at the top of a row taller than the viewport). The `ScrollViewer` is found once and cached.

### 2.8 Related meetings (Summary page)

- `SummaryPageViewModel.LoadRelatedMeetingsAsync` (`SummaryPageViewModel.cs:305-319`), called at the end of `LoadAsync`, loads all meetings, runs `RelatedMeetings.Find(currentRecord, all)`, keeps the first 5 (`MaxRelatedMeetings = 5`), and maps each to `RelatedMeetingItem { Id, Title, DateLabel }`. `DateLabel` is `RecordedAt.LocalDateTime.ToString("g", CurrentCulture)`.
- UI (`SummaryPage.xaml:119-147`): section hidden when empty; caption heading `SummaryPage_RelatedMeetings` ("Related meetings"/"Reuniones relacionadas"); horizontal scrolling list (`ListRelatedMeetings`), each item title (ellipsis, max width 220) over date caption; item click executes `OpenRelatedMeetingCommand(id)` which selects the meeting and opens the Session page on the Summary tab.
- The list is computed once per `LoadAsync`; it is not refreshed on meeting changes or deletions.

### 2.9 Library snippet (History page)

- Each library meeting row shows one line (`MaxLines=1`, ellipsis) from `HistoryPage.Snippet(summary, transcript)` (`HistoryPage.xaml.cs:322-326`) = `MeetingSnippet.From(summary, transcript)`, or `History_NoContent` ("No content yet"; es string exists in resw) when the result is empty. Algorithm in 3.9.
- `HistoryPage.FoldersToggleLabel()` reuses `Chat_ScopeFolder` ("Folder") as the label of the folders toggle (`HistoryPage.xaml.cs:295`). This is a cross-module string reuse; the porter must keep the key available to the Library module.

### 2.10 Pre-meeting brief

Prompt construction and normalization live in this module (3.10). The lifecycle lives in `RecordingPageViewModel.cs:858-892, 1046-1122` (Record page "Coming up"):

1. Opening a calendar event ("Coming up" item) while not recording or processing: look up an existing saved meeting for the event id (`CalendarMeetingMatch.FindByEventId`: exact ordinal match of `CalendarEventId`, newest `RecordedAt` wins, blank id returns none), clear `MeetingBrief` and `BriefError`, increment `_briefGeneration`, optionally auto-start capture if the event is starting, then fire `GenerateBriefAsync` without awaiting.
2. `GenerateBriefAsync`: build a probe record (the existing meeting, or a synthetic one with title = trimmed subject or the current `MeetingTitle`, `RecordedAt` = event start, `SeriesId` = event series id). `related = RelatedMeetings.Find(probe, allMeetings)`. If `!HasUsefulContext(related, event.Details, event.AttendeeDisplayNames)` return silently with no model call and no provider setup prompt. If the generation counter changed, return. Resolve the provider with the same gate delegates as chat; null means return silently. Build the prompt, call `CompletePromptAsync` (non-streaming, no cancellation token) on a background task.
3. On provider exception: if the generation is stale return, else set `BriefError = RecordPage_BriefFailedFormat` formatted with `CliFailureUserMessage.Format(ex)` ("The note is open. The brief could not be prepared: {0}"/"La nota está abierta. No se pudo preparar el informe: {0}").
4. On success: `Normalize(raw)`; null means show nothing. Otherwise set `MeetingBrief`. If an existing meeting was linked, set `existing.Brief = brief` and save; a save failure sets `BriefError` the same way.
5. The brief is displayed when `_comingUpNoteOpen && !IsProcessing && MeetingBrief` is non-blank (`RecordingPageViewModel.cs:260-261`) in `RecordingPage.xaml:117-127`: heading `RecordPage_BriefHeading` ("Brief"/"Informe previo", automation "Pre-meeting brief"/"Informe previo a la reunión") above a plain selectable `TextBlock` (`TxtMeetingBrief`). It is not Markdown-rendered (bug B13). Error bar: `RecordPage_BriefFailed` title "Could not prepare the brief"/"No se pudo preparar el informe", automation "Brief error"/"Error del informe", id `InfoBriefError`.
6. Resetting the linked note (`:1005-1016`) increments the generation and clears brief and error, which discards any in-flight result.
7. When a recording completes, `BlankToNull(MeetingBrief)` is passed into the pipeline (`RecordingPageViewModel.PipelineRun.cs:81`) so the brief is saved with the meeting (`MeetingRecord.Brief`, section `## Brief`). The brief is also passed to live answers through `LiveAnswerWebPolicy.BuildSessionContext(MeetingTitle, MeetingBrief)` (`RecordingPageViewModel.cs:614`). Both belong to the Record module.

## 3. Domain rules

### 3.1 Models

`ChatScopeKind` (enum, names are the wire values): `AllMeetings`, `Folder`, `Meeting`, `Live`.

`ChatMessage`: `Id` Guid, `Role` string (`"user"` or `"assistant"`), `Text` string, `CreatedAt` DateTimeOffset. All required.

`ChatThread`: `Id`, `Title`, `CreatedAt`, `UpdatedAt`, `ScopeKind` (all required), `FolderId` Guid?, `MeetingId` Guid?, `Messages` list (default empty).

`ChatRecipe`: `Id`, `Name`, `Prompt`, `Availability` (`"single"` or `"multiple"`), `CreatedAt`. All required.

### 3.2 Scope resolution (`ChatScopeResolver.cs`)

Surface parsing by shell tag, exact and case-sensitive: `"Recording"`, `"History"`, `"Settings"`, `"Session"`; anything else (including null) is `Unknown`.

`Resolve(surface, isCaptureActive, selectedFolderId, selectedMeetingId)` evaluates in this order, first match wins:

1. surface is Settings: `(IsVisible=false, AllMeetings, null, null)`. Applies even when capture is active.
2. `isCaptureActive`: `(true, Live, null, null)`. Applies on every other surface and ignores any open meeting.
3. surface is Session and meeting id is set: `(true, Meeting, null, meetingId)`.
4. surface is History and folder id is set: `(true, Folder, folderId, null)`.
5. otherwise: `(true, AllMeetings, null, null)`. This includes History with the Inbox (null folder), Recording idle, Session without a meeting, and Unknown.

`MatchesOpenThread(thread, decision)`: `thread.ScopeKind == decision.Kind && thread.FolderId == decision.FolderId && thread.MeetingId == decision.MeetingId` (nullable equality; null equals null). A mismatch never edits the thread; the next send creates a new thread.

Workspace inputs (`MeetingLive.App/Services/WorkspaceService.cs`), published by other modules:

- `CurrentShellTag` set on every shell navigation (`MainPage.xaml.cs:588`); default `Recording`; only the four valid tags are accepted (throws otherwise). Raises `ScopeChanged` when it changes.
- `SelectedFolderId`: `PublishSelectedFolder` is called by `HistoryPageViewModel.ApplySelection` (`:277`, every folder selection including Inbox as null) and after a folder delete (`:206`). Raises `ScopeChanged` unconditionally.
- `SelectedMeetingId`: `SelectMeeting`, `ClearSelection`, `NotifyDeleted`, `SetLastProcessed`. Raises `ScopeChanged` only when the value changes.
- `IsCaptureActive`: set by Record as `IsRecording || IsProcessing` (`RecordingPageViewModel.cs:1645, 1733`). Raises `ScopeChanged` only on change.
- `LiveTranscript`: set via `PublishLiveTranscript` whenever `LiveTranscriptText` changes or capture state changes. Transcript text updates do not raise `ScopeChanged` (the chat reads the latest value at send time).

On every `ScopeChanged` the chat view model runs `RefreshScopeAsync` (async-void handler that catches and shows errors): increments a generation counter, resolves the decision, builds the label (repository lookups), reloads the TypeSafe availability, and if a newer refresh started in the meantime discards this result. Then it commits the decision, visibility, collapse-on-change, label, glyph, change notifications, mismatch (unless sending), recipe lists, and refreshes the Send command.

### 3.3 Context packing (`ChatContextPacker.cs`)

This is the only meeting text the model sees. It never reads `JevAnalysis`, `AudioFilePath`, `SourcePath`, calendar fields, attendees, `Brief`, `FollowUp`, `ProjectPlan`, or `Transcript` outside Live and Meeting scopes.

Constants: `LiveTranscriptMaxChars=2500`, `MeetingTranscriptMaxChars=6000`, `SummaryMaxChars=800`, `NotesMaxChars=400`, `MeetingCap=12`.

Helpers:

- `Tail(value, n)`: null if blank; else the value if `Length <= n`; else the last `n` characters (no trimming, may start mid-word).
- `CapPrefix(value, n)`: `"(none)"` if blank; else the value if `Length <= n`; else the first `n` characters (no ellipsis).
- Messages (CoreStrings, en / es):

| Key | en | es |
| --- | --- | --- |
| `ChatLiveTranscriptEmpty` | The live transcript is empty. | La transcripción en vivo está vacía. |
| `ChatMeetingNotFound` | The meeting was not found. | No se encontró la reunión. |
| `ChatTranscriptEmpty` | The transcript is empty. | La transcripción está vacía. |
| `ChatFolderNotSelected` | No folder was selected. | No se seleccionó ninguna carpeta. |
| `ChatFolderNotFound` | The folder was not found. | No se encontró la carpeta. |
| `ChatNoMeetingsInFolder` | No meetings in this folder. | No hay reuniones en esta carpeta. |
| `ChatNoMeetingsSaved` | No meetings are saved. | No hay reuniones guardadas. |

`Pack(scopeKind, folderId, meetingId, liveTranscript, meetings, folders)`; `meetings` and `folders` must be non-null (throws `ArgumentNullException`); unknown scope throws `ArgumentOutOfRangeException`.

**Live**: if `liveTranscript` is blank, return `ChatLiveTranscriptEmpty`. Else return `"Live transcript:" + NL + Tail(liveTranscript, 2500)`. Saved meetings are never consulted.

**Meeting**: find the meeting whose `Id == meetingId`; if `meetingId` is null or not found return `ChatMeetingNotFound`. Otherwise build the shared block (below) with Summary and Notes uncapped, then the transcript section, and return the result with trailing whitespace trimmed. Transcript section: `Tail(Transcript, 6000)`; if null append `ChatTranscriptEmpty` + NL, else `"Transcript:" + NL + tail + NL`.

**Folder** and **AllMeetings** (`PackMany`):

1. Header. Folder scope: if `folderId` is null return `ChatFolderNotSelected` (nothing else). Else if the folder id is not in `folders`, append `ChatFolderNotFound` + NL; if found append `"Folder: {Name}" + NL + "Note: {Note or "(none)" if blank}" + NL`. AllMeetings: append `"All meetings:" + NL`.
2. Matching meetings: AllMeetings uses all meetings (the `folderId` argument is ignored). Folder uses meetings with `FolderId == folderId` exactly; sub-folder meetings are NOT included; null `folderId` matches none.
3. Order by `RecordedAt` descending, then `Id` descending (Guid ordering, which for the lowercase `D` hex string is the same as ordinal string comparison; reasoned, not tested), take the first 12.
4. If none selected: append `ChatNoMeetingsInFolder` (Folder) or `ChatNoMeetingsSaved` (All), return trimmed.
5. If `selected.Count < matching.Count`: append `"Showing the 12 most recent of {matching.Count} meetings. Older meetings were omitted." + NL`. (The prompt tells the model not to mention counts unless asked.)
6. For each selected meeting, with a blank line (`NL`) before every block except the first, append the shared block with `Summary` capped at 800 and `Notes` capped at 400. Transcripts are never included.
7. Return trimmed.

**Shared block** (`AppendSharedFields`), one field per line, in this order:

```
Id: <meeting.Id as 32 lowercase hex digits, no hyphens>
Title: <meeting.Title, verbatim>
Recorded: <RecordedAt converted to the machine's local time, formatted yyyy-MM-dd HH:mm, invariant culture>
Summary: <CapPrefix(Summary)>
Action items:
- [ ] <text>          (or "- [x] <text>" when done)
(none)                (instead of the list when there are no non-blank items)
Notes: <CapPrefix(Notes)>
```

Action item rules: items that are null or have blank text are dropped; remaining text has line endings replaced by a single space (`ReplaceLineEndings(" ")`); order preserved; no cap on count or length. Summary and Notes are multi-line Markdown and are inserted raw after the label (a multi-line value spans several lines of the context). The ISO "O" timestamp is deliberately not used (a past bug made the model quote it).

### 3.4 Prompt (`ChatPromptBuilder.cs`)

Constants: `MaxPriorMessages=8`, `MaxPriorMessageChars=1500`, `MeetingLinkPrefix="https://meetinglive.local/meeting/"`, `RewriteNotesInstruction="Rewrite the notes from the packed meeting and return the rewritten notes as markdown. Do not save the file."`.

`ScopeLabel`: AllMeetings "All meetings", Folder "Folder", Meeting "Meeting", Live "Live" (English only, never localized).

`MeetingLink(id)` = prefix + `id` as 32 lowercase hex (`"N"`). `TryParseMeetingLink(link, out id)`: false for null; false unless the link starts with the prefix (ordinal, case-insensitive); strip all trailing `/` from the remainder; `Guid.TryParse` of the remainder (this accepts 32-hex, hyphenated, braced, and parenthesized forms; it rejects the remainder if it has a query string, fragment, or extra path segment). On failure `id` is `Guid.Empty`.

`Build(scopeKind, packedContext, priorMessages, userMessage)` (all non-null) produces exactly this, line by line (each line ends with NL; `{...}` are substitutions):

```
Answer only from the packed context.
If the context does not contain the answer, say so.
Do not invent quotes, decisions, or attendees.
Drafts (email, Slack, or spec) are drafts. Never claim something was sent.
Answer in Markdown.
Refer to meetings by title and a readable date (for example, "Sprint review on Sep 1").
Do not mention how many meetings were included or omitted unless the user asks.
When you refer to a meeting, cite it as a Markdown link: [Title, readable date](https://meetinglive.local/meeting/<Id>), using the meeting's Id from the context.
Only cite Ids that appear in the context. Never write a raw Id outside a link.
Scope: {ScopeLabel}
                                                  <- blank line, then the next line, ONLY when rewrite applies
Rewrite the notes from the packed meeting and return the rewritten notes as markdown. Do not save the file.
                                                  <- blank line
# Context
{packedContext}
                                                  <- blank line
# Prior turns
{prior turns, or "(none)"}
                                                  <- blank line
# User message
{userMessage}                                     <- no trailing newline
```

Rewrite rule: the two lines (blank line plus instruction) are inserted after the `Scope:` line iff `scopeKind == Meeting` and `userMessage` contains the substring `rewrite` (case-insensitive, any position, so "rewrites" matches and "Rewritten" does not).

Prior turns: if `priorMessages` is empty, the line `(none)`. Otherwise take the last 8 messages (not turns; 4 exchanges), oldest first; each as `"{Role}: {Text}"` where `Role` is the raw role string (`user` / `assistant`), `Text` is `message.Text ?? ""` truncated to its first 1500 characters (no ellipsis); each line ends with NL. A null element throws.

Nothing in the prompt specifies an output language; the model follows the user's language.

### 3.5 Streaming (`MeetingChatViewModel.StreamAnswerAsync`, `:662-693`)

- Provider contract: `ISummaryProvider.StreamPromptAsync(prompt, ct)` yields text chunks; concatenation is the answer. Default implementation yields the whole `CompletePromptAsync` result as a single chunk. Real streaming: local LLamaSharp (token stream) and xAI (SSE with `stream: true`). The Claude Code CLI and Codex CLI providers use the single-chunk fallback.
- Provider limits that shape chat behavior: local model context window is 4096 tokens (`LocalLlmSummaryMapReduce.ContextTokens`), max output 512 tokens, temperature 0.2 (`LocalLlmSummaryProvider.cs:62-63,130`).
- Buffering: append each chunk to a buffer. Ignore pushing until at least one non-whitespace chunk has arrived. Push the buffer (leading whitespace trimmed) to the pending row on the first visible chunk, then at most once every 80 ms (`StreamFlushInterval`), then once more at the end if the last push did not include everything. Pushes are enqueued on the UI dispatcher in order.
- The task runs on the thread pool; the full buffer is returned and trimmed by the caller.

### 3.6 Thread rules

- Title: `ChatThreadTitle.FromFirstMessage(userMessage)` = `Trim()`, replace every line ending sequence with a single space, and if longer than 60 truncate to the first 60 characters then `TrimEnd()`. The view model substitutes `Chat_Untitled` if the result is empty, which cannot happen because the message is non-blank. The title is set once on creation and never changes.
- New thread on first successful send, or when the open thread does not match the scope: `Id` new Guid, `CreatedAt = UpdatedAt = now (local offset)`, scope fields copied from the decision at the time the send started.
- Appending: user message then assistant message, both with the same `CreatedAt = now`, new Guids, assistant text trimmed. `UpdatedAt = now`. Save the whole thread (upsert by id). On save failure, restore `open.Messages` to the pre-send snapshot and rethrow (the `UpdatedAt` assignment is not rolled back; see B6).
- Messages are never edited or individually deleted. Threads are never auto-pruned and never auto-deleted when their meeting or folder is deleted.

### 3.7 Recipes

Built-ins (`ChatRecipeCatalog`; fixed ids, fixed `CreatedAt` 2026-09-21T00:00:00Z; code only, never written to disk; names are localized from CoreStrings, prompts are English constants):

| Id | Availability | Name key (en / es) | Prompt (verbatim) |
| --- | --- | --- | --- |
| `11111111-1111-4111-8111-111111111101` | single | `RecipeDiscussedName` "What's been discussed" / "Qué se ha hablado" | `Give a short recap of what has been discussed so far.` |
| `…111102` | single | `RecipeActionItemsName` "Action items" / "Tareas pendientes" | `Extract owners and next steps. If the owner is not in the context, say unassigned.` |
| `…111103` | single | `RecipeFollowUpEmailName` "Follow-up email" / "Correo de seguimiento" | `Draft a concise follow-up email. Do not send it.` |
| `…111104` | single | `RecipeNextStepsName` "What should I do next" / "Qué debo hacer a continuación" | `List my next steps from this meeting.` |
| `…111105` | single | `RecipeProjectPlanName` "Project plan" / "Plan de proyecto" | `Draft a short project plan from this meeting: outcome, steps, owners, open questions. Do not invent owners.` |
| `11111111-1111-4111-8111-111111111201` | multiple | `RecipeFeatureRequestsName` "Top feature requests" / "Principales solicitudes de funciones" | `Group product feedback into themes.` |
| `…111202` | multiple | `RecipeRecurringThemesName` "Recurring themes" / "Temas recurrentes" | `Identify patterns across the packed meetings.` |
| `…111203` | multiple | `RecipeWeeklyUpdateName` "Weekly update" / "Actualización semanal" | `Write bullets of decisions, blockers, and next steps. Draft only. Do not send it.` |

Full ids: the single recipes are `11111111-1111-4111-8111-111111111101` through `…111105`; the multiple recipes are `11111111-1111-4111-8111-111111111201`, `…111202`, `…111203`. The list order is exactly the table order.

`ChatRecipeList`:

- `AvailabilityFor(kind)`: Meeting, Live → `"single"`; Folder, AllMeetings → `"multiple"`; else throws.
- `IsBuiltIn(id)`: id is in the built-in set.
- `ForScope(kind, userRecipes)`: built-ins whose availability equals the scope's (ordinal), in catalog order; then user recipes in file order whose availability equals the scope's (ordinal, case-sensitive), skipping null entries and skipping any whose id equals a built-in id of THIS scope's built-ins only. A user row that reuses a built-in id from the other availability is not filtered (see B9). Built-in instances are never mutated.

### 3.8 Persistence timings and caps summary

| Item | Value |
| --- | --- |
| Live transcript tail | 2500 chars |
| Meeting transcript tail | 6000 chars |
| Summary cap (multi) | 800 chars |
| Notes cap (multi) | 400 chars |
| Meetings in multi packs | 12 |
| Prior messages | 8 |
| Prior message chars | 1500 |
| Thread title | 60 chars |
| Starter chips | 4 |
| Stream UI flush | 80 ms |
| Related meetings shown | 5 |
| Brief prior meetings | 3 |
| Snippet length | 140 |
| Transcript list max height | 420 |
| Composer height | 32 to 96 |

### 3.9 Snippet algorithm (`MeetingSnippet.cs`)

`From(summary, transcript)`: if `summary` is not blank, `FromMarkdown(summary)`; else `FromMarkdown(TranscriptBody(transcript))`.

`TranscriptBody`: split the transcript on `\r\n`, `\n`, or `\r` (keeping empty lines); drop a line that, after trimming leading whitespace, starts with `"Recorded "` or `"Ended "`; for each remaining line take `ExtractBody`: if the line starts with `[` and has a `]` at index >= 2 and the bracket content is a valid range `A-B` where each side is `mm:ss.cc` (minutes: integer of at least 2 digits; colon index >= 2; seconds exactly 2 digits and <= 59; a `.` exactly 3 characters after the colon; exactly 2 hundredths digits), then take the text after `]`, remove a leading `" [ Speaker-<digits> ]"` tag if present (exact form: space, `[`, space, `Speaker-`, one or more ASCII digits, space, `]`), and trim. Otherwise the whole line trimmed. Skip lines whose body is empty. Join the bodies with `\n`. Transcript line format is `[mm:ss.cc-mm:ss.cc] [ Speaker-N ] text`, or `[mm:ss.cc-mm:ss.cc] text` when there is no speaker (`TranscriptStampFormatter.FormatLine`).

`FromMarkdown(markdown)`: blank gives `""`. Normalize `\r\n` and `\r` to `\n`. For each line: `isHeading` = trimmed line starts with 1 to 6 `#` followed by whitespace or end of line (7 or more `#`, or `#` followed by a non-space, is not a heading). `StripMarkers`: trim; if heading remove the `#` run and following whitespace; then delete, in this order, the substrings ```` ``` ````, `**`, `__`, `` ` ``, `*`, `_` everywhere in the line (so underscores and asterisks inside words are removed too); trim. Skip empty results. Heading lines go into a "headings" buffer and other lines into a "body" buffer, each joined by a single space. Use the body buffer if non-empty, else the headings buffer. Collapse every run of whitespace (`char.IsWhiteSpace`) into one space and trim. If the result is longer than 140, return the first 140 characters plus `…` (U+2026, not trimmed again); otherwise return it.

### 3.10 Related meetings and brief prompt

`RelatedMeetings.Find(current, candidates)`: `seriesId` = `current.SeriesId` trimmed or null if blank; `title` = `current.Title` trimmed (empty if null). Candidate qualifies if `candidate.Id != current.Id` AND (`seriesId` is non-null and equals the candidate's trimmed non-null series id, ordinal; OR trimmed `title` equals the candidate's trimmed title, ordinal, case-sensitive). Result ordered by `RecordedAt` descending (stable for ties). A blank series never matches a blank series. Two empty titles do match each other (B11).

`MeetingBriefPromptBuilder`:

- `MaxPriorMeetings = 3`.
- `HasUsefulContext(prior, agenda, attendees)`: true if `prior.Count > 0`, or agenda is not blank, or any attendee is not blank; else false. `prior` must be non-null.
- `Normalize(raw)`: null if blank; else `raw.Trim()`, but null when it equals `NONE` ignoring case (exactly, after trimming).
- `Build(subject, attendees, agenda, prior)`: the template below. `attendeeBlock` = trimmed non-blank names joined by `", "`, or `(none)`. `agendaBlock` = `agenda.Trim()` or `(none)`. `priorBlock` = the first 3 prior meetings, each formatted below, joined by `"\n\n"`, or `(none)`. `<subject>` holds `subject.Trim()` or empty when null. The raw-string literal's own line breaks are `\r\n` in the source file (CRLF), while the joins inside `priorBlock` are `\n`.

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
{attendeeBlock}
</attendees>
<agenda>
{agendaBlock}
</agenda>
<prior_meetings>
{priorBlock}
</prior_meetings>
```

Each prior meeting block:

```
<meeting title="{Title raw}">
<summary>
{Summary trimmed, or (none)}
</summary>
<notes>
{Notes trimmed, or (none)}
</notes>
<action_items>
{ActionItems[].Text joined by "; ", or (none) when the list is empty}
</action_items>
</meeting>
```

Prior meetings arrive newest first (from `RelatedMeetings.Find`). The caller passes all related meetings; `Build` itself takes only the first 3. Done flags and transcripts are not included.

## 4. Persistence and wire formats

### 4.1 Files

| File | Path (Windows) | Content |
| --- | --- | --- |
| Chat threads | `%LOCALAPPDATA%\MeetingLive\chat-threads.json` (`AppPaths.ChatThreadsFilePath`) | JSON array of threads |
| User recipes | `%LOCALAPPDATA%\MeetingLive\chat-recipes.json` (`AppPaths.ChatRecipesFilePath`) | JSON array of recipes |

These are app data, not part of the Documents library. Constructors accept a path override (tests use it).

Serialization (`System.Text.Json`, `JsonSerializerDefaults.Web`, indented): property names are camelCase; nulls are written as `null`; Guids as hyphenated lowercase (`D`); `DateTimeOffset` as ISO-8601 with offset and up to 7 fractional digits (trailing zeros dropped), e.g. `2026-09-21T10:15:30.1234567-05:00`; `scopeKind` is written as the enum name (`"AllMeetings"`, `"Folder"`, `"Meeting"`, `"Live"`, PascalCase) via `JsonStringEnumConverter` with no naming policy (reading also accepts integers and is case-insensitive); property-name matching on read is case-insensitive. UTF-8 without BOM, 2-space indentation. Recipes use the same options without the enum converter.

Thread file example:

```json
[
  {
    "id": "5f0b1c2e-3a4d-4e6f-9a1b-2c3d4e5f6a7b",
    "title": "What did we decide about the launch date?",
    "createdAt": "2026-09-21T10:15:30.1234567-05:00",
    "updatedAt": "2026-09-21T10:16:02.5-05:00",
    "scopeKind": "Meeting",
    "folderId": null,
    "meetingId": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    "messages": [
      {
        "id": "a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5",
        "role": "user",
        "text": "What did we decide about the launch date?",
        "createdAt": "2026-09-21T10:16:02.5-05:00"
      },
      {
        "id": "f6f6f6f6-a7a7-4b8b-9c9c-d0d0d0d0d0d0",
        "role": "assistant",
        "text": "We agreed to ship on [Launch sync, Sep 18](https://meetinglive.local/meeting/0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d).",
        "createdAt": "2026-09-21T10:16:02.5-05:00"
      }
    ]
  }
]
```

Recipe file example:

```json
[
  {
    "id": "c0c0c0c0-d1d1-4e2e-8f3f-a4a4a4a4a4a4",
    "name": "My follow-up",
    "prompt": "Draft a follow-up for the client.",
    "availability": "single",
    "createdAt": "2026-09-22T09:00:00-05:00"
  }
]
```

Read rules:

- Missing file gives an empty list. Empty JSON `null` gives an empty list. A thread whose `messages` is null/missing gets an empty list. Entries missing any `required` member (id, title, createdAt, updatedAt, scopeKind for threads; all five for recipes; id, role, text, createdAt for messages) throw `JsonException`. Malformed or empty (0-byte) files throw. No recovery, backup, or quarantine exists (B3).
- `GetAllAsync` (threads): sorts by `updatedAt` desc, then `createdAt` desc, then `id` desc. `GetByIdAsync` loads and sorts everything, then filters. Recipes: file order.
- `SaveAsync`: read all, replace the entry with the same id in place or append, rewrite the whole file. `DeleteAsync`: read all, remove by id; if nothing was removed, do not write the file (and do not create it). Directory is created on first write.
- Concurrency: an in-process `SemaphoreSlim(1,1)` per repository instance serializes all operations, including reads. There is no cross-process lock. Write is `File.Create` (truncate) then stream the JSON: not atomic (B2).

### 4.2 Link wire format

Citation URL: `https://meetinglive.local/meeting/` + 32 lowercase hex digits (no hyphens). Parsing details in 3.4.

### 4.3 Prompt and context wire formats

Section 3.3 (context) and 3.4 (prompt) are the wire formats to the model. The provider receives one string; there is no system/user split.

### 4.4 Meeting record fields consumed

Read-only inputs from `MeetingRecord`: `Id`, `Title`, `RecordedAt`, `Summary`, `Notes`, `ActionItems[{Text, IsDone}]`, `Transcript`, `FolderId`, `SeriesId`. From `FolderRecord`: `Id`, `Name`, `Note`. Brief additionally reads `Summary`, `Notes`, `ActionItems[].Text`, and writes `MeetingRecord.Brief`. Meeting Markdown persistence belongs to another module.

## 5. Native and OS dependencies

| Dependency | Where | Class |
| --- | --- | --- |
| Paths under `%LOCALAPPDATA%\MeetingLive` | `AppPaths.cs:11-12,45,48` | Portable behind a "user data dir" abstraction (Electron `app.getPath('userData')` or an explicit Windows/macOS mapping). Existing users' files must be read from the old location or migrated. |
| Local time conversion (`ToLocalTime`) in packed context and labels | `ChatContextPacker.cs:162` | Portable (use the system time zone). |
| Culture formatting (`"g"` format, current culture) | `MeetingChatViewModel.cs:260`, `RelatedMeetingItem.cs:20`, `HistoryPage.xaml.cs:320` | Portable with `Intl.DateTimeFormat` using the UI locale (short date plus short time). Not byte-identical. |
| Clipboard | `MeetingChatViewModel.cs:366-369` (`Windows.ApplicationModel.DataTransfer`) | Windows-only API; Electron `clipboard.writeText` is portable. |
| Launching http/https links in the default browser | `MainPage.xaml.cs:357` (`Windows.System.Launcher`) | Windows-only API; Electron `shell.openExternal` is portable. Keep the https/http allow-list. |
| UI dispatcher marshalling (`DispatcherQueue`) | `MeetingChatViewModel.cs:690-719` | Windows/WinUI-only; replaced by the renderer event loop and IPC. |
| WinUI controls: `Expander`, `ListView`, `ContentDialog`, `InfoBar`, `RadioButtons`, `MarkdownTextBlock` (CommunityToolkit 7.1.2), `WrapPanel` | `MainPage.xaml` | Windows-only; the port needs a Markdown renderer with a link hook and a sanitizer (no raw HTML), plus equivalents. |
| Keyboard state API for Shift (`InputKeyboardSource`) | `MainPage.xaml.cs:102` | Windows-only; use `KeyboardEvent.shiftKey`. |
| Summary providers: LLamaSharp local GGUF (4096-token context, 512 output tokens), Claude Code CLI, Codex CLI, xAI HTTP (SSE streaming) | `ISummaryProvider`, `SummaryProviderResolver` | Provider layer belongs to another module. Chat requires only `streamPrompt(prompt): AsyncIterable<string>` and a one-shot fallback. Local inference and CLI process launching are the native parts. |
| DPAPI-protected TypeSafe credentials (`AppServices.TypeSafeCredentials.Load()`) | `MeetingChatViewModel.cs:426` | Windows-only (DPAPI); portable behind a secrets interface (Electron `safeStorage`). Chat only needs the boolean "ApiKey present". |
| `x:Uid` / `.resw` localization | all XAML | Windows-only mechanism; the strings listed in 2 are portable data. |
| Resource-based `CoreStrings` using `CurrentUICulture` | `CoreStrings.cs` | Portable behind a string table; built-in recipe names resolve once (B8). |

Everything in Section 3 (packing, prompt, snippet, related, brief, resolver, title, recipe list) is pure logic and fully portable.

## 6. Existing test coverage (MeetingLive.Core.Tests/Services)

All cases must be ported as tests of the new implementation. Names are the C# test method names.

`ChatContextPackerTests`: `Pack_LiveScope_UsesLiveTailAndIgnoresSavedTranscript`; `Pack_LiveScope_WhenLiveTextEmpty_SaysEmptyAndIgnoresSavedTranscript` (null and whitespace); `Pack_FolderScope_DoesNotContainTranscriptBodies`; `Pack_FolderScope_CapsAtTwelveMostRecent` (13 meetings, newest 12 kept, oldest dropped, order newest first); `Pack_FolderScope_MatchesExactFolderIdOnly` (parent folder excludes child, other, and inbox meetings); `Pack_FolderScope_TruncatesSummaryAndNotes` (800 and 400 prefixes); `Pack_MeetingScope_IncludesTranscriptTailNotHead` (6000); `Pack_MeetingScope_IncludesMeetingIdForCitations` and the full-block case (title, `yyyy-MM-dd HH:mm` local date, no ISO "O" string, summary, action items, notes, transcript tail); `Pack_AllMeetings_IncludesEachMeetingId`; `Pack_MeetingScope_WhenMissing_SaysNotFound` (other meetings' content not leaked); `Pack_MeetingScope_OmitsJevAnalysisAndAudioPath` (also folder id not leaked); `Pack_AllMeetings_CapsAtTwelveAndOmitsTranscripts`.

`ChatPromptBuilderTests`: `Build_AnyScope_TellsModelNotToInvent` (all four instruction lines, scope label, context, user message, no rewrite instruction); `Build_AnyScope_AsksToCiteMeetingsAsLinksUsingContextIdsOnly`; `MeetingLink_RoundTripsThroughTryParseMeetingLink`; `TryParseMeetingLink_RejectsOtherLinks` (null, empty, other host, `not-a-guid`, other path); `Build_AnyScope_AsksForMarkdownAndReadableMeetingReferences`; `Build_WhenMessageContainsRewrite_AddsInstructionOnlyForMeetingScope` (all scopes; "rewrites" matches; "Rewritten" does not; no keyword no instruction); `Build_PriorTurns_KeepsLastEightAndCapsText` (9 messages, last 8 kept, 1500 cap).

`ChatRecipeCatalogTests`: `BuiltIns_ListsSingleAndMultipleRecipes` (names via CoreStrings, order, availability split 5/3, unique ids, prompt keyword assertions).

`ChatRecipeListTests`: `AvailabilityFor_MatchesScope`; `ForScope_Meeting_ReturnsSingleBuiltInsThenUserRecipes`; `ForScope_WhenUserIdCollidesWithBuiltIn_SkipsUserRow`; `ForScope_DoesNotMutateBuiltInInstances`.

`ChatScopeResolverTests`: `Resolve_Settings_HidesChatEvenWhenCaptureIsActive`; `Resolve_WhenCaptureActive_IsLiveAndIgnoresOpenMeetingId`; `Resolve_SessionWithMeeting_IsThatMeeting`; `Resolve_HistoryWithFolder_IsExactFolder`; `Resolve_HistoryInbox_IsAllMeetings`; `Resolve_RecordingIdle_IsAllMeetings`; `Resolve_SessionWithoutMeeting_IsAllMeetings`; `ParseSurface_MapsShellTags`; `MatchesOpenThread_WhenScopeIdsDiffer_IsFalse`; `MatchesOpenThread_WhenScopeIdsMatch_IsTrue`.

`ChatThreadTitleTests`: `FromFirstMessage_TrimsAndCapsAtSixtyCharacters`; `FromFirstMessage_CollapsesLineBreaks` ("First line second").

`JsonChatThreadRepositoryTests`: `SaveAsync_ThenGetByIdAsync_RoundtripsThreadWithTwoMessages`; `DeleteAsync_ExistingThread_RemovesIt`; `DeleteAsync_MissingId_DoesNotThrow` (file not created); `SaveAsync_WithPathOverride_DoesNotWriteToAppPaths`; `GetAllAsync_WhenUpdatedAtDiffers_ReturnsNewestFirst`; `SaveAsync_ExistingId_ReplacesThread`; `GetAllAsync_WhenFileMissing_ReturnsEmpty`.

`JsonChatRecipeRepositoryTests`: `SaveAsync_ThenGetAllAsync_RoundtripsRecipe`; `DeleteAsync_ExistingRecipe_RemovesIt`; `DeleteAsync_MissingId_DoesNotThrow`; `SaveAsync_WithPathOverride_DoesNotWriteToAppPaths`; `SaveAsync_ExistingId_ReplacesRecipe`.

`MeetingBriefPromptBuilderTests`: `HasUsefulContext_WhenNoPriorMeetingAgendaOrAttendees_IsFalse`; `HasUsefulContext_WhenAgendaPresent_IsTrue` (theory: "Review the API", "  agenda  "); `HasUsefulContext_WhenAttendeePresent_IsTrue` (blank agenda, one attendee); `HasUsefulContext_WhenPriorMeetingPresent_IsTrue` (null agenda and attendees); `Build_IncludesSubjectAttendeesAgendaAndPriorSources_WithoutInventingMail` (no `@`, no `mailto:`); `Build_CapsPriorMeetingsAtThree`; `Normalize_WhenEmptyOrNone_ReturnsNull` (theory: null, empty, spaces, NONE, none).

`MeetingSnippetTests`: `From_WhenSummaryPresent_PrefersSummaryOverTranscript`; `From_WhenSummaryMissing_UsesTranscript`; `From_WhenBothEmpty_ReturnsEmpty`; `FromMarkdown_StripsAtxHeadingsEmphasisAndBackticks`; `FromMarkdown_WhenOnlyHeadings_KeepsHeadingText`; `From_WhenSummaryMissing_DropsTranscriptHeadersStampsAndSpeakerTags`; `From_WhenTranscriptHasOnlyHeaders_ReturnsEmpty`; `FromMarkdown_CollapsesWhitespace`; `FromMarkdown_TruncatesToMaxLengthWithEllipsis`; `FromMarkdown_LeavesShortPlainTextUnchanged`.

`RelatedMeetingsTests`: `Find_SharedSeriesId_ReturnsOtherMeetingsNewestFirst`; `Find_ExactTrimmedTitle_MatchesWithoutSeries` (case-sensitive, trim); `Find_EmptySeriesId_DoesNotMatchOtherEmptySeries`; `FindByEventId_SameCalendarEvent_ReturnsNewestAndIgnoresBlankIds` (this one tests `CalendarMeetingMatch`, which belongs to the calendar module but ships in this test class).

Not covered by any test: `MeetingChatViewModel` (send, optimistic rollback, scope refresh, recipe filtering, thread open/delete), `ChatComposerItems`, `RelatedMeetingItem`, `HistoryPage.Snippet` fallback, the corrupt-file and required-member read paths, surrogate-pair truncation, the Markdown link handler, and the Record-page brief lifecycle. The UI automation ids listed in section 2 are used by external UI scripts (`winapp ui`) and should be preserved as `data-testid`s.

## 7. Bugs, races, and uncovered cases

Confirmed (follows directly from the code):

- B1. New chat, open thread, and delete thread are not blocked while a send is in flight. `NewChat` (`MeetingChatViewModel.cs:117-127`) has no `CanExecute` and `OpenThreadAsync`/`DeleteThreadAsync` (`:267-296`) do not check `IsSending`. A send that completes afterwards runs `PersistTurnAsync(open, ...)` with the `open` captured at send start (`:147,207`): it re-saves that thread (resurrecting it if the user deleted it, since `SaveAsync` upserts, `JsonChatThreadRepository.cs:60-64`), then sets `_openThread` and re-renders it (`:514-515`), overriding the user's New chat or opened thread. Fix in the port: disable these actions while sending, or key the persist to the send's own thread id and do not switch the view.
- B2. Non-atomic writes. Both repositories truncate the file with `File.Create` before serializing (`JsonChatThreadRepository.cs:117-118`, `JsonChatRecipeRepository.cs:91-92`). A crash, power loss, or serialization exception mid-write leaves a truncated or empty file and loses all threads or recipes. Fix: write to a temp file in the same directory, flush, then rename.
- B3. A corrupt, empty, or hand-edited file makes chat unusable. `DeserializeAsync` throws (`JsonChatThreadRepository.cs:97`, `JsonChatRecipeRepository.cs:81`), `InitializeAsync` fails at startup (error bar "Could not answer. ..." shown from `MainPage.xaml.cs:68-71`), and every `SaveAsync`/`DeleteAsync` re-reads the file first so no new thread can ever be saved. There is no quarantine or backup. A single entry missing a `required` member fails the whole file. Fix: tolerate per-entry failures, quarantine the bad file (rename to `.bad-<timestamp>`), start empty.
- B4. Local model context overflow. The local provider has a 4096-token context and a 512-token output cap (`LocalLlmSummaryProvider.cs:62,130`; `LocalLlmSummaryMapReduce.cs:23`) while chat sends unbounded prompts: Meeting scope inserts Summary and Notes uncapped (`ChatContextPacker.cs:69`) plus 6000 transcript chars plus up to 8 prior messages of 1500 chars (up to 12000 chars); Folder/All scope with 12 meetings can be about 14000+ characters with unbounded action items plus prior turns. There is no token counting or trimming in chat. Arithmetic puts worst cases well above 4096 tokens (roughly 4 chars per token). Runtime behavior (error versus silent truncation) was not exercised, so the failure mode is suspected; the overflow itself is confirmed by the arithmetic. The 512-token output cap also silently truncates long drafts.
- B5. Send reads the live transcript after two awaits (`MeetingChatViewModel.cs:154-162`), so for Live scope the context can include text newer than the moment the user pressed Send; it can also differ from the decision captured at `:146`. Low impact.
- B6. On a failed save, `open.Messages` is restored (`:509-511`) but `open.UpdatedAt` was already changed (`:504`) and is not restored; the in-memory thread then sorts as newer until reload.
- B7. Both messages of a turn share one `CreatedAt` (`:474,495,503`), so the assistant timestamp equals the user timestamp and the real answer latency is lost. Ordering relies on list order only.
- B8. `ChatRecipeCatalog.BuiltIns` is a static initializer (`ChatRecipeCatalog.cs:23-41`), so recipe names are resolved against `CurrentUICulture` once at first access. A later culture change (or a thread with a different culture at first access) leaves names in the wrong language. Prompts are always English, so non-English users send English recipe prompts.
- B9. Built-in-id collision is filtered only against the built-ins of the same availability (`ChatRecipeList.cs:28-35`). A user recipe that reuses a `single` built-in id but is marked `multiple` is shown in multiple scopes, and `DeleteRecipeAsync` refuses to delete it because `IsBuiltIn` checks all built-ins (`MeetingChatViewModel.cs:351-352`). It can only be removed by editing the JSON file. Also, user recipes with an availability string other than `single` or `multiple` (including different case) are never shown and cannot be deleted from the UI.
- B10. Truncation can split a surrogate pair: `CapPrefix` (`ChatContextPacker.cs:206`), `Tail` (`:214`), prior-turn truncation (`ChatPromptBuilder.cs:106`), `ChatThreadTitle` (`:15`), and `MeetingSnippet` (`MeetingSnippet.cs:48`) all slice by UTF-16 unit, so an emoji or other astral character at a cut produces a lone surrogate, which can corrupt the title persisted to JSON and the displayed text. Fix in the port with a code-point-safe cut (still count UTF-16 units for the limits so behavior matches).
- B11. `RelatedMeetings.SameTitle` matches two meetings with empty titles (`RelatedMeetings.cs:29-30`, `""` equals `""`), so unrelated untitled meetings appear related. The same applies to the brief's probe (empty subject gives the MeetingTitle fallback).
- B12. `MeetingBriefPromptBuilder.FormatOne` interpolates `meeting.Title` unescaped inside an XML-like attribute (`MeetingBriefPromptBuilder.cs:123`) and inserts summary, notes, and action item text raw. A title containing `"` or `</meeting>` breaks the structure and gives untrusted meeting text a way to inject instructions. The same hazard exists for chat: titles, summaries, notes, and transcripts are inserted raw into the context and the prompt with no delimiting or escaping (`ChatContextPacker.cs:159-165`), so a note line such as `Id: <other id>` or `# User message` can forge structure. Treat as prompt-injection exposure; fix in the port with clear delimiters and by stripping line breaks from single-line fields.
- B13. The brief prompt demands Markdown bullets (`MeetingBriefPromptBuilder.cs:62`), but the Record page renders it with a plain `TextBlock` (`RecordingPage.xaml:122-126`), so the user sees raw `- ` markers and any `**`. Either render Markdown or ask for plain lines.
- B14. Chat error messages use the raw `ex.Message` (`MeetingChatViewModel.cs:188-191,214,233`), while the brief uses `CliFailureUserMessage.Format(ex)` (`RecordingPageViewModel.cs:1090`). Chat can show stack-like or path-bearing text from CLI or HTTP providers. Align the port on a single user-message mapper.
- B15. `MeetingSnippet.StripMarkers` removes every `*` and `_` in a line (`MeetingSnippet.cs:92-94`), so `snake_case` identifiers, file names, and URLs lose underscores, and math like `a*b` loses the star. It also leaves list bullets (`- `), blockquote `>`, table pipes, and `[text](url)` link syntax in the snippet.
- B16. `HistoryPage.Snippet` is evaluated per row at bind time (`HistoryPage.xaml:212`) and re-scans the full summary or, when no summary exists, the whole transcript (split plus per-line parsing) for every row on the UI thread. With multi-hour transcripts and many meetings this is wasteful. Fix: compute and cache the snippet at load.
- B17. Every send loads all meetings and all folders (`:154-155`) from disk, including full transcripts, to use at most 12 records. Add id/folder-scoped queries in the port.
- B18. `GetByIdAsync` for threads reads, parses, and sorts the entire file (`JsonChatThreadRepository.cs:46-50`), and every `SaveAsync` rewrites the entire history. Cost grows with total chat history; there is no cap or pruning.
- B19. `OperationCanceledException` is swallowed silently (`:182-185`), but nothing cancels: `StreamPromptAsync` is called without a token (`:668`) and there is no Stop button, so a stuck CLI/provider call cannot be aborted by the user and leaves `IsSending` true until it finishes. Likewise the brief call has no cancellation or timeout (`RecordingPageViewModel.cs:1083`).
- B20. A partial streamed answer is discarded on failure: nothing is saved and only the error is shown (`:186-195`), even if most of the answer had arrived.
- B21. Related-meetings list can go stale: it loads once per `LoadAsync` (`SummaryPageViewModel.cs:155`), so after deleting a related meeting elsewhere, clicking its entry calls `SelectMeeting` and `OpenSession` on a missing id with no message (the chat citation path, by contrast, checks existence and shows `Chat_MeetingLinkMissing`).
- B22. Cross-module string reuse: `HistoryPage.FoldersToggleLabel` uses `Chat_ScopeFolder` (`HistoryPage.xaml.cs:295`). Renaming the chat string would change the Library UI.
- B23. `MainPage.xaml.cs:41-43` says the app is English-only, but `Strings/es/Resources.resw` and `CoreStrings.es.resx` exist and are complete for chat. The comment is stale; the port must treat en and es as supported.
- B24. Mismatch is not recalculated while `IsSending` (`:417-418`), so the banner can be stale for the duration of a long send.

Suspected (depends on runtime behavior not exercised):

- S1. IME composition: Enter in `PreviewKeyDown` sends without checking composition state (`MainPage.xaml.cs:97-109`). In Electron, check `event.isComposing` before sending.
- S2. External link safety: any `http`/`https` link the model emits (it may echo a URL found in untrusted transcript text) opens in the browser with one click and no confirmation (`MainPage.xaml.cs:354-358`). The port should keep the allow-list, render link targets visibly (title attribute), and never render raw HTML from model output.
- S3. Model may drift from the citation format (wrong brackets, raw Ids, invented Ids). `TryParseMeetingLink` accepts hyphenated and braced Guids but a bad Id yields the "meeting no longer exists" error. Nothing validates cited Ids against the packed context.
- S4. `Normalize` only drops exact `NONE`; a reply such as `NONE.` or a fenced block is shown as a brief (`MeetingBriefPromptBuilder.cs:33-40`). There is no check that the output is 2 to 3 bullets.
- S5. A scope refresh that finishes while a recipe refresh is mid-await can apply recipes for a newer decision after an older refresh has begun; the code re-reads `_decision` after the await, so the result converges, but the generation check at `:401` does not cover `RefreshRecipesAsync`.
- S6. History row snippets for transcripts that begin with `#` lines (a line the user spoke starting with `#`) are treated as headings and deprioritized (`MeetingSnippet.cs:51-69` feeds transcript text through `FromMarkdown`).
- S7. The slash flyout reopens on every text change while the draft starts with `/` (`MainPage.xaml.cs:123-128`) and may steal focus from the text box on some builds; not verified at runtime.
- S8. Spanish users get English instructions and English recipe prompts; with a small local model the answer language may not follow the question. No `outputLanguage` is passed to chat prompts (summaries do receive one).

Uncovered cases to decide in the port (no current behavior):

- Folder scope excludes sub-folders (exact id only); decide whether recursion is wanted (current tests encode the exact-only behavior).
- Live scope with an empty transcript still allows sending and returns a fixed "empty" message as the whole context.
- Meeting deleted while a thread for it is open: the thread stays, citations to it say "That meeting no longer exists."
- Threads for deleted meetings or folders are never cleaned up.
- No search over thread history, no rename, no export, no regenerate or edit-and-resend, no message-level delete, no stop button, no token usage display.

## 8. Parity checklist

Tick each item once the Electron implementation matches. Items reference sections above.

Shell and scope

1. Chat bar is app-global, docked below the page content, expand direction up, full width.
2. Bar is hidden (not collapsed-with-header) on Settings only.
3. Bar starts collapsed on app start.
4. Bar collapses whenever the resolved scope kind, folder id, or meeting id changes.
5. Bar expands on New chat and on opening a thread from history.
6. Header shows scope chip (icon plus label), History button, New chat button.
7. Scope glyphs: Live, Meeting, Folder, All meetings each have a distinct icon.
8. Scope label for Live is `Chat_ScopeLive`.
9. Scope label for Meeting is `Chat_ScopeMeetingNamed` with the meeting title, else `Chat_ScopeMeeting` when missing or blank.
10. Scope label for Folder is `Chat_ScopeFolderNamed` with the folder name, else `Chat_ScopeFolder`.
11. Scope label for All meetings is `Chat_ScopeAll`.
12. Surface parsing is exact and case-sensitive for `Recording`, `History`, `Settings`, `Session`; anything else is Unknown.
13. Settings surface: invisible, AllMeetings, no ids, even during capture.
14. Capture active (recording or processing): Live scope on every non-Settings surface.
15. Session surface with a selected meeting: Meeting scope with that id.
16. History surface with a selected (non-Inbox) folder: Folder scope with that id.
17. Everything else: AllMeetings (History Inbox, Recording idle, Session without meeting, Unknown).
18. Scope refresh is generation-guarded: a stale refresh is discarded.
19. Scope refresh re-reads the TypeSafe availability and rebuilds recipe lists.
20. Scope changes are raised for: shell tag change, folder publish (always), meeting id change, capture flag change; not for live transcript text changes.
21. Live transcript is read from the workspace at send time, not subscribed.
22. Match test for open thread uses kind, folder id, and meeting id with null equality.
23. Mismatch banner text `Chat_ScopeMismatch` shows when an open thread does not match the current scope; not recomputed while sending (decide whether to keep B24).
24. A mismatched open thread is not edited; the next send creates a new thread.

Composer and send

25. Draft binds on every keystroke.
26. Enter sends; Shift+Enter newline; Ctrl+Enter sends.
27. Enter with an empty draft or while sending does nothing and does not insert a newline.
28. Enter during IME composition must not send (new, S1).
29. Send enabled iff not sending, visible, and draft non-blank.
30. Placeholder `Chat_Composer.PlaceholderText`; Send tooltip `Chat_Send` "Send (Enter)".
31. Composer min height 32, max 96, min width 180, wraps, scrolls.
32. Message text is `Draft.Trim()`.
33. Optimistic user row plus pending assistant row appear immediately; draft clears immediately.
34. Pending row shows spinner plus `Chat_Thinking` until first visible text.
35. Streaming shows Markdown live; first push on first non-whitespace chunk; further pushes at most every 80 ms; final flush at end; leading whitespace trimmed in pushes.
36. Transcript auto-scrolls to the end on new rows and on every streamed text change.
37. Provider is resolved per send from settings; gating dialogs (local model download, CLI check, xAI sign-in) run via the shared resolver.
38. Cancelled/unsatisfied gate shows `Status_SetupCancelled` and keeps the user's turn out of history.
39. Provider exception shows `Chat_SendFailed` with the message.
40. Blank answer shows `Chat_EmptyAnswer` and persists nothing.
41. Answer text is trimmed before persisting.
42. On failure both optimistic rows are removed and the draft is restored only if the composer is still empty.
43. `IsSending` is always cleared in a finally path.
44. Failed UI marshalling reports `Chat_UiMarshalFailed`.
45. Error bar is closable, titled `Chat_Error`, severity error; cleared at the start of each send and on New chat.
46. Starter chips hidden while sending or when any message exists.
47. Optional improvements agreed for the port: block New chat/open/delete during send (B1); stop button (B19).

Context packing

48. Live scope returns `"Live transcript:" + NL + last 2500 chars`, or `ChatLiveTranscriptEmpty` for null/blank.
49. Live scope never reads saved meetings.
50. Meeting scope finds by id; missing or null id returns `ChatMeetingNotFound`.
51. Meeting scope: Summary and Notes uncapped; transcript tail 6000 chars; empty transcript returns `ChatTranscriptEmpty` line.
52. Meeting block header lines in order: Id (32 hex), Title, Recorded (`yyyy-MM-dd HH:mm` local), Summary, Action items, Notes.
53. Date is never ISO "O".
54. Blank summary or notes render `(none)`.
55. Action items render `- [ ] text` / `- [x] text`, skipping null/blank, line breaks replaced by a space; empty renders `(none)`.
56. Folder scope with no folder id returns `ChatFolderNotSelected`.
57. Folder scope header `Folder: {name}` and `Note: {note or (none)}`; unknown folder prints `ChatFolderNotFound`.
58. Folder scope includes only meetings with exactly that folder id (no children, no Inbox).
59. AllMeetings header `All meetings:`; ignores folder id.
60. Multi scopes: sort by `RecordedAt` desc then `Id` desc; cap 12.
61. Multi scopes: Summary capped to first 800, Notes to first 400; no transcripts.
62. Truncated list adds `Showing the 12 most recent of N meetings. Older meetings were omitted.`
63. Empty result adds `ChatNoMeetingsInFolder` or `ChatNoMeetingsSaved`.
64. Blocks are separated by a blank line; result is end-trimmed.
65. Never include JevAnalysis, audio paths, folder ids of meetings, or other fields.
66. Unknown scope throws.

Prompt

67. Prompt text lines match section 3.4 verbatim, in order.
68. `Scope: ` label uses the English labels `All meetings`/`Folder`/`Meeting`/`Live`.
69. Rewrite instruction only for Meeting scope when the message contains `rewrite` (case-insensitive substring).
70. Sections `# Context`, `# Prior turns`, `# User message` with blank lines between.
71. Prior turns: last 8 messages, each `role: text`, text cut to 1500; `(none)` if empty.
72. User message appended without a trailing newline.
73. Citation prefix `https://meetinglive.local/meeting/` plus 32-hex Id.
74. `TryParseMeetingLink` rules: null false; prefix match ignoring case; trailing slashes trimmed; Guid parse.

Persistence

75. Threads file `chat-threads.json` in the app data directory; recipes `chat-recipes.json`.
76. camelCase property names; nulls written; Guid `D` format; ISO-8601 offset timestamps.
77. `scopeKind` stored as PascalCase enum name; reading accepts case-insensitive names.
78. Required members enforced on read (decide the tolerant behavior from B3 in the port, but keep file compatibility).
79. Missing messages array becomes empty.
80. Save is upsert by id, preserving file position when replacing, appending when new.
81. Delete of a missing id does nothing and does not create the file.
82. Thread list order: `updatedAt` desc, `createdAt` desc, `id` desc.
83. Recipe list order: file order.
84. All repository operations are serialized in-process.
85. Directory created on first write.
86. Writes should be atomic (B2) and files remain readable by the old format.
87. Thread created on first successful send only.
88. Thread title is the first message trimmed, line breaks to single space, max 60, trailing space trimmed.
89. `CreatedAt`/`UpdatedAt` use local time with offset; user and assistant messages of a turn share one timestamp (decide whether to fix B7).
90. `UpdatedAt` is bumped each turn; titles never change.
91. Save failure restores the in-memory message list and shows the error.
92. After a successful turn the transcript is re-rendered from the persisted thread and the thread list is refreshed.

Threads UI

93. History flyout reloads threads when opened.
94. Empty state `Chat_HistoryEmpty`.
95. Rows show title (blank gives `Chat_Untitled`) and `Chat_ThreadUpdated` with a local short date-time.
96. Clicking a row opens that thread, closes the flyout, expands the bar, scrolls to end.
97. Opening a missing thread resets to a new chat when it was open, and refreshes the list.
98. Delete button per row opens the confirm dialog with title `Chat_DeleteThreadTitle`, content with title, default button Close.
99. Confirming deletes the thread; clears the view if it was open; refreshes the list.
100. New chat clears messages, draft, error, mismatch, and open thread.
101. Threads list shows all threads regardless of scope.

Recipes

102. Built-in recipes: eight entries with the exact ids, names, availability, and prompts from 3.7.
103. Built-ins are never written to disk.
104. Scope to availability: Meeting/Live single; Folder/All multiple.
105. Scope list = built-ins (catalog order) then user recipes (file order); user rows with colliding built-in ids skipped (apply the B9 fix or keep, but document).
106. Starter chips = first 4 of the scope list.
107. Chip click fills the draft and sends immediately.
108. Recipes flyout lists name and two-line prompt preview; item click fills the draft without sending, closes the flyout, focuses and puts the caret at the end.
109. Delete icon only on user recipes; built-ins cannot be deleted even through the API.
110. Slash filter opens automatically when the draft starts with `/`, filtering by name or prompt, case-insensitive substring of `Draft[1..].Trim()`.
111. Button-open shows the full list; slash-open shows the filtered list.
112. Empty state `Chat_NoRecipes`.
113. Create recipe dialog fields, placeholders, availability radio with default from current scope, validation that blocks Save on blank name or prompt.
114. Saved recipe: new Guid, trimmed name and prompt, availability from the radio, `CreatedAt` now.
115. Delete recipe dialog `Chat_DeleteRecipe*` strings, default Close.
116. Recipe errors surface through the chat error bar.

Message rendering

117. User messages are plain text bubbles, right-aligned, max about 75% width, selectable.
118. Assistant messages render Markdown (headings, lists, emphasis, code, tables, links); no raw HTML.
119. Role labels `Chat_RoleUser` and `Chat_RoleAssistant` exist; assistant label shown above the answer.
120. Copy button on completed assistant messages copies the raw Markdown; failure shows `Chat_CopyFailed`.
121. Transcript list max height 420 with internal scrolling.
122. Meeting citation links open the meeting on the Summary tab (select meeting, navigate to Session).
123. Missing cited meeting shows `Chat_MeetingLinkMissing`.
124. http(s) links open in the system browser; other schemes are ignored.
125. Link handler errors surface in the error bar.
126. Accessible text of each row is `Role: text` (or just the role while thinking).

Personal tasks

127. Button visible only in Meeting scope when TypeSafe is enabled and an API key exists.
128. Click opens the Personal tasks dialog for the current meeting id; ignores clicks while opening.
129. Availability is re-read on scope refresh and when the bar expands.

Related meetings

130. Related = other meetings with the same trimmed non-empty series id OR the same trimmed title (ordinal, case-sensitive), excluding the current id.
131. Order by `RecordedAt` desc.
132. Blank series ids never match each other.
133. Summary page shows at most 5, newest first, with title and local short date-time.
134. Section hidden when empty; click opens that meeting's Summary tab.

Snippet

135. Summary preferred over transcript when summary is not blank.
136. Transcript fallback drops `Recorded `/`Ended ` header lines, timestamp ranges, and `[ Speaker-N ]` tags.
137. Heading lines (1 to 6 `#` then space or end) go to a secondary buffer used only when no body text exists.
138. Marker stripping removes ```` ``` ````, `**`, `__`, `` ` ``, `*`, `_` in that order.
139. Whitespace runs collapse to one space; result trimmed.
140. Truncate to 140 chars plus `…`.
141. Empty snippet shows `History_NoContent`.
142. Snippet computed once per meeting row load (B16 improvement).

Brief

143. `HasUsefulContext` gate runs before any provider setup or model call.
144. Brief prompt text matches 3.10 verbatim, with attendees joined by `, `, agenda trimmed, and at most 3 prior meetings.
145. Prior meeting block includes title attribute, summary, notes, action item texts joined by `; `, each defaulting to `(none)`.
146. Normalize returns null for blank or `NONE` (case-insensitive).
147. Generation counter discards stale results after the note is reset or another event is opened.
148. Provider failure shows `RecordPage_BriefFailedFormat` with the mapped message; cancelled provider setup is silent.
149. Brief persists to the linked existing meeting; save errors show in the same error bar.
150. Brief shown only while the coming-up note is open and not processing; passed to the pipeline and to live answers.
151. Brief renders as Markdown in the port (B13).

Localization and accessibility

152. All strings above exist in en and es, with the same keys, including placeholders `{0}`.
153. Automation ids preserved: `BarMeetingChat`, `LblMeetingChatScope`, `BtnMeetingChatHistory`, `ListMeetingChatHistory`, `BtnMeetingChatNew`, `ListMeetingChat`, `InfoMeetingChatError`, `ListMeetingChatStarters`, `TxtMeetingChat`, `BtnMeetingChatSend`, `BtnMeetingChatPersonalTasks`, `BtnMeetingChatRecipes`, `ListMeetingChatRecipes`, `ListRelatedMeetings`, `TxtMeetingBrief`, `BriefSection`, `InfoBriefError`.
154. Built-in recipe names resolve at call time against the current UI language (fix for B8).

Tests

155. Every test named in section 6 has an equivalent in the new test suite, plus new tests for B1, B3, B10, and the send/rollback flow.
