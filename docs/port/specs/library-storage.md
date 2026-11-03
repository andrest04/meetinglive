# Spec: library-storage

Module scope: where meetings, folders, and settings live on disk; how they are read and written; the one-time migrations; and the Library page (folder tree, meeting list, folder actions) plus the Settings "Data" section and the app-lifetime `WorkspaceService`.

Source of truth is the C# in `MeetingLive.Core` and `MeetingLive.App` as of branch `feat/electron-port`. File:line references use the WinUI tree. Statements marked "(trace)" come from reading the code, not from running it.

Conventions in this document:

- "Library root" means `Documents\MeetingLive` (`AppPaths.UserDataDirectory`).
- "App data root" means `%LOCALAPPDATA%\MeetingLive` (`AppPaths.RootDirectory`).
- Internal folder names stay `MeetingLive` even though the product is Vozella (`AGENTS.md:7`). The Electron app must keep these names or it orphans user data.
- All `\n` below are literal LF unless stated.

---

## 1. Purpose

1. Store each meeting as one UTF-8 Markdown file (frontmatter plus sections) with an optional sibling `.wav` of the same name, inside a directory tree under the Library root that mirrors the user's Library folders.
2. Store the Library folder tree (metadata: name, parent, note, color, icon) in `folders.json` in the Library root, and keep the directories on disk in step with it.
3. Store app settings in `settings.json` in the app data root.
4. Migrate three older layouts into the current one at startup.
5. Provide the Library page: browse folders, search by title, open/move/delete meetings, create/rename/restyle/delete folders, edit a per-folder note.
6. Provide the Settings "Data" and "About" cards (paths, open folder, version).
7. Provide `WorkspaceService`, the in-memory hub that holds the selected meeting, selected Library folder, current shell tag, and navigation requests.

The Electron app must read and write these files so that the WinUI app and the Electron app can open the same library.

---

## 2. User-facing features

String keys are WinUI `.resw` keys. English is `Strings/en-us/Resources.resw`, Spanish is `Strings/es/Resources.resw`. A porter should keep the keys (or an equivalent namespace) and both languages. `{0}` is a positional placeholder.

### 2.1 Library page shell (`HistoryPage.xaml`)

Layout, top to bottom, with 24 px page padding and 16 px row spacing:

1. Header row: title `HistoryPage_Title` ("Library" / "Biblioteca"), then right-aligned: folders toggle button (hidden in wide mode) and the "New folder" button (`Library_NewFolderLabel`, "New folder" / "Nueva carpeta", folder-plus glyph U+E8F4).
2. Breadcrumb bar (min column width 160) and search box (min column width 280). Two equal-star columns, 12 px gap.
3. Body: a progress ring centered while loading; otherwise a split view.

Responsive behavior:

- Wide (window width >= 820 px): the folder pane is inline, always open, 260 px wide, transparent background, 16 px right margin, card surface with padding 4,8.
- Narrow (< 820 px): the pane is an overlay, closed by default, with a solid background (`SolidBackgroundFillColorBase`). The toggle button (folder glyph U+E8B7, automation name = `Chat_ScopeFolder` "Folder" / see Spanish file) becomes visible and toggles the pane open state two-way.

The body is hidden while `IsLoading` is true (`InvertBoolToVisibility(IsLoading)`).

Stable automation ids (keep for end-to-end tests): `BtnLibraryFoldersToggle`, `BtnLibraryNewFolder`, `BreadcrumbLibrary`, `TxtLibrarySearch`, `TreeLibraryFolders`, `TxtLibraryFolderNote`, `InfoLibraryStatus`, `BtnHistoryEmptyRecord`, `ListMeetingHistory`, `BtnHistoryMore`, `MenuHistoryOpenSummary`, `MenuHistoryMove`, `MenuHistoryDelete`, `MenuLibraryRenameFolder`, `MenuLibraryPersonality`, `MenuLibraryDeleteFolder`, `DlgLibraryPersonality`, `GridLibraryPersonalityColor`, `GridLibraryPersonalityIcon`.

### 2.2 Page lifecycle

- On navigate to the page: `LoadAsync()` (fire and forget).
- On navigate away and on control Unloaded: `PersistSelectedFolderNoteAsync()` (fire and forget).
- There is no live refresh. The page does not subscribe to `MeetingChanged` or `MeetingDeleted`; it reloads only on navigation and after its own mutations.

### 2.3 Folder tree

- Root node "Inbox" (`Library_Inbox`: "Inbox" / "Bandeja de entrada") is virtual: `FolderId = null`, never persisted, always first. It has an invisible accent dot (opacity 0, the slot is kept so names align) and the Inbox glyph U+E716. Real folders show an 8 px accent dot (circle) plus a 16 px icon in the same accent color plus the name.
- Real folders are children of their `ParentId`, siblings sorted by name, case-insensitive, current-culture comparison.
- Node accent color: `FolderAccent.ResolveKey(colorKey, folderId)` mapped to a theme brush (see 3.9). Inbox uses the neutral brush.
- Node icon: Inbox uses U+E716; real folders use `FolderIcon.Glyph(iconKey)` (see 3.10).
- Expansion: after every reload only the ancestors of the target folder (`_restoreFolderId ?? _selectedFolderId`) are expanded. Everything else is collapsed. Cycle-safe (visited set).
- Click on a node (`ItemInvoked`) selects it. Selecting the already-selected node does nothing.
- Right-click on a real folder: select it first (which persists the previous folder's note), then show a flyout with three items: Rename (`LibraryContext_Rename`, glyph U+E8AC), Personality (`LibraryContext_Personality`, glyph U+E790), Delete folder (`LibraryContext_Delete`, trash glyph). Right-click on Inbox or empty space does nothing.

### 2.4 Breadcrumbs

Always starts with an "Inbox" item (`FolderId = null`, label `Library_Inbox`). For a real folder, the chain root-to-selected follows after it, so the path reads `Inbox > Parent > Child`. Cycle-safe. Clicking an item selects that folder (Inbox selects Inbox). The click handler also handles a click by index when the clicked item is not a breadcrumb object.

Note: the breadcrumb shows "Inbox" first even though root folders are not children of Inbox in the tree. Keep this for parity.

### 2.5 Folder note

- A multiline text box (header `Library_FolderNote.Header` "Folder notes" / "Notas de la carpeta"; placeholder `Library_FolderNote.PlaceholderText` "Notes for this folder" / "Notas para esta carpeta"), max height 120, wrap, visible only when a real folder is selected.
- Bound two-way to `FolderNote` with per-keystroke updates. It is persisted only when `PersistSelectedFolderNoteAsync` runs (see 3.14). Empty or whitespace-only text is stored as `null`; otherwise the trimmed text is stored.
- Selecting a folder loads its stored note (or empty).

### 2.6 Search

- Auto-suggest box, find icon, placeholder `Library_Search.PlaceholderText` ("Search meetings" / "Buscar reuniones").
- Filters the meetings of the currently selected folder by title only: trimmed query, ordinal case-insensitive substring. No content search. Updates on every keystroke. The query is kept when the folder changes.

### 2.7 Meeting list

Shown when `HasMeetings` (at least one displayed meeting). Selection mode none, whole row clickable. Each row is a card (padding 16,12; 8 px bottom margin):

- Line 1: title (strong, single line, ellipsis) left; date right (caption, tertiary color), formatted as the user's current-culture short date plus short time (`"g"`), converted to local time.
- Line 2: snippet, one line, ellipsis, secondary color: `MeetingSnippet.From(summary, transcript)` or, when empty, `History_NoContent` ("No content yet" / "Todavía no hay contenido"). Algorithm in 3.15.
- Right: a 36x36 borderless "more" button (glyph U+E712) with accessible name and tooltip `HistoryRow_More` ("More actions" / "Más acciones").
- Sort: newest first by `RecordedAt` (descending).
- Row click: select the meeting in `WorkspaceService`, open the Session page on the Transcript tab.
- Right-click or "more": same menu (3.8). Right-click shows it at the pointer; "more" anchors it to the button.

### 2.8 Meeting menu

Items in order (text key, glyph, automation id):

1. `HistoryRow_OpenSummary` ("Open summary" / "Abrir resumen"), U+EB78, `MenuHistoryOpenSummary`. Selects the meeting and opens Session on the Summary tab.
2. `HistoryRow_Move` ("Move" / "Mover"), U+E8DE, `MenuHistoryMove`.
3. `HistoryRow_Delete` ("Delete" / "Eliminar"), U+E74D, `MenuHistoryDelete`.

### 2.9 Empty states and flags

Computed in `RefreshEmptyFlags` after each filter pass and when `IsLoading` changes:

- `inboxEmpty = IsInboxSelected && inFolderCount == 0`, where `inFolderCount` is the count in the selected container before the search filter.
- `ShowLibraryEmpty = !IsLoading && inboxEmpty && no folders && no meetings at all`. Shows `HistoryPage_Empty` ("No meetings recorded yet." / "Todavía no hay reuniones grabadas.") and a primary button `HistoryPage_EmptyCta` ("Record a meeting" / "Grabar una reunión") that navigates the shell to Recording.
- `ShowInboxEmpty = !IsLoading && inboxEmpty && !ShowLibraryEmpty`. Shows `Library_InboxEmpty` ("Inbox is empty. New recordings land here." / "La bandeja de entrada está vacía. Las nuevas grabaciones llegan aquí.").
- `ShowFolderEmpty = !IsLoading && !IsInboxSelected && inFolderCount == 0`. Shows `Library_FolderEmpty` ("This folder is empty." / "Esta carpeta está vacía.").
- A search that matches nothing shows none of these and an empty list (see bug B15).
- `IsEmpty = !IsLoading && !HasMeetings` (exposed property).

### 2.10 Status bar

A closable warning InfoBar (`InfoLibraryStatus`) between the note and the list. `ShowStatus(message)` sets the message and opens it. Used for: busy delete, failed delete, and "folder not empty".

### 2.11 New folder

- Button in the header. Dialog title: `LibraryNewFolder_Title` ("New folder" / "Nueva carpeta") when Inbox is selected, otherwise `LibraryNewFolder_TitleIn` ("New folder in {0}" / "Nueva carpeta en {0}") with the selected folder's name.
- Body: a text box, header `LibraryFolderName.Header` ("Name" / "Nombre"), placeholder `LibraryFolderName.PlaceholderText` ("Folder name" / "Nombre de la carpeta").
- Buttons: primary `LibraryNewFolder_Primary` ("Create" / "Crear"), close `LibraryNewFolder_Cancel` ("Cancel" / "Cancelar"). Default button: Primary.
- The primary action is blocked (dialog stays open) while the name is empty or whitespace.
- Result: a folder is created as a child of the currently selected folder (Inbox means a root folder), color auto-assigned, and the new folder becomes the selected one with its ancestors expanded. Rules in 3.13.

### 2.12 Rename folder

- Opened from the folder context menu. Title `LibraryRenameFolder_Title` ("Rename folder" / "Renombrar carpeta"), primary `LibraryRenameFolder_Primary` ("Rename" / "Renombrar"), close `LibraryRenameFolder_Cancel`. Text box pre-filled with the current name. Same empty-name block. Default: Primary.
- Only the name changes (trimmed). The directory on disk is renamed with it and every meeting file inside gets its `audioFilePath` rewritten (3.12).

### 2.13 Folder personality

- Dialog `DlgLibraryPersonality`, title `LibraryPersonality_Title` ("Folder personality" / "Personalidad de la carpeta"), primary `LibraryPersonality_Primary` ("Save" / "Guardar"), close `LibraryPersonality_Cancel` ("Cancel" / "Cancelar"). Default: Primary.
- Content (min width 400, max 440): a live preview row (8 px dot, 16 px icon, folder name), a "Color" section (`LibraryPersonality_ColorHeader` "Color" / "Color") with 7 round 28 px swatches in the order `blue, teal, green, amber, orange, red, purple`, and an "Icon" section (`LibraryPersonality_IconHeader` "Icon" / "Ícono") with 18 tiles (40 px) in the order of 3.10, max height 220. Each swatch and tile exposes its key as accessible name.
- Initial selection: the stored key resolved by `ResolveKey` (an unset color resolves via the hash, see B1); an unset icon resolves to `folder`.
- Save stores both keys (resolved) and reloads keeping the folder selected.

### 2.14 Delete folder

- Allowed only when the folder has no child folders and no meetings filed in it (judged from the in-memory snapshot from the last load). Otherwise the status bar shows `LibraryDeleteFolder_NotEmpty` ("This folder still has subfolders or meetings. Empty it before deleting." / "Esta carpeta todavía tiene subcarpetas o reuniones. Vacíala antes de eliminarla.") and nothing else happens.
- Confirmation dialog: title `LibraryDeleteFolder_Title` ("Delete this folder?" / "¿Eliminar esta carpeta?"), content `LibraryDeleteFolder_Content` (`This deletes the folder "{0}". Meetings inside it are not deleted.` / `Esto elimina la carpeta "{0}". Las reuniones que contiene no se eliminan.`), primary `LibraryDeleteFolder_Primary` ("Delete" / "Eliminar"), close `LibraryDeleteFolder_Cancel`. Default button: Close (Cancel).
- On confirm: the folder record is removed, its directory is deleted only if empty, the selection resets to Inbox, and the workspace is told Inbox is selected.

### 2.15 Move meeting

- Dialog title `LibraryMove_Title` ("Move meeting" / "Mover reunión"), primary `LibraryMove_Primary` ("Move" / "Mover"), close `LibraryMove_Cancel`. Default: Primary.
- Body: single-selection list (max height 320) of destinations from `FolderPathList.Flatten(folders, "Inbox")`: Inbox first, then each folder as a `Parent / Child` path, depth-first, siblings sorted by name (3.11).
- Pre-selected row: the one whose folder id equals the meeting's current `FolderId`; if none matches (including a dangling folder id) the first row (Inbox).
- On confirm: the destination's folder id (null for Inbox, also when nothing is selected) is applied to the full record, which is re-saved (the repository moves the markdown and WAV together), and the list reloads keeping the current folder selected. Moving to the same folder still performs a save.

### 2.16 Delete meeting

- Refused first if the meeting is busy (3.7): status bar `HistoryDelete_Busy` ("This meeting is still being recorded or processed. Try again when it finishes." / "Esta reunión todavía se está grabando o procesando. Inténtalo de nuevo cuando termine.").
- Confirmation dialog: title `HistoryDelete_Title` ("Delete this meeting?" / "¿Eliminar esta reunión?"), content `HistoryDelete_Content` (`This permanently deletes "{0}" and its recording.` / `Esto elimina permanentemente "{0}" y su grabación.`, `{0}` = title), primary `HistoryDelete_Primary` ("Delete" / "Eliminar"), close `HistoryDelete_Cancel` ("Cancel" / "Cancelar"). Default: Close.
- On confirm the busy check runs again, then the repository delete runs. On success the workspace is notified (`NotifyDeleted`). On `IOException` or `UnauthorizedAccessException` the status bar shows `HistoryDelete_Failed` (`The meeting was not deleted. Close any program using its audio and try again: {0}` / `La reunión no se eliminó. Cierra cualquier programa que esté usando su audio e inténtalo de nuevo: {0}`, `{0}` = exception message). In every case the list reloads, keeping the current folder selected.

### 2.17 Settings: Data and About cards

- Section title `Settings_Data` ("Data" / "Datos").
- Card `Settings_MeetingsLocation` ("Meetings" / "Reuniones"): description = Library root path; folder glyph U+E8B7; action button `Settings_OpenFolder` ("Open folder" / "Abrir carpeta"). The action calls `EnsureDirectoriesExist()` and then opens the Library root in the OS file manager. The comment at `DataFolderSectionViewModel.cs:40` records that passing the path to `explorer.exe` opens Documents instead, so the directory itself is opened through the shell.
- Card `Settings_AppDataLocation` ("App data" / "Datos de la aplicación"): description = app data root path; glyph U+E115; no action icon.
- Card `Settings_About` (header "Vozella"): description = version string; glyph U+E946; no action icon. Version: the MSIX package version `major.minor.build.revision`; if not packaged, the assembly informational version; if blank, `1.0.0.0`.
- Automation ids: `CardMeetingsLocation`, `BtnOpenMeetingsFolder`, `CardAppDataLocation`, `CardAbout`.

### 2.18 Startup migrations (user-visible only on failure)

Run in `App.OnLaunched`, in this order, in one try block: `UserDataLocationMigrationService.MigrateIfNeeded()`, then `MeetingLibraryLayoutMigrationService.MigrateIfNeededAsync()`, then `MeetingsMigrationService(Meetings).MigrateIfNeededAsync()`. The first exception is captured and shown by the shell after the window activates (display is outside this module); later migrations in the block are then skipped (`App.xaml.cs:103-113`). Details in 3.16.

---

## 3. Domain rules

### 3.1 Paths (`AppPaths`)

| Name | Value | Notes |
| --- | --- | --- |
| `RootDirectory` | `%LOCALAPPDATA%\MeetingLive` | Electron has no `localAppData` path name; use `process.env.LOCALAPPDATA` on Windows. `app.getPath('appData')` is Roaming and is wrong. |
| `UserDataDirectory` | `<Documents>\MeetingLive` | Windows shell Documents folder, follows OneDrive redirection. `app.getPath('documents')` matches. |
| `InboxDirectory` | `<UserData>\Inbox` | |
| `FoldersFilePath` | `<UserData>\folders.json` | |
| `SettingsFilePath` | `<Root>\settings.json` | |
| `MeetingsFilePath` | `<Root>\meetings.json` | legacy JSON store |
| `MeetingsDirectory` | `<UserData>\Meetings` | legacy flat markdown dump (second generation) |
| `RecordingsDirectory` | `<UserData>\Recordings` | legacy flat WAV dump |
| `LegacyMeetingsDirectory` | `<Root>\Meetings` | first generation markdown |
| `LegacyRecordingsDirectory` | `<Root>\Recordings` | first generation WAV |
| `LegacyFoldersFilePath` | `<Root>\folders.json` | first generation folders |

Other paths in `AppPaths` belong to other modules and must keep these exact names: `Models`, `TranscriptionModels`, `NemoSpeech`, `SummaryModels` (all under Root), `chat-threads.json`, `chat-recipes.json`, `xai-credentials.bin`, `typesafe-credentials.bin`, `custom-note-template.json` (all under Root).

`EnsureDirectoriesExist()`: create `<UserData>\Inbox`, `<Root>\TranscriptionModels`, `<Root>\NemoSpeech`, `<Root>\SummaryModels`; then best-effort delete of leftover Whisper cache: directory `<Root>\WhisperModels` (recursive) and file `<Root>\Models\ggml-base.bin`. IO and permission errors are swallowed. Called by `AppSettingsService.SaveAsync`, the Open-folder action, and the Recording page.

Paths are computed once at process start.

### 3.2 Directory layout

```
Documents\MeetingLive\
  folders.json
  Inbox\
    2026-09-01 Standup.md
    2026-09-01 Standup.wav
  Universidad\                 <- folder "Universidad"
    2026-09-02 Clase.md
    2026-09-02 Clase.wav
    Calculo\                   <- child folder "Calculo"
      2026-09-03 Repaso.md
```

- A meeting with `folderId` null, or whose `folderId` is not in `folders.json`, is written to `Inbox\`.
- A folder's directory is `Library root` + the sanitized names of the chain root-to-folder. The chain walk stops after 64 steps or at a missing parent; a broken chain yields the partial path built so far. An empty chain yields Inbox.
- The directory tree is a write-only mirror. When reading, the folder of a meeting is the `folderId` in its frontmatter, never the directory it sits in. Moving a `.md` in the file manager does not refile it.

### 3.3 `SanitizeName(name)` (exact)

1. null, empty, or whitespace: return `"Meeting"`.
2. Trim; replace every character in `Path.GetInvalidFileNameChars()` with a single space. On Windows that set is `" < > |`, `:`, `*`, `?`, `\`, `/`, and code points 0 to 31 (and NUL).
3. While the string contains two consecutive spaces, replace them with one.
4. `Trim()`, then `TrimEnd('.')` (dots only, in that order).
5. If length > 80 (UTF-16 code units): keep the first 80, `Trim()`, `TrimEnd('.')`.
6. If now empty or whitespace: `"Meeting"`.
7. If equal to `"Inbox"` ignoring case: `"Inbox folder"`.
8. Return.

Porting note: on non-Windows `GetInvalidFileNameChars` is only `/` and NUL. The port should always use the Windows set so a library synced between OSes stays consistent. Known gaps are in B8.

Examples: `"Q3: plan/review?"` -> `"Q3 plan review"`; `"Notes..."` -> `"Notes"`; `"inbox"` -> `"Inbox folder"`; `"   "` -> `"Meeting"`.

### 3.4 `FileStem(recordedAt, title)`

`"{YYYY}-{MM}-{DD} {SanitizeName(title)}"`, using the year, month, day of the `DateTimeOffset` in its own stored offset (not converted to local). Zero-padded 4/2/2. Example: `2026-09-01T23:30:00-05:00`, title "Standup" -> `2026-09-01 Standup`.

### 3.5 `AllocateFileStem(directory, desiredStem, meetingId, idFromMarkdownPath)`

Creates `directory` if missing. For n = 1, 2, 3, ...: `stem = n==1 ? desired : desired + " " + n`. Return `stem` if either:

- `stem.md` exists and `idFromMarkdownPath(stem.md) == meetingId` (same meeting, reuse), or
- neither `stem.md` nor `stem.wav` exists.

Otherwise continue with the next n. Unbounded loop.

Consequence (trace, see B2): a `.wav` that already sits at the stem blocks the stem unless a `.md` with the same id sits next to it.

### 3.6 `MarkdownMeetingRepository` operations

Constructor: `rootDirectory` defaults to the Library root; `folders` defaults to a `JsonFolderRepository` on `<root>\folders.json`. Tests pass a temp root so the real Documents folder is never touched; the port needs the same injectable root (it is also how development uses an isolated data folder).

**GetAll**

1. Root missing: empty list.
2. Enumerate every `*.md` under the root recursively (all depths).
3. For each: read, parse. `FormatException`, `IOException`, `UnauthorizedAccessException` skip that file silently. Cancellation propagates.
4. De-duplicate by `id`: keep the first seen; replace it only when the kept one is under a legacy flat dump and the new one is not.
5. Result order is the dictionary order (effectively file enumeration order); callers sort.

**GetById** - find the markdown path for the id (3.6 `Find`), parse it, return; not found returns null. A parse error here is not caught.

**Find(id)** - enumerate all `*.md` recursively; for each, `TryReadId` (parse, null on Format/IO/Unauthorized). Return the first match that is not a legacy flat dump; otherwise the last legacy match; otherwise null. This re-parses every file on every call (B19).

**IsLegacyFlatDump(path)** - true when the first path segment of `path` relative to the root equals `Meetings` or `Recordings`, ignoring case. A path that is blank returns false.

**Save(record)** (exact order)

1. Read all folders.
2. `directory = DirectoryFor(root, folders, record.FolderId)`.
3. `desiredStem = FileStem(record.RecordedAt, record.Title)`.
4. `stem = AllocateFileStem(directory, desiredStem, record.Id, TryReadId)`.
5. `markdownPath = directory/stem.md`, `audioPath = directory/stem.wav`.
6. `existingMarkdown = Find(record.Id)` (may be null).
7. `existingAudio = record.AudioFilePath`; if blank and `existingMarkdown` is not null, `existingAudio = existingMarkdown` with extension `.wav`.
8. `MoveFileIfNeeded(existingAudio, audioPath)`: no-op if source blank, source missing, or both paths are equal (full path, case-insensitive). Otherwise create the destination directory, delete the destination file if it exists, then move source to destination.
9. If `audioPath` exists, set `record.AudioFilePath = audioPath` (mutates the caller's record).
10. Create `directory`; write `Render(record)` to `markdownPath` (UTF-8, no BOM, overwrite).
11. If `existingMarkdown` is not null, differs from `markdownPath` (case-insensitive full path), and exists: delete it.

**Delete(id)**

1. `path = Find(id)`; null or missing: return (no throw).
2. Parse it to get `AudioFilePath` (note: parse already falls back to the sibling `.wav` if the stored path is gone).
3. If `AudioFilePath` is non-blank and exists, delete it. This runs first on purpose: a locked WAV throws while the markdown still exists, so the meeting stays listed and the delete can be retried.
4. Delete the sibling `<same stem>.wav` if it exists.
5. Delete the markdown last (the markdown is the meeting's identity).

Exceptions from locked files propagate to the caller.

### 3.7 Busy check (cross-module)

`IsMeetingBusy(id)` is true when `Recording.IsMeetingInUse(id)` (any pipeline run has that meeting id, or it is the current meeting and the recording session phase is not Idle; `RecordingPageViewModel.PipelineRun.cs:24-30`) or when re-transcription is running for that meeting id (`Retranscription.IsRunning && MeetingId == id`). Only delete checks it. Move does not (B13).

### 3.8 `MeetingMarkdownFormatter.Render` (exact format)

Output order and rules:

```
---\n
id: <guid, lowercase, hyphenated>\n
title: <title raw>\n
recordedAt: <DateTimeOffset round-trip "O", invariant>\n
endedAt: <"O">\n                         only if EndedAt is set
audioFilePath: <path>\n                  always written; empty value still has the trailing space
folderId: <guid>\n                       only if FolderId is set
summaryProvider: <text>\n                only if non-empty
calendarEventId: <v>\n                   only if non-blank, newlines -> space
calendarId: <v>\n                        same
seriesId: <v>\n                          same
joinUrl: <v>\n                           same
noteTemplateId: <v>\n                    same
attendees: <name1> | <name2>\n           only if the list is non-empty; each name has \r and \n replaced by a space
headerEscaping: 1\n                      only if some text section holds a line equal to a section header
---\n
```

Then sections, each introduced by `"\n" + header + "\n\n"` and followed by body + `"\n"`:

| Order | Header | Source field | Written when | Escaped |
| --- | --- | --- | --- | --- |
| 1 | `## Brief` | `Brief` | not null/whitespace | yes |
| 2 | `## Transcript` | `Transcript` | not null/empty | yes |
| 3 | `## Summary` | `Summary` | not null/empty | yes |
| 4 | `## Action Items` | `ActionItems` | count > 0 | no |
| 5 | `## Jev` | `JevAnalysis` | not null | no |
| 6 | `## Personal Notes` | `Notes` | not null/empty | yes |
| 7 | `## Follow-up` | `FollowUp` | not null/whitespace | yes |
| 8 | `## Project plan` | `ProjectPlan` | not null/whitespace | yes |

- Text bodies are `Trim()`med before writing (whitespace-only content under the "empty" rule still writes an empty header, B21).
- Action items: one line each, `- [ ] text` or `- [x] text`, each ending in `\n`. Written raw (no escaping, B22).
- Jev: the `MeetingJevAnalysis` object as one line of compact JSON with camelCase names (System.Text.Json "Web" defaults), then `\n`. Property names: `meetingType, meetingTypeConfidence, spokenLanguage, urgencyScore, urgencyConfidence, containsDecisions, containsCommitments, piiRisk, summaryFaithful, suggestedFolderId, folderConfidence, actionItems[{text, relation, confidence}], model, analyzedAt`. Nulls are written as `null`. Non-ASCII characters are `\uXXXX`-escaped by the .NET encoder; a reader must accept both forms.
- `title`, `audioFilePath`, `summaryProvider` are NOT newline-sanitized; the other optional fields are (B3).
- Line endings written are always LF. Encoding is UTF-8 without BOM.
- A record with no optional data renders to exactly: `---\nid: …\ntitle: …\nrecordedAt: …\naudioFilePath: \n---\n`.

**Header escaping.** `HoldsSectionHeaderLine` is true when, in any of Brief/Transcript/Summary/Notes/FollowUp/ProjectPlan (after `Trim` and splitting on `\n` after `\r\n` normalization), a line equals exactly one of the 8 headers. Then the frontmatter gets `headerEscaping: 1` and, in every escapable text section, each line that is "escapable" gets the suffix `" ##"` appended. A line is escapable when removing all trailing `" ##"` repeats yields exactly one of the 8 headers. So `## Summary` becomes `## Summary ##` (still valid Markdown heading text), and an already-escaped-looking `## Summary ##` becomes `## Summary ## ##` so the reader can undo one layer. Without the key, files are read literally (this keeps every older file parsing the same way).

Examples (from the tests):

| Notes input | Rendered body | Parsed back |
| --- | --- | --- |
| `Before\n## Summary\nAfter` | `Before\n## Summary ##\nAfter` plus `headerEscaping: 1` | same as input, Summary stays null |
| `A\n## Summary\nB\n## Summary ##\nC` | `…## Summary ##\nB\n## Summary ## ##\nC` | same as input |
| `Only a closed heading\n## Summary ##\nEnd` | unchanged, no key | same as input |

### 3.9 `MeetingMarkdownFormatter.Parse(path, markdown)` (exact)

1. Replace `\r\n` with `\n`, split on `\n`. A leading BOM must be stripped by the reader before this (the .NET file reader already does; Node does not).
2. Line 0 must equal `---` exactly (no trimming). Else `FormatException`.
3. Frontmatter = lines 1 up to the first line equal to `---` exactly. For each line, split at the first `:`; lines with no `:` are ignored; key and value are trimmed; later duplicates overwrite earlier ones; keys are case-sensitive. No closing `---`: `FormatException`.
4. `id` required and must parse as a GUID (any standard GUID text form accepted). `recordedAt` required and must parse as a date with offset using invariant culture; a value without offset is read as local time. Else `FormatException`.
5. `endedAt`: optional, ignored silently if blank or unparsable.
6. `title`: default empty. `summaryProvider`: raw or null.
7. `audioFilePath`: default empty; if blank or the file does not exist, and `<path with .wav>` exists, use that sibling WAV. Otherwise keep the stored text even if the file is missing.
8. `folderId`: GUID if present and valid, else null.
9. `attendees`: split on the exact token `" | "`, trim entries, drop empties. Names containing `" | "` are split wrongly (known limitation).
10. Optional fields `calendarEventId`, `calendarId`, `seriesId`, `joinUrl`, `noteTemplateId`: value or null when blank.
11. Body = lines after the closing `---`. Section extraction for a header: find the first line in the body equal to that header (exact, case-sensitive, no trailing whitespace); content runs to the line before the next line that equals any of the 8 headers other than the header being read (so `## Decisions` or `### Notes` inside a summary stay inside it); join with `\n`, `Trim()`; empty content returns null; header not present returns null.
12. If frontmatter contains the key `headerEscaping` (any value), the six text sections are unescaped: for every line ending with `" ##"` whose escapable test holds, remove one trailing `" ##"`.
13. Action items: parse the section body line by line with `^\s*-\s\[( |x|X)\]\s+(.*)$`; `x`/`X` means done; text trimmed; non-matching lines ignored. Note the regex requires at least one whitespace after `]`, so `- [ ]` with no text does not match.
14. Jev: JSON-deserialize the section body with camelCase, case-insensitive names; a `JsonException` becomes `FormatException` (and then the whole meeting is dropped from lists, B4).
15. `SourcePath` is set to the path passed in. It is not a stored field.

### 3.10 Folder personality catalogs

Colors (`FolderAccent.Keys`, ordered): `blue, teal, green, amber, orange, red, purple`. Neutral brush key is any other value.

Brush colors (App.xaml): light theme `blue #2563EB`, `teal #0F766E`, `green #15803D`, `amber #B45309`, `orange #C2410C`, `red #B91C1C`, `purple #6D28D9`, `neutral #64748B`. Dark theme `blue #60A5FA`, `teal #2DD4BF`, `green #4ADE80`, `amber #FBBF24`, `orange #FB923C`, `red #F87171`, `purple #A78BFA`, `neutral #94A3B8`. High contrast uses the system highlight color for all. Fallback color if a brush is missing: `#64748B`. The Electron app should replace these with Vozella brand tokens, but the 7 keys and the neutral fallback are data and must stay.

`ResolveKey(stored, folderId)`: if `stored` equals a key ignoring case, return the canonical lowercase key. Otherwise `Keys[abs(HashCode.Combine(folderId)) % 7]`. That hash is seeded randomly per process in .NET, so the fallback color changes between runs (B1). The port must use a deterministic hash of the id and may treat this as a fix.

`NextKey(existing)`: collect non-null keys into a case-insensitive set; return the first key in order that is not in the set; if all 7 are used return `Keys[set.Count % 7]` (the set can include unknown keys, so the index can skew).

Icons (`FolderIcon.Keys`, ordered, 18): `folder, briefcase, people, home, star, heart, flag, globe, lock, calendar, mail, chat, video, book, pin, tag, education, toolbox`. Default `folder`. `ResolveKey`: case-insensitive match returns the canonical key, else `folder`. Segoe Fluent glyphs for the WinUI app: folder E8B7, briefcase E821, people E77B, home E80F, star E734, heart EB51, flag E7C1, globe E774, lock E72E, calendar E787, mail E715, chat E8F2, video E714, book E8F1, pin E718, tag E8EC, education E7BE, toolbox EC7A. The Electron app needs a bundled icon set mapped to these 18 keys (Segoe Fluent is Windows-only).

### 3.11 `FolderPathList.Flatten(folders, inboxLabel)`

Requires non-blank `inboxLabel`. First row `(null, inboxLabel)`. Then depth-first from roots: for each folder with the given parent, ordered by name using `StringComparer.CurrentCultureIgnoreCase`, emit `(folder.Id, path)` where `path` = name for roots or `parentPath + " / " + name` (space, slash, space), then recurse. Folders whose parent chain never reaches a root are not emitted (S-bug B26b).

Port note: use `Intl.Collator(locale, { sensitivity: 'accent' })` to match "ignore case, keep accents".

### 3.12 `JsonFolderRepository`

Constructor: `foldersFilePath` defaults to `<UserData>\folders.json`; the library root is `dirname(foldersFilePath)`. One instance holds a `SemaphoreSlim(1,1)` guarding all operations (instance-level, B6).

- `GetAll`: under lock, read and return; missing file: empty list.
- `GetById`: `GetAll` then first match or null.
- `Save(folder)` (upsert), under lock:
  1. Read all.
  2. `previous` = existing with same id; `previousDir = DirectoryFor(root, folders, previous.Id)` computed from the old list, or null.
  3. Replace in place if found, else append.
  4. `nextDir = DirectoryFor(root, folders, folder.Id)` from the new list.
  5. Sync directories: if `previousDir` is not null, differs from `nextDir` (case-insensitive), exists, and `nextDir` does not exist: create the parent of `nextDir`, `Directory.Move(previousDir, nextDir)`, then run `RewriteSiblingAudioPaths(nextDir)`. In every other case just `CreateDirectory(nextDir)` (so a new folder gets its directory immediately).
  6. Write the whole list to `folders.json`.
  Directory work happens before the JSON write, so a failed move leaves the JSON unchanged.
- `Delete(id)`, under lock: read all; compute the folder's directory from the list while it is still in; remove by id; if nothing was removed, return without writing; write JSON; then delete that directory only if it has no entries (IO and permission errors swallowed). The repository does not check children or meetings (the interface documents that the caller must).
- `RewriteSiblingAudioPaths(directory)`: for every `*.md` under `directory` recursively, replace the first line starting with exactly `audioFilePath: ` with `audioFilePath: <markdownPath with .wav extension>`; preserve the file's newline style (CRLF if it contained CRLF, else LF); write only if changed. This rewrites even when the line value was empty and even when no such WAV exists (B9). Used after a folder directory is moved (rename or reparent).

### 3.13 Library page view model rules (`HistoryPageViewModel`)

State: `_allMeetings`, `_allFolders`, `_folderIds` (set of ids), `_selectedFolderId` (null = Inbox), `_restoreFolderId`, `_inFolderCount`.

- `LoadAsync`: set loading; persist the selected folder's note; reload all meetings and all folders; rebuild the tree; pick the node for `_restoreFolderId ?? _selectedFolderId`, falling back to the Inbox node; apply the selection; clear loading (in `finally`). Errors from the repositories are not caught.
- `ApplySelection(node)`: set `_selectedFolderId`; tell the workspace (`PublishSelectedFolder`, which raises `ScopeChanged`); set `SelectedFolderName`; set `IsInboxSelected = node is Inbox`, `IsRealFolderSelected = !IsInboxSelected`; load the folder's note; rebuild breadcrumbs; apply the meeting filter.
- `ApplyMeetingFilter`: container = Inbox selected ? meetings that are "unfiled" : meetings whose `FolderId == selected id`. "Unfiled" = `FolderId` null or not present in the folder id set (so dangling ids appear in Inbox). Sort by `RecordedAt` descending. Count (before search) is `_inFolderCount`. If the trimmed query is non-empty, keep meetings whose `Title` contains it (ordinal ignore case). Replace the displayed collection. `HasMeetings = displayed.Count > 0`. Refresh empty flags.
- `CreateFolder(name)`: trim; empty returns false. Persist note. New record: `Id = new GUID`, `Name = trimmed`, `ParentId = _selectedFolderId`, `ColorKey = NextKey(all folders' ColorKey)`, `IconKey` null, `Note` null, `CreatedAt = now` (local offset). Save, set restore id to the new id, reload, clear restore id. No duplicate-name check, no length or character validation (B7).
- `RenameSelectedFolder(name)`: requires a selected real folder that still exists in the snapshot; trim; empty returns false. Persist note. Set `folder.Name` on the in-memory record before saving (B13), save, reload with restore id = folder id.
- `UpdateSelectedFolderPersonality(colorKey, iconKey)`: persist note; `ColorKey = ResolveKey(colorKey, id)`, `IconKey = ResolveKey(iconKey)`; save; reload with restore.
- `CanDeleteSelectedFolder(out reason)`: false with empty reason when Inbox is selected; true when no child folders and no meetings with that folder id in the snapshot; otherwise false with reason `LibraryDeleteFolder_NotEmpty`.
- `DeleteSelectedFolder`: `_folders.Delete(id)`; clear restore and selection; `Workspace.PublishSelectedFolder(null)`; reload. It does not re-check `CanDelete` (B26).
- `DeleteAsync(meetingId)`: see 2.16.
- `MoveMeeting(meetingId, folderId)`: `GetById`; null returns silently; set `FolderId`; `Save`; reload with restore = current selection.
- `GetMoveDestinations()`: `Flatten(_allFolders, "Inbox" label)`.
- `PersistSelectedFolderNote`: no-op if Inbox selected or the folder is not in the snapshot; `note = trimmed text or null`; if equal (ordinal) to the stored note, no-op; else set it and save the folder (which re-runs the directory sync, creating the directory if it is missing).

### 3.14 When the note is persisted

On: `LoadAsync` start, `SelectFolder`, `CreateFolder`, `Rename`, `UpdatePersonality`, page navigate-away, and page Unloaded. Never on a timer and not on window close (B16).

### 3.15 Snippet (`MeetingSnippet`, shared with the Session/Summary module)

`From(summary, transcript)`: if `summary` is not whitespace use `FromMarkdown(summary)`, else `FromMarkdown(transcriptBody)`. Transcript body: split into committed transcript lines (cross-module `CommittedTranscriptLine`), skip header lines, keep only each line's spoken text (drops `Recorded`/`Ended` headers, elapsed stamps, speaker tags), skip empty, join with `\n`.

`FromMarkdown`: blank returns empty. Normalize line endings to `\n`. For each line: `isHeading` = trimmed line starts with 1 to 6 `#` followed by whitespace or end; strip markers (remove the leading `#`s and following whitespace for headings; remove `` ``` ``, `**`, `__`, `` ` ``, `*`, `_`; trim); skip empty lines; append to the body buffer, or to the headings buffer if it was a heading, separated by a single space. Use the body buffer if non-empty, otherwise the headings buffer. Collapse any whitespace run to one space, trim. If longer than 140 characters, cut to 140 and append `…` (U+2026). Result max length 141.

### 3.16 Migrations

All are idempotent and non-destructive where stated. Use a temp root in tests.

**UserDataLocationMigrationService.MigrateIfNeeded()** (synchronous, runs every launch)

1. If legacy and new paths are all equal, return (never true on a real install).
2. Create `<UserData>\Meetings` and `<UserData>\Recordings` (B11).
3. Move every file (top level only, no recursion) from `<Root>\Meetings` to `<UserData>\Meetings`, and from `<Root>\Recordings` to `<UserData>\Recordings`. A file whose destination already exists is skipped and left in place (never overwritten).
4. Move `<Root>\folders.json` to `<UserData>\folders.json` if the source exists and the destination does not.
5. For each `*.md` directly in `<UserData>\Meetings`: if its first `audioFilePath: ` line (prefix exact) holds a path under `<Root>\Recordings` (full-path prefix test, case-insensitive, separator-terminated), rewrite that line to `<UserData>\Recordings\<file name>`. Only that first line is considered; if the first such line is not under the legacy directory the scan stops. The file is rewritten with `\n` newlines.
6. Delete `<Root>\Meetings` and `<Root>\Recordings` if empty (IO and permission errors swallowed).

**MeetingLibraryLayoutMigrationService.MigrateIfNeededAsync()**

1. If `<UserData>\Meetings` does not exist, return.
2. List `*.md` directly in it (top level). If none: delete `<UserData>\Meetings` and `<UserData>\Recordings` when empty; return.
3. Touch the folder repository once (`GetAll`).
4. For each file: parse; `FormatException` skips that file only. If the record's `AudioFilePath` is blank or missing on disk, and `<UserData>\Recordings\<id>.wav` (GUID in lowercase "D" form) exists, use it. Then `meetings.Save(record)`, which places md and WAV in the right Library directory with a dated stem and deletes the legacy md (3.6 step 11).
5. Delete the two legacy directories if empty.

IO errors are not caught per file; the first one aborts the run and reaches the startup error handler.

**MeetingsMigrationService.MigrateIfNeededAsync()** (legacy `meetings.json`)

1. If `<Root>\meetings.json` does not exist, return.
2. Load all legacy records (JSON array, see 4.5). A corrupt file throws and the migration repeats on each launch.
3. Load existing meetings from the repository; for every legacy record whose id is not present, `Save` it. Existing ones are left alone because they may hold newer edits.
4. Rename `meetings.json` to `meetings.json.bak`; if that exists use `.bak.1`, `.bak.2`, ... (first free). Never delete it; never overwrite.

### 3.17 `AppSettingsService` and `AppSettings`

- `Load`: under a process-wide lock; missing file returns defaults; otherwise deserialize (camelCase, case-insensitive property names, unknown properties ignored, numbers in strings accepted). A null result returns defaults. A corrupt file throws (B5).
- `Save`: under the same lock: `EnsureDirectoriesExist()`, then overwrite the file with the indented JSON.
- The lock covers one call, not a load-modify-save sequence (B17). There are 9 `SaveAsync` call sites in the App project.

Fields, defaults, and resolvers (JSON names are camelCase of the C# names):

| Field | Type | Default | Resolver / meaning |
| --- | --- | --- | --- |
| `selectedSummaryModelId` | string? | null | file name of the chosen local GGUF |
| `selectedSummaryProvider` | string? | null | enum name: `Local`, `ClaudeCode`, `Codex`, `Xai`. `ResolveSummaryProviderKind`: case-sensitive parse, unset/unrecognized -> `Local`. Numeric text also parses (B18) |
| `selectedXaiModelId` | string? | null | no default constant in code |
| `selectedXaiEffort` | string? | null | blank -> `low`; allowed `none, low, medium, high, xhigh` |
| `selectedClaudeModelId` | string? | null | blank -> `sonnet`; catalog `sonnet, opus, haiku, fable` |
| `selectedClaudeEffort` | string? | null | blank -> `low`; allowed `low, medium, high, xhigh, max` |
| `selectedCodexModelId` | string? | null | blank -> `gpt-5.6`; catalog `gpt-5.4, gpt-5.5, gpt-5.6, gpt-5.6-sol` |
| `selectedCodexEffort` | string? | null | blank -> `low`; allowed `low, medium, high, xhigh` |
| `transcriptionLanguage` | string? | null | blank -> `es` |
| `summaryLanguage` | string? | null | blank -> `es` |
| `selectedMicrophoneDeviceId` | string? | null | blank = OS default input |
| `recordMicrophoneKind` | string? | null | `None`, `SystemDefault`, `Device` |
| `recordMicrophoneDeviceId` | string? | null | |
| `recordOutputKind` | string? | null | `System`, `App` |
| `recordAppExePath` | string? | null | |
| `recordAppName` | string? | null | informational |
| `liveTranscriptionEnabled` | bool | true | |
| `speakerDiarizationEnabled` | bool | false | |
| `typeSafeEnabled` | bool | true | |
| `calendarNotificationsEnabled` | bool | true | |
| `meetingPopupEnabled` | bool | true | |
| `disabledCalendarIds` | string[] | `[]` | `DisabledCalendarIdsAsSet`: drops blank entries, ordinal comparison, empty result is the shared empty set |
| `uiLanguage` | string? | null | BCP-47 tag; null follows the system |
| `navigationPaneLength` | double? | null | `ResolveNavigationPaneLength`: null -> 280; otherwise clamp to [200, 480] |
| `liveCopilotPillX` / `liveCopilotPillY` | int? | null | superseded, no longer read |
| `liveCopilotPillEdge` | string? | null | `Left`, `Right`, `Top`, `Bottom`; unrecognized or null -> `Right` |
| `liveCopilotPillAlong` | double? | null | clamp to [0, 1]; null or non-finite -> 0.5 |

The booleans with default `true` stay `true` when the JSON field is missing. `false`-default booleans stay `false`. Other modules own the semantics; this module owns the file.

---

## 4. Persistence and wire formats

### 4.1 Meeting markdown (`<Library>\<folders…>\<yyyy-MM-dd> <title>[ n].md`)

Full example with every field:

```
---
id: 3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d
title: Weekly sync: planning
recordedAt: 2026-09-01T12:00:00.0000000-05:00
endedAt: 2026-09-01T13:45:00.0000000-05:00
audioFilePath: C:\Users\ana\Documents\MeetingLive\Universidad\2026-09-01 Weekly sync planning.wav
folderId: 7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b
summaryProvider: local
calendarEventId: AAMkAGI2
calendarId: cal-1
seriesId: series-9
joinUrl: https://teams.microsoft.com/l/meetup-join/abc
noteTemplateId: one-on-one
attendees: Ana Perez | Luis Gomez
---

## Brief

Last meeting ended with two open questions.

## Transcript

[00:00:03] Ana: Hello everyone.

## Summary

### Notes
Hello

## Decisions
Ship it

## Action Items

- [ ] Follow up with Luis
- [x] Send the notes

## Jev

{"meetingType":"standup","meetingTypeConfidence":0.85,"spokenLanguage":"en","urgencyScore":1,"urgencyConfidence":0.9,"containsDecisions":0.8,"containsCommitments":0.2,"piiRisk":0.01,"summaryFaithful":0.7,"suggestedFolderId":"inbox","folderConfidence":0.5,"actionItems":[{"text":"Follow up","relation":"supports","confidence":0.88}],"model":"jev-1.13.0","analyzedAt":"2026-09-01T13:00:00+00:00"}

## Personal Notes

Remember the exam date.

## Follow-up

Subject: recap

## Project plan

### Steps
Ship
```

Minimal example (byte exact; the empty `audioFilePath: ` keeps its trailing space):

```
---
id: 11111111-1111-1111-1111-111111111111
title: Standup
recordedAt: 2026-09-01T12:00:00.0000000+00:00
audioFilePath: 
---
```

Notes for implementers:

- `recordedAt` and `endedAt` use the .NET round-trip `O` format: seven fractional digits and a numeric offset, `+00:00` rather than `Z`. A reader should accept both. A writer should emit the same shape to keep diffs small.
- The `audioFilePath` value is an absolute Windows path. It is stored absolute, so a library moved to another machine relies on the sibling-WAV fallback in 3.9 step 7. The port should keep writing absolute paths for compatibility with the WinUI app, and keep the fallback.
- Section bodies are separated by exactly one blank line before each header (the `\n` before the header), and the file ends with a single `\n`.
- Transcript line shape inside `## Transcript` belongs to the transcription module.
- Legacy flat files `Meetings\{guid}.md` use the same format.

### 4.2 `folders.json`

JSON array, camelCase, indented with 2 spaces, `null` written for unset optionals, GUIDs as lowercase hyphenated strings, dates as ISO 8601 with offset (trailing fractional zeros trimmed). Written with the .NET default encoder, so non-ASCII characters and `<`, `>`, `&`, `'`, `+` appear as `\uXXXX`; readers must accept both. Line endings are CRLF on Windows (`Environment.NewLine`); readers must accept LF. No BOM.

```json
[
  {
    "id": "7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b",
    "name": "Universidad",
    "parentId": null,
    "note": "Fall term",
    "colorKey": "teal",
    "iconKey": "education",
    "createdAt": "2026-09-01T12:00:00-05:00"
  },
  {
    "id": "0b8e6f31-5c2a-4d77-9e10-aa11bb22cc33",
    "name": "Calculo",
    "parentId": "7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b",
    "note": null,
    "colorKey": "blue",
    "iconKey": null,
    "createdAt": "2026-09-02T09:30:00.1234567-05:00"
  }
]
```

Reading rules: property names are matched case-insensitively; unknown properties are ignored; `id`, `name`, `createdAt` are required (a missing one is an error). `colorKey` and `iconKey` may hold any text; consumers resolve unknown values to the default.

### 4.3 `settings.json`

Same JSON conventions as 4.2. The serializer writes every property, including nulls, in declaration order:

```json
{
  "selectedSummaryModelId": null,
  "selectedSummaryProvider": "Local",
  "selectedXaiModelId": null,
  "selectedXaiEffort": null,
  "selectedClaudeModelId": null,
  "selectedClaudeEffort": null,
  "selectedCodexModelId": null,
  "selectedCodexEffort": null,
  "transcriptionLanguage": "es",
  "summaryLanguage": "es",
  "selectedMicrophoneDeviceId": null,
  "recordMicrophoneKind": null,
  "recordMicrophoneDeviceId": null,
  "recordOutputKind": null,
  "recordAppExePath": null,
  "recordAppName": null,
  "liveTranscriptionEnabled": true,
  "speakerDiarizationEnabled": false,
  "typeSafeEnabled": true,
  "calendarNotificationsEnabled": true,
  "meetingPopupEnabled": true,
  "disabledCalendarIds": [],
  "uiLanguage": null,
  "navigationPaneLength": 280,
  "liveCopilotPillX": null,
  "liveCopilotPillY": null,
  "liveCopilotPillEdge": null,
  "liveCopilotPillAlong": null
}
```

The WinUI app drops unknown keys the next time it saves (B17). The Electron app should preserve unknown keys it reads, and should only add new keys that WinUI can ignore.

### 4.4 Directory and file-name examples

| RecordedAt | Title | Folder chain | Result |
| --- | --- | --- | --- |
| `2026-09-01T12:00:00+00:00` | `Standup` | none | `Inbox\2026-09-01 Standup.md` |
| same | `Standup` (again, same folder) | none | `Inbox\2026-09-01 Standup 2.md` |
| `2026-09-02T08:00:00-05:00` | `Q3: plan/review?` | `Universidad` > `Calculo` | `Universidad\Calculo\2026-09-02 Q3 plan review.md` |
| any | `` (empty) | none | `Inbox\<date> Meeting.md` |
| any | `Inbox` as folder name | root | directory `Inbox folder\` |

### 4.5 Legacy formats read by migrations

`<Root>\meetings.json`: a JSON array of meeting objects with the same camelCase names as `MeetingRecord` (`id, title, recordedAt, endedAt, audioFilePath, sourcePath, transcript, summary, summaryProvider, folderId, notes, actionItems[{text,isDone}], jevAnalysis, calendarEventId, calendarId, seriesId, joinUrl, attendees[], brief, noteTemplateId, followUp, projectPlan`). `id`, `title`, `recordedAt`, `audioFilePath` are required. Example:

```json
[
  {
    "id": "3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d",
    "title": "Standup",
    "recordedAt": "2026-08-30T10:00:00-05:00",
    "audioFilePath": "C:\\Users\\ana\\AppData\\Local\\MeetingLive\\Recordings\\3f2b….wav",
    "transcript": "…",
    "summary": "…",
    "actionItems": [ { "text": "Follow up", "isDone": false } ]
  }
]
```

`<Root>\Meetings\{guid}.md` and `<Root>\Recordings\{guid}.wav` (first generation), and `<UserData>\Meetings\*.md` plus `<UserData>\Recordings\{guid}.wav` (second generation) use the markdown format in 4.1 and a flat layout.

### 4.6 In-memory workspace (not persisted)

`WorkspaceService` holds: `SelectedMeetingId`, `LastProcessedMeeting`, `SessionTab` (`Transcript` or `Summary`, default `Transcript`), `CurrentShellTag` (`Recording` default; one of `Recording`, `History`, `Settings`, `Session`), `SelectedFolderId` (null = Inbox), `LiveTranscript`, `IsCaptureActive`, plus the pending take-notes request.

Rules:

- `ScopeChanged` fires on: shell tag change (only if different), folder publish (always), selected meeting id change (only if different), capture-active change (only if different). Live transcript text alone never fires it.
- `SetCurrentShellTag` and `NavigateTo` throw on any tag outside the four. `NavigateTo` also throws for `Transcript` and `Summary` (those are session tabs). `SetSessionTab` throws on anything but those two. `OpenSession(tab)` = set tab, then navigate to `Session`.
- `ClearSelection`: clears `LastProcessedMeeting` if it is the selected meeting, then clears the selection.
- `NotifyDeleted(id)`: clears `LastProcessedMeeting` if it matches, clears selection if it matches, then raises `MeetingDeleted(id)`.
- `SetLastProcessed(record)`: store the record and select its id.
- `NotifyMeetingChanged(id)` raises `MeetingChanged(id)`.
- `RequestTakeNotes(calendarEventId?)`: stores a blank-normalized event id and a pending flag, raises `TakeNotesRequested`, then navigates to `Recording`. `ConsumeTakeNotes(out id)` returns the pending flag, always returns and clears the stored event id, clears the flag; when no request is pending the out id is null and the result is false.
- `OfferCallPrompt` raises `CallPromptOffered`.
- `NavigationRequested` carries the tag; only the shell (MainPage) navigates the content frame.

---

## 5. Native and OS dependencies

| Item | Portability | Port note |
| --- | --- | --- |
| Windows Documents folder (`Environment.SpecialFolder.MyDocuments`), OneDrive redirection | Portable with care | `app.getPath('documents')` |
| `%LOCALAPPDATA%` | Windows-only | `process.env.LOCALAPPDATA`; on macOS use `~/Library/Application Support/MeetingLive` behind a path interface |
| File name rules (`GetInvalidFileNameChars`, case-insensitive compare `OrdinalIgnoreCase`) | Windows semantics | Fix the Windows rule set in code; compare paths case-insensitively on Windows and macOS default volumes |
| Open folder in file manager (`ProcessStartInfo` with `UseShellExecute`) | Windows-only call, portable concept | `shell.openPath` |
| MSIX `Package.Current.Id.Version` | Windows-only | `app.getVersion()`; fallback `1.0.0.0` |
| Segoe Fluent glyphs for folder/menu icons | Windows-only font | bundle SVG icons for the 18 folder keys and the menu icons |
| Theme brushes `FolderAccent*Brush` | WinUI-only | map the 7 keys plus neutral to design tokens |
| Culture-aware sorting and `"g"` date format | Portable | `Intl.Collator`, `Intl.DateTimeFormat(locale, {dateStyle:'short', timeStyle:'short'})` |
| `SemaphoreSlim` locks | Portable concept | one in-process async mutex per file |
| `HashCode.Combine` | .NET-only, non-deterministic | replace with a fixed hash |
| `Directory.Move` | Portable | same-volume rename; behaves differently when the target exists |
| WAV locking by the recorder | Windows file-sharing semantics | deletes and moves of an open WAV fail with `EBUSY`/`EPERM`; map to the same status message |
| `DispatcherQueue`, `ContentDialog`, `TreeView`, `BreadcrumbBar`, `InfoBar` | WinUI-only | replace with web components |
| Native UI automation ids | Test-only | keep as `data-testid` values |

---

## 6. Existing test coverage (`MeetingLive.Core.Tests`)

There are no tests for `HistoryPageViewModel`, `FolderNode`, `WorkspaceService`, `DataFolderSectionViewModel`, `AppSettingsService`, `LegacyJsonMeetingRepository`, or `FolderPersonalityPicker`. Everything below must carry over, and the gaps listed in 6.2 need new tests.

### 6.1 Test classes and cases to port

`Services/MarkdownMeetingRepositoryTests`

- Save with a root override does not write to `AppPaths`.
- Delete removes markdown and WAV.
- Delete of an already-gone meeting does not throw.
- Delete with a missing WAV still removes the markdown.
- Delete with a locked WAV throws and keeps the meeting so it can be retried.
- Summary containing `##` headings (`## Decisions`) round-trips fully.
- Null folder omits `folderId`; set folder round-trips.
- Null `endedAt` omitted; set `endedAt` round-trips; legacy file without `endedAt` parses with null.
- Notes round-trip as `## Personal Notes`; legacy file without folder or notes parses with nulls.
- Summary with Decisions plus Personal Notes round-trips both.
- A corrupt file does not hide the readable meetings in `GetAll`.
- Delete does not rewrite sibling meetings.
- Changing the folder moves markdown and WAV together and updates `AudioFilePath` and `FolderId`.
- Calendar fields round-trip, and are omitted when unset.

`Services/MeetingMarkdownFormatterTests`

- Round trip of all fields.
- Optional fields and sections omitted when empty.
- Brief, template id, follow-up, project plan round-trip and are omitted when empty.
- Calendar link round-trip; file without calendar fields parses with them unset.
- Jev analysis round-trip (no `apiKey` or secret text in output).
- Missing opening delimiter and missing id throw `FormatException`.
- Header lines inside notes (theory over each header) keep every line and invent no section.
- Every text section holding header lines stays unchanged.
- Trimming that exposes a header line keeps the line.
- CRLF bodies still protect header lines.
- Content that already looks escaped (3 theory cases) is unchanged.
- An escaped header renders as `## Summary ##`.
- Byte-for-byte render of an existing-format file (the full sample at `MeetingMarkdownFormatterTests.cs:335-359`).
- An existing file with a header line in notes is still split the old way.

`Services/MeetingLibraryLayoutTests`: `DirectoryFor(null)` is Inbox; nested folders join sanitized names; `FileStem` uses the offset date and sanitized title; reserved `Inbox` becomes `Inbox folder`.

`Services/MeetingLibraryLayoutMigrationServiceTests`: legacy GUID md plus WAV in `Recordings` end up in `Inbox` with a dated stem and sidecar WAV; legacy md removed; legacy directory removed; `AudioFilePath` updated.

`Services/MeetingsMigrationServiceTests`: missing legacy file does nothing; first run saves every record and renames to `.bak`; re-run after partial failure keeps later edits and migrates the missing ones; existing `.bak` is kept and a new backup gets the next free suffix; several backups use the next free name.

`Services/UserDataLocationMigrationServiceTests`: moves meetings, recordings, folders and rewrites `audioFilePath`; does not overwrite an existing destination; idempotent when already migrated; `RewriteAudioFilePathLine` rewrites a legacy path and leaves a new path alone.

`Services/JsonFolderRepositoryTests`: root override does not write to `AppPaths`; save creates the directory; rename moves the directory; save then `GetById` round-trips; upsert on an existing id; delete removes; delete of a gone folder does not throw; missing file returns empty.

`Services/FolderAccentTests`: known stored key returns canonical key; a missing key is stable for the same id (only within one process, which is why B1 slipped through); `NextKey` skips used colors.

`Services/FolderIconTests`: known key canonical; missing returns `folder`; unknown returns `folder`; every key has a non-empty glyph; missing uses the default glyph.

`Services/FolderPathListTests`: empty folders give Inbox only; roots sorted after Inbox; nested joined with ` / `.

`Services/AppPathsTests`: Inbox, Meetings, Recordings, and folders file are under Documents; settings and xAI credentials under LocalAppData.

`Services/MeetingSnippetTests`: summary preferred over transcript; transcript fallback strips headers, stamps, speaker tags; both empty returns empty; headings, emphasis, backticks stripped; heading-only keeps heading text; whitespace collapsed; truncation to `MaxLength` with ellipsis; short text unchanged.

`Models/AppSettingsTests`: transcription language default `es` and pinned values; summary language default `es` and `en`; navigation pane length default and clamp; `SpeakerDiarizationEnabled` default false and when JSON omits it; `TypeSafeEnabled`, `CalendarNotificationsEnabled`, `MeetingPopupEnabled` default true, true when omitted, round-trip false; `DisabledCalendarIds` default empty and round-trip with blanks dropped; removed provider keys in JSON load and are ignored; live copilot pill position null when unset, round-trips negative coordinates; dock edge default/`Right` fallback, round-trip, `Along` clamp.

### 6.2 New tests the port needs (uncovered today)

- Frontmatter edge cases: title containing a newline, `---` inside a title, BOM at file start, CRLF file, duplicate keys, key without value, `recordedAt` without offset.
- Two files with the same id (flat dump vs Library; two Library files).
- First save of a new recording whose WAV already sits at the stem (B2).
- Folder rename to an existing sibling name; case-only rename; duplicate sibling names; names that sanitize to the same directory.
- Folder named `Meetings`, `Recordings`, or a Windows device name.
- `RewriteSiblingAudioPaths` for a meeting with no audio.
- Corrupt `folders.json` and corrupt `settings.json`.
- Concurrent save of the same meeting; concurrent folder saves through two instances.
- Library view model: filter, empty flags truth table, expansion, restore selection, move, delete busy and failed paths, note persistence rules, `CanDelete`.
- Workspace: `ScopeChanged` firing rules, tag validation, take-notes consume semantics.
- Hash replacement for folder color is deterministic across runs.

---

## 7. Bugs, races, and uncovered cases

C = confirmed (read directly from code, or provable by trace), S = suspected (depends on conditions I did not execute). No code was run for this spec.

| ID | Status | Finding | Evidence |
| --- | --- | --- | --- |
| B1 | C | `FolderAccent.ResolveKey` is documented as stable but uses `HashCode.Combine(Guid)`, whose seed is random per process. A folder with no stored color changes color on every launch. The test only checks stability inside one process. Also `Math.Abs(int.MinValue)` throws `OverflowException` if the hash is `int.MinValue` (S). | `FolderAccent.cs:19`, `FolderAccentTests.cs:16` |
| B2 | C (trace) | A freshly recorded meeting is renamed on first save. The recorder creates the WAV at `stem.wav` (stem allocated with `idFromMarkdownPath = _ => null`) before any markdown exists. `Save` then asks for a stem: `stem.md` does not exist, but `stem.wav` does, so n=1 is rejected and `stem 2` is chosen; the WAV is moved to `stem 2.wav` and the markdown is `stem 2.md`. A linked meeting that already has a markdown of the same id is not affected. | `RecordingPageViewModel.cs:1242,1896-1906`; `MeetingLibraryLayout.cs:69-75`; `MarkdownMeetingRepository.cs:70,79` |
| B3 | C | `title`, `audioFilePath`, `summaryProvider` are written raw. A title with `\n` splits the frontmatter; a title containing a line `---` closes it early and makes the file fail to parse, so the meeting disappears from the list. Other optional fields use `FrontmatterValue`. | `MeetingMarkdownFormatter.cs:51,55,59` vs `:278,288` |
| B4 | C | Any `FormatException`, including an invalid `## Jev` JSON block, drops the whole meeting (transcript and summary included) from `GetAll`, silently. A partial parse that keeps the rest would avoid data that looks lost. | `MeetingMarkdownFormatter.cs:195-197`; `MarkdownMeetingRepository.cs:44-47` |
| B5 | C | Writes are not atomic: markdown, `folders.json`, and `settings.json` are truncated and then written. A crash mid-write leaves a corrupt file. Corrupt `folders.json` or `settings.json` throws a `JsonException` that no caller catches, which breaks Save for every meeting (folders are read first) and breaks Library load. | `MarkdownMeetingRepository.cs:84`; `JsonFolderRepository.cs:98,108`; `AppSettingsService.cs:25,40` |
| B6 | C | Two `JsonFolderRepository` instances (and two locks) guard the same file: `AppServices.Folders` and the private one `MarkdownMeetingRepository` creates when no folder repository is passed. A read in `Save` can overlap a truncating write. `MarkdownMeetingRepository` itself has no lock at all, so two saves of one meeting can interleave. Whether the race window is reachable in practice is S. | `AppServices.cs:59,63`; `MarkdownMeetingRepository.cs:22`; `JsonFolderRepository.cs:14` |
| B7 | C | Folder names are not validated. Duplicate sibling names, names differing only by case, and names that sanitize equal (`A/B`, `A:B`) all map to the same directory, so their meetings share a directory and a rename or move of one can leave the other's files behind. Renaming onto an existing directory name skips the move and only creates the directory; a case-only rename never changes the directory's case. | `HistoryPageViewModel.cs:120-139`; `MeetingLibraryLayout.cs:79-101`; `JsonFolderRepository.cs:114-130` |
| B8 | C (a, b), S (c) | `SanitizeName` gaps. (a) `Trim()` runs before `TrimEnd('.')`, so `"abc ."` becomes `"abc "` with a trailing space that Windows drops. (b) Truncation to 80 UTF-16 units can cut a surrogate pair. (c) Windows device names (`CON`, `NUL`, `COM1`, `LPT1`, with or without extension) are not handled; a folder with that name probably fails or misbehaves on `CreateDirectory`. | `MeetingLibraryLayout.cs:90-92` |
| B9 | C | `RewriteSiblingAudioPaths` rewrites `audioFilePath` for every markdown under the moved directory, including meetings with no audio (empty value) or audio stored elsewhere. The value becomes a path to a WAV that does not exist, so `AudioFilePath` is non-empty and stale after the next parse. | `MeetingLibraryLayout.cs:144-156` |
| B10 | C | A Library folder named `Meetings` or `Recordings` collides with the legacy directories: `IsLegacyFlatDump` lowers its meetings' priority in duplicate resolution, and `MeetingLibraryLayoutMigrationService` treats every markdown in `Library\Meetings` as a leftover and re-saves it at every launch. A file there with no `folderId` would also be moved to Inbox (S). | `MarkdownMeetingRepository.cs:147-157`; `MeetingLibraryLayoutMigrationService.cs:43-76` |
| B11 | C | `UserDataLocationMigrationService` creates `Library\Meetings` and `Library\Recordings` on every launch (the legacy and new paths never match), and the layout migration then deletes them again if empty. Orphan WAVs left in `Recordings` keep that directory forever. | `UserDataLocationMigrationService.cs:46-54`; `MeetingLibraryLayoutMigrationService.cs:46-52` |
| B12 | S | If a legacy markdown remains next to an already migrated copy of the same id (for example after a crash between writing the new file and deleting the old one), the layout migration re-saves the legacy content over the newer file and never deletes the legacy file, so it repeats each launch and can overwrite edits. | `MeetingLibraryLayoutMigrationService.cs:62-76`; `MarkdownMeetingRepository.cs:70-91` |
| B13 | C | Handlers for new folder, rename, personality, and move are `async void` (or call into them) with no exception handling: a locked folder or WAV (`Directory.Move`, `File.Move`) throws `IOException` on the UI thread. Move does not check `IsMeetingBusy`. Rename mutates the in-memory `FolderRecord` before saving, so after a failed save the snapshot disagrees with disk until the next reload. | `HistoryPage.xaml.cs:163,247-288`; `HistoryPageViewModel.cs:156,240-251` |
| B14 | C | After every reload the tree rebuilds with only the target's ancestors expanded, so folders the user expanded collapse after any create, rename, move, or delete. The tree control's selection is not set from the view model (S). | `HistoryPageViewModel.cs:288-326` |
| B15 | C | A search with no matches shows an empty list and no message; the empty flags ignore the search filter. | `HistoryPageViewModel.cs:379-385` |
| B16 | C (pattern), S (loss) | The folder note is saved only on selection change or page exit, and always fire-and-forget; closing the app or a crash while the box is focused loses it. | `HistoryPage.xaml.cs:24,36`; `HistoryPageViewModel.cs:103-118` |
| B17 | C | `AppSettingsService` locks one call at a time, but callers load, change one field, and save the whole object. Two callers working from stale copies overwrite each other's fields. Unknown keys are dropped on save. | `AppSettingsService.cs:11-14,34-47` |
| B18 | C | `Enum.TryParse` on `selectedSummaryProvider` accepts numeric text such as `"99"` and returns an undefined enum value instead of `Local`. | `AppSettings.cs:49-50` |
| B19 | C | `Find`, `AllocateFileStem` (through `TryReadId`), and therefore every Save, Delete, and GetById, parse every markdown in the tree. Cost is O(files) per operation; a 5,000-meeting library does thousands of reads per save. | `MarkdownMeetingRepository.cs:115-145` |
| B20 | C | Two non-legacy files with the same id: whichever the file system enumerates first wins in `GetAll` and `Find`; a copied file silently shadows or is shadowed. | `MarkdownMeetingRepository.cs:38-41,121-130` |
| B21 | C | Whitespace-only transcript, summary, or notes writes an empty header; the other text sections skip it. Re-reading gives null, so the output flips between forms. | `MeetingMarkdownFormatter.cs:74-78,98-102` vs `:228-235` |
| B22 | S | Action item text with a newline, or a line that equals a section header, is written raw and is not covered by header escaping; it can inject or truncate a section. | `MeetingMarkdownFormatter.cs:86-90`; `ActionItemParser.cs:51` |
| B23 | S | `Save` moves the WAV, writes the new markdown, then deletes the old one. A crash between steps leaves the old markdown pointing at a moved WAV, or two markdown files with one id. | `MarkdownMeetingRepository.cs:79-91` |
| B24 | C | Sorting uses the current culture, so folder order and the move list differ by machine language. | `FolderPathList.cs:28`; `HistoryPageViewModel.cs:319,324` |
| B25 | S | `Delete` removes whatever file `audioFilePath` names. Imports are converted into the Library, so this is safe today, but a hand-edited or old `audioFilePath` outside the Library would delete a user file. | `MarkdownMeetingRepository.cs:105-106`; `RecordingPageViewModel.cs:1413` |
| B26 | C (a), S (b) | (a) Delete-folder checks emptiness on a snapshot and does not re-check; meetings filed there after the last load are left with a dangling `folderId` (they show in Inbox but their files remain in the old directory until the next save). (b) A folder whose parent no longer exists appears in neither the tree nor the move list, and its meetings (not unfiled, since their folder exists) are invisible. | `HistoryPageViewModel.cs:183-208,290-326,387-388`; `FolderPathList.cs:24-34` |
| B27 | C | Every Delete/GetById/Save needs `folders.json` readable; `MeetingLibraryLayoutMigrationService` also calls `GetAll` on folders but ignores the result. Not harmful, just dead work. | `MeetingLibraryLayoutMigrationService.cs:54` |
| B28 | C | Library load reads and parses the full transcript and summary of every meeting only to show title, date, and a 140-character snippet. | `MarkdownMeetingRepository.cs:25-51` |

Confirmed: 24 entries (B1-B7, B8 a and b, B9-B11, B13-B21, B24, B26a, B27, B28; B16 counted for the pattern).

Suspected entries: B12, B22, B23, B25, plus the sub-cases B1 (Math.Abs), B6 (race window), B8c, B10 (move to Inbox), B14 (tree selection), B16 (loss), B26b.

Recommended handling in the port: fix B1, B2, B3, B5, B7, B9, B13, B14, B15, B17, B18, B19 (index metadata in memory, invalidate on write), B20 (deterministic tie-break by newest file), B21, B24. Keep behavior for B10 only after deciding whether `Meetings`/`Recordings` become reserved library folder names (sanitize to `Meetings folder`, like Inbox).

---

## 8. Parity checklist

Tick each item when the Electron app matches the behavior (or the listed fix) and a test covers it.

### Paths and layout

1. Library root is `<Documents>\MeetingLive`; app data root is `%LOCALAPPDATA%\MeetingLive`; both keep the `MeetingLive` name.
2. `Inbox` directory is `<Library>\Inbox`; `folders.json` is in the Library root; `settings.json` is in the app data root.
3. `EnsureDirectoriesExist` creates Inbox, TranscriptionModels, NemoSpeech, SummaryModels and deletes `WhisperModels` and `Models\ggml-base.bin` best-effort.
4. Library root is injectable so tests and development use an isolated folder.
5. Folder directory = sanitized names of the chain root-to-folder; chain limited to 64 steps; missing parent yields a partial path; empty chain yields Inbox.
6. Meetings with null or unknown `folderId` go to Inbox.
7. The directory tree is a write-only mirror; the frontmatter `folderId` decides the folder when reading.
8. `SanitizeName` follows the 8 steps in 3.3 (Windows invalid set, collapse spaces, trim, trim dots, cap 80, empty -> `Meeting`, `Inbox` -> `Inbox folder`).
9. `FileStem` is `YYYY-MM-DD <title>` using the record's own offset date.
10. `AllocateFileStem` appends ` 2`, ` 3`, ... and reuses a stem whose markdown has the same meeting id.
11. A WAV owned by the saving meeting does not cause a ` 2` suffix (B2 fix).

### Meeting markdown writing

12. Frontmatter starts with `---\n` and ends with `---\n`; LF line endings; UTF-8 without BOM.
13. Frontmatter key order is id, title, recordedAt, endedAt, audioFilePath, folderId, summaryProvider, calendarEventId, calendarId, seriesId, joinUrl, noteTemplateId, attendees, headerEscaping.
14. `id` is lowercase hyphenated; `recordedAt` and `endedAt` use the round-trip format with seven fraction digits and numeric offset.
15. `audioFilePath:` is always written, including an empty value with the trailing space.
16. `endedAt`, `folderId`, `summaryProvider` are omitted when null/empty.
17. The five optional string fields are omitted when blank and have newlines replaced by a space.
18. `attendees` is one line joined by ` | `, omitted when empty, names newline-free.
19. `title`, `audioFilePath`, `summaryProvider` have CR/LF replaced by a space (B3 fix).
20. Section order is Brief, Transcript, Summary, Action Items, Jev, Personal Notes, Follow-up, Project plan.
21. Each section is `\n## Header\n\n` + body + `\n`; the file ends with a single `\n`.
22. Brief, Follow-up, Project plan are skipped when whitespace-only; Transcript, Summary, Notes are skipped when empty (and whitespace-only content is also skipped, B21 fix).
23. Text bodies are trimmed before writing.
24. Action items render as `- [ ] text` / `- [x] text`, one per line.
25. Jev renders as a single line of compact camelCase JSON under `## Jev`.
26. Header escaping: when a text section has a line equal to a section header, write `headerEscaping: 1` and append ` ##` to every escapable line in all six text sections.
27. A render of a file with no header lines in content is byte-identical to the legacy format (golden test from `MeetingMarkdownFormatterTests.cs:335-359`).

### Meeting markdown reading

28. Reader strips a leading BOM and normalizes CRLF to LF.
29. First line must be exactly `---`, else a format error.
30. Frontmatter ends at the first line exactly `---`; missing end is a format error.
31. Frontmatter lines split at the first `:`; lines with no colon are ignored; keys and values trimmed; later duplicates win.
32. `id` required and a valid GUID; `recordedAt` required and a valid date (offset-less read as local).
33. `endedAt` is optional and ignored when invalid.
34. Missing title reads as empty.
35. `audioFilePath` falls back to the sibling `.wav` when blank or missing on disk; otherwise the stored text is kept.
36. `folderId` is read only when a valid GUID.
37. `attendees` split on ` | `, trimmed, empties dropped.
38. Optional string fields read as null when blank.
39. A section starts at the first exact header line and ends before the next different meeting header (8 headers only); other `##` headings stay inside.
40. A section body is trimmed; empty reads as null; missing header reads as null.
41. When `headerEscaping` is present, remove one trailing ` ##` from every line that is an escaped header (escapable test).
42. Without `headerEscaping`, text is read literally (legacy files keep the old splitting).
43. Action items parsed with `^\s*-\s\[( |x|X)\]\s+(.*)$`; other lines ignored.
44. Jev JSON parsed camelCase case-insensitive; invalid JSON is a format error for the file (decide and document if the port degrades gracefully instead, B4).
45. `SourcePath` is set from the path read and never written.
46. Escaped `\uXXXX` and raw non-ASCII in Jev JSON both read correctly.

### Meeting repository

47. `GetAll` walks `*.md` recursively; per-file format, IO, and permission errors are skipped silently.
48. `GetAll` de-duplicates by id and prefers a non-legacy-flat-dump file over a legacy one.
49. Legacy flat dump = first path segment `Meetings` or `Recordings` under the Library root, case-insensitive.
50. `GetById` returns null when not found.
51. `Find(id)` prefers a non-legacy match; a legacy match is the fallback.
52. `Save` chooses directory, stem, and paths per 3.6 and reads the folder list first.
53. `Save` takes the existing audio from `record.AudioFilePath`, or from the sibling WAV of the existing markdown when blank.
54. `Save` moves the WAV (replacing any file at the destination) and updates `record.AudioFilePath` when the destination exists.
55. `Save` writes the markdown, then deletes the old markdown when its path differs.
56. A rename or folder change moves markdown and WAV together.
57. `Delete` is a no-op for an unknown id.
58. `Delete` removes the audio first, then the sibling WAV, then the markdown; a locked file throws and leaves the meeting listed.
59. `Delete` does not touch sibling meetings.
60. A corrupt markdown does not hide other meetings.
61. Writes to markdown, `folders.json`, and `settings.json` are atomic (temp file plus rename) and serialized per file (B5, B6, B17 fix).

### Folders repository

62. `folders.json` is a JSON array of `{id, name, parentId, note, colorKey, iconKey, createdAt}` with camelCase, nulls written, GUIDs lowercase hyphenated, dates ISO 8601 with offset.
63. Reader accepts case-insensitive names, unknown properties, LF or CRLF, `\uXXXX` escapes, and raw UTF-8.
64. Missing `folders.json` reads as an empty list.
65. `Save` is an upsert by id.
66. `Save` moves the old directory to the new location when the path changes, the old exists, and the new does not.
67. `Save` otherwise ensures the folder directory exists (a new folder gets its directory immediately).
68. After a directory move, every markdown under it gets `audioFilePath` rewritten to its sibling WAV, preserving CRLF/LF (restrict to meetings that have a WAV, B9 fix).
69. Directory work happens before the JSON write, so a failed move leaves the JSON untouched.
70. `Delete` removes the record, writes JSON, then deletes the directory only if empty; unknown id is a no-op.
71. The folder repository does not validate children or meetings; the caller does.
72. Folder operations are serialized by one lock shared by every user of the file.

### Folder personality

73. Color keys are `blue, teal, green, amber, orange, red, purple`; resolving is case-insensitive and returns the canonical key.
74. An unset color resolves deterministically from the folder id (B1 fix).
75. `NextKey` returns the first unused key in order, else `Keys[usedCount % 7]`.
76. Icon keys are the 18 in 3.10; unknown or unset resolves to `folder`.
77. Every icon key has a distinct icon; unset uses the default folder icon.
78. Brand tokens exist for the 7 colors plus a neutral fallback in light and dark themes.

### Folder path list

79. `Flatten` returns Inbox first, then depth-first folders with ` / ` joined paths.
80. Siblings are sorted by name, case-insensitive, accent-sensitive, locale-aware.
81. Blank inbox label is rejected.

### Library page state and rules

82. Inbox is a virtual first node, never persisted, with an invisible accent dot.
83. Tree children sorted by name; roots are folders with null `parentId`.
84. After each reload only the ancestors of the target are expanded (preserve user expansion as an improvement, B14).
85. Clicking a node selects it; re-selecting the same node does nothing.
86. Selecting persists the previous folder's note first.
87. Selecting publishes the folder id to the workspace.
88. Breadcrumbs: Inbox, then root-to-selected chain; clicking one selects that folder.
89. Meetings in Inbox = null folder id or folder id not in the folder set.
90. Meetings in a folder = exact folder id match.
91. Meetings sort by `recordedAt` descending.
92. Search filters by title only, trimmed, ordinal case-insensitive substring, live; query persists across folder changes.
93. Empty flags follow the truth table in 2.9 (library empty, inbox empty, folder empty).
94. A search with no matches shows a message (B15 fix).
95. `IsEmpty = !IsLoading && !HasMeetings`.
96. Loading state hides the body and shows a progress ring; loading is always cleared.
97. Page loads on navigate-to, persists the note on navigate-from and unload.
98. Narrow layout (< 820 px): pane becomes an overlay, closed, with a toggle button; wide layout shows a 260 px inline pane.

### Folder actions

99. New folder creates a child of the selected folder (root when Inbox selected), with auto color, null icon, null note, `createdAt` now.
100. New folder selects the new folder and expands its ancestors.
101. New folder title is `LibraryNewFolder_Title` for Inbox and `LibraryNewFolder_TitleIn` with the folder name otherwise.
102. New and rename dialogs block confirm on empty/whitespace names and trim the stored name.
103. Rename is pre-filled with the current name, renames the directory, and keeps the folder selected.
104. Duplicate or colliding sibling names are handled (reject or de-duplicate), not silently shared (B7 fix).
105. Personality dialog shows 7 swatches and 18 icons, a live preview, selects the resolved current values, and stores resolved keys on save.
106. Delete folder is blocked with `LibraryDeleteFolder_NotEmpty` when it has child folders or meetings.
107. Delete folder confirmation defaults to Cancel; confirm resets selection to Inbox and publishes null.
108. Delete folder re-checks emptiness against fresh data before deleting (B26 fix).
109. Context menu appears only for real folders and selects the folder first; items are Rename, Personality, Delete folder.
110. Folder note: trimmed, blank stored as null, unchanged notes are not re-saved, persisted on the events in 3.14, and also flushed on window close (B16 fix).

### Meeting actions

111. Row shows title, local short date-time, one-line snippet (or `History_NoContent`), and a more button.
112. Snippet algorithm matches 3.15, including the 140-character cap with an ellipsis.
113. Row click selects the meeting and opens Session on Transcript; "Open summary" opens Session on Summary.
114. The meeting menu has Open summary, Move, Delete, in that order, from both the more button and right-click.
115. Move dialog lists Inbox plus flattened paths, preselects the current folder (Inbox when dangling), and saves the full record with the new folder id.
116. Move re-saves even when the destination is unchanged, and reloads keeping the folder selected.
117. Move shows an error instead of crashing when the file is locked, and refuses busy meetings (B13 fix).
118. Delete refuses a busy meeting (recording in use or re-transcription running) with `HistoryDelete_Busy`, before and after the confirmation.
119. Delete confirmation names the meeting title and defaults to Cancel.
120. Delete failure from IO or permission errors shows `HistoryDelete_Failed` with the exception message and still reloads.
121. A successful delete notifies the workspace (`NotifyDeleted`).
122. The empty-library button navigates to Recording.
123. Status messages appear in a closable warning bar.

### Workspace

124. `WorkspaceService` keeps selected meeting, last processed meeting, session tab, shell tag, selected folder, live transcript, and capture-active flag.
125. `ScopeChanged` fires per the rules in 4.6 and not for transcript text alone.
126. Tag and tab validation throw/reject unknown values; `Transcript` and `Summary` are not navigation tags.
127. `NotifyDeleted` clears last-processed and selection when they match and raises `MeetingDeleted`.
128. Take-notes request/consume semantics match 4.6.
129. Only the shell navigates; pages request navigation through the workspace.

### Settings page data section

130. Shows the Library root path with an Open folder action that ensures directories and opens the folder in the file manager.
131. Shows the app data root path (no action).
132. Shows the app version: packaged version, else informational version, else `1.0.0.0`.
133. Strings exist in English and Spanish for `Settings_Data`, `Settings_MeetingsLocation`, `Settings_AppDataLocation`, `Settings_OpenFolder`, `Settings_About`.

### Settings storage

134. `settings.json` has the fields, names, and defaults in 3.17 and 4.3.
135. Missing file or null JSON yields defaults; missing booleans keep their defaults (true stays true).
136. Unknown keys are ignored on read and preserved on write.
137. Resolvers match: Claude model `sonnet`, Claude effort `low`, Codex model `gpt-5.6`, Codex effort `low`, Xai effort `low`, languages `es`, pane length default 280 clamped to [200, 480], pill edge `Right`, pill along clamped to [0, 1] default 0.5.
138. Summary provider parses case-sensitively to one of `Local, ClaudeCode, Codex, Xai`, otherwise `Local` (numeric text rejected, B18 fix).
139. Disabled calendar ids drop blanks and compare ordinally.
140. Saving ensures directories exist, uses an exclusive lock, and updates only the changed fields (B17 fix).

### Migrations

141. Startup order is user-data location, then layout, then legacy JSON; the first error is captured and shown, and later steps are skipped.
142. User-data migration moves top-level files from `<Root>\Meetings` and `<Root>\Recordings` into `<Library>\Meetings` and `<Library>\Recordings`, never overwriting.
143. User-data migration moves `<Root>\folders.json` to the Library root if the destination does not exist.
144. User-data migration rewrites the first `audioFilePath: ` line when it points under the legacy recordings folder, keeping the file name.
145. User-data migration deletes the empty legacy directories and does not create empty directories on every launch (B11 fix).
146. Layout migration processes `<Library>\Meetings\*.md` (top level), skips unparsable files, and restores the WAV from `<Library>\Recordings\<guid>.wav`.
147. Layout migration saves each record into its Library directory with a dated stem and removes the legacy files.
148. Layout migration deletes the empty legacy directories; with no markdown it just cleans up the empty directories.
149. Layout migration does not treat a user folder named `Meetings` or `Recordings` as legacy (B10 fix).
150. Layout migration never overwrites a newer meeting with legacy content (B12 fix).
151. Legacy JSON migration saves only records whose id is not already present, then renames `meetings.json` to `.bak`, `.bak.1`, `.bak.2` (first free), never deleting or overwriting.
152. Legacy JSON migration is a no-op when `meetings.json` is absent.
153. A failed legacy JSON migration throws and is retried on the next launch; the source file is left in place.
154. All three migrations are idempotent when re-run.

### Compatibility checks

155. A library written by the WinUI app opens in Electron with every meeting, folder, note, color, icon, and setting intact.
156. A library written by Electron opens in the WinUI app with no format error and no lost field.
157. Round trip of every golden sample file (4.1 minimal, full, header-escaped, CRLF, legacy flat dump) is stable.
