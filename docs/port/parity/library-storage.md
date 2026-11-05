# Parity ledger: library-storage (domain, integration and screens)

Spec: `docs/port/specs/library-storage.md`. Section 8 has 157 items; every one is below.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`, and `open-ui`. No `open-ui` items remain: the screens landed and each item has a final word.

## Where things are

| Concern | Code |
| --- | --- |
| Name rules, dates, markdown format, folders.json and settings.json formats, tree helpers, snippet, view rules, workspace hub, use cases, ports | `packages/core/src/library/` |
| Atomic write, per-file lock, markdown and folder repositories, settings store, EnsureDirectories, migrations, library runtime (location choice) | `packages/platform/src/fs/`, `packages/platform/src/library/` |
| zod schemas and channels | `packages/contracts/src/library.ts` |
| Handlers, composition | `apps/desktop/src/main/ipc/library-handlers.ts`, `apps/desktop/src/main/index.ts` |
| Real-window checks | `apps/desktop/e2e/library.spec.ts` (IPC), `library-ui.spec.ts` (screens, files on disk, axe), `library-screens.spec.ts` (screenshots, opt in) |
| Library screen | `apps/desktop/src/renderer/features/library/` (container `LibraryRoute.tsx`, state `use-library.ts`, presentational `MeetingList`, `Breadcrumbs`, `ChoiceGrid`, `dialogs`) |
| Settings data and about | `apps/desktop/src/renderer/features/settings/DataSection.tsx` |
| Screenshots | `docs/port/screens/library-storage/` |

## Decisions

- **Default roots** follow `stack.md`: `Documents\Vozella` (library) and `%LOCALAPPDATA%\Vozella` (app data). The file formats and the names inside the roots are unchanged, so the folder can be opened by either app.
- **Folder choice.** The user can pick the library folder (`library.chooseLocation`, `library.setLocation`). It is saved in `<app data>\library-location.json`, not in `settings.json`, because the WinUI app drops unknown keys when it saves. A production build with no `VOZELLA_DATA_ROOT` accepts any folder, including an existing MeetingLive folder. Dev and test mode, and any run with the environment override, refuse a path inside or named MeetingLive; a saved choice that is no longer allowed is ignored at startup. Applying a choice rebuilds the services and runs the migrations on the new root, with no restart.
- **No worker and no native code.** Everything is async `fs` in the main process. Measured on this machine (3,000 meetings, about 56 KB each, 20 folders): first list 709 ms, second list 36 ms, one save 44 ms. That is within what a main-process task can do without a worker; revisit only if a real library shows otherwise. The Rust addon has nothing to do here: Documents comes from Electron, and the folder is opened with `shell.openPath`.
- **Parse failures are kept** (B4): a meeting file that is not valid (including a bad `## Jev` block) is still left out of the list, as in the WinUI app, but `library.load` now returns it in `skipped` with the reason, so nothing is silent.
- **Folder names** that land on the same directory as a sibling are refused with `name-taken` (B7). `Meetings` and `Recordings` are reserved like `Inbox`; a folder with one of those names gets the directory `<name> folder`. Windows device names get a `_` suffix (`CON` becomes `CON_`).
- **Corrupt files** (B5): a damaged `folders.json` is never overwritten and is reported as `corrupt`; meeting saves keep working and file by Inbox until it is repaired. A damaged `settings.json` is moved aside as `settings.json.corrupt` (then `.corrupt.1`, ...) and defaults are used.
- **Sort locale** (B24): name ordering takes an explicit locale; callers pass the UI language. It never reads the machine culture.
- **Orphan folders** (B26b): a folder whose parent no longer exists is listed as a root. Its directory is already at the top level, so this matches the disk and keeps its meetings reachable.
- **Dates**: kept as the file's own text (seven fraction digits and an offset) because JavaScript dates lose both. Stored `recordedAt` is normalized to the round-trip form on read, so a `Z` becomes `+00:00`.
- **Jev JSON** is written with the .NET default encoder rules (`+`, `<`, `>`, `&`, `'`, backtick and non-ASCII as `\uXXXX`). The spec example shows a raw `+`; readers accept both and the golden test checks both.
- **TDD note.** The first work unit's tests were run RED (module missing) before the code existed. In later units the tests were written first but I did not run them separately to observe RED before writing the code; they were green on first run. The regression tests below were written against the fixed behavior, not against the old behavior.

### Screens (UI half)

- **Layout.** Three panes: folders in the app sidebar, a date-grouped list, and a preview beside it. With 760 px of content or more the list is `clamp(340px, 38%, 440px)` and the preview takes the rest; below that there is no preview and a click opens the meeting. The smallest window (960 px, 728 of content) is below the line. The list is a logbook: a virtual `role="grid"` with sticky day headers and fixed 64 px rows, ruled at the bottom, with no cards. Each ruling is 2 px at the left and as long as the meeting on a square-root scale, capped at 120 min and 64 px; it is `aria-hidden`, because the duration is in the row text. Shadows only on the Undo offer, menus and dialogs. Window zoom cannot reduce the width: there is no application menu (`main/index.ts:566`) and nothing in `src` changes the zoom factor.
- **Accents** are folder content, kept muted: the icon in the accent color, nothing else is tinted. The dot beside it was removed in the redesign; a `Tree` row with no icon keeps it. `signal` red is never used here.
- **Session placeholder.** The Session module is not built, so `/session` shows the opened meeting title and tab and a back link. It exists so the hand-off through the workspace is real and testable; the Session module replaces it.
- **Shell.** `AppShell` listens to `workspace.navigationRequested` and reports its tag. `/library` is paned: `main` stops scrolling and each pane has its own scroll, with the same elements, so `Outlet` does not remount. `NavRail` has a slot after Library for the folder tree, shown on every route; the selection shows only on `/library` and `/session`, and on `/library` the rail does not also fill Library. A folder click elsewhere sets the view and navigates; a right click elsewhere does not. Forced colors mark the selection with an outline in the rail, the tree and the list, because the Canvas backplate behind text made `HighlightText` on a `Highlight` fill unreadable.
- **UI kit changes.** `Tree` takes optional accent dots (for rows with no icon), controlled expansion, per-row context menus, `rowProps(id)` for drop targets and `selectOnContextMenu`; `Dialog` takes an initial focus target; new `Notice`; `ContextMenu` can render its trigger as another element. All are backward compatible and covered in `components.test.tsx`.
- **New strings** (en and es): `Ui_LibraryFolders`, `Ui_LibraryFolderActions`, `Ui_LibraryOpenFailed`. Everything else reuses existing keys. The meeting list is named with `HistoryPage_Title`, the breadcrumb with `Chat_ScopeFolder`.
- **Move after a busy refusal** shows `HistoryDelete_Busy` (same meaning as for delete) instead of a new string.
- **TDD note.** The screen tests and the e2e specs were written after the screen code and were green on first run. RED was not observed.
- **Checks.** `LibraryRoute.test.tsx` drives the real page against the real `LibraryService` over in-memory repositories and the real `Workspace`. `library-ui.spec.ts` drives the built app with `VOZELLA_FAKE_NATIVE=1`, writes meeting files the way the app does and checks the files on disk. The folder dialog and `shell.openPath` are stubbed in the main process, so no real dialog or file manager opens. `library-grid.spec.ts` proves the virtual grid in the real renderer, `library-interactions.spec.ts` checks, keyboard and drag with the files on disk, and `library-a11y.spec.ts` runs axe over the grid and the tree (any impact) and the page (serious and critical), in both themes, in the states that change roles or colors.
- **Search.** `library.search` reads titles, summaries, notes and transcripts in `packages/core/src/library/meeting-search.ts`, accent-insensitive with words ANDed. Titles filter at once in memory; the second stage needs 2 or more characters and a 200 ms debounce, and results stay date-ordered. Measured at 3,000 meetings on this machine: gate met at 13 MB (148 ms cold, 137 ms warm at worst); at 78 MB the cold gate is met and warm is over by up to 41 ms; at 156 MB (about an hour per meeting) the gate of 800 ms is missed, at about 1.2 s, because the folded text outgrows the 64 MB cap. Whether the cap or the gate moves is an owner decision. A row brings a match near the start of its snippet with `snippetAroundMatch`, because a narrow row shows only the start.
- **Trash.** Deleting a meeting moves its audio, sibling WAV and markdown to the Recycle Bin through `shell.trashItem`, injected as `discard`; under `VOZELLA_FAKE_NATIVE` they are unlinked. If the bin refuses, a second dialog offers "Delete permanently". Shift+Delete asks for that directly. Moving a meeting still unlinks the old file. A real bin restore and a volume with no bin are `pending-real-validation`.
- **Filters.** New in the redesign, not in the WinUI page. A button beside the search opens a small popover with date (any time, last 7 days, last 30 days, custom range) and status (any, with summary, without summary, without transcript). Local days, both ends inclusive; pure logic in `features/library/meeting-filters.ts`. A range given backwards means the same days, a custom range with no days yet filters nothing, and a meeting with no readable date goes as soon as a date is asked for. Filters apply after the view and both search stages, so the count reads "12 of 46" and the day groups, the cursor and Ctrl+A work on what is left. Chips with Clear filters sit under the search; a filter that hides everything has its own line. They live in `library-store`, for the session only, and no channel or contract changed. The popover shell is `@base-ui/react/popover` inside the feature, because `ui/` has no Popover. `e2e/library-filters.spec.ts`.
- **Undo.** The redesign named a toast for Undo after a move. It is `UndoOffer` inside the list pane, because `ui/Toast.tsx` has no action: 8 s, held while hovered or focused. It follows a drag and the Move dialog.
- **Rename from the list.** `session.rename` does not broadcast `library.changed`, so F2 refreshes the list itself after the rename.

## Parity items

### Paths and layout

| # | Status | Notes |
| --- | --- | --- |
| 1 | improved | Defaults are `Vozella`, per `stack.md`; picking an existing `MeetingLive` folder works in production. `app-paths.test.ts`, `library-runtime.test.ts` |
| 2 | done | `app-paths.test.ts` |
| 3 | done | `json-settings-store.test.ts` (ensureDirectoriesExist) |
| 4 | done | Roots are injected everywhere; `library-test-kit.ts` uses a temp root |
| 5 | done | `folder-tree.test.ts` |
| 6 | done | `markdown-meeting-repository.test.ts` |
| 7 | done | Same file, "write-only mirror" |
| 8 | improved | B8 a, b, c and the B10 reserved names. `names.test.ts` |
| 9 | done | `names.test.ts` |
| 10 | done | `markdown-meeting-repository.test.ts` |
| 11 | improved | B2 fixed. `markdown-meeting-repository.test.ts` ("B2") |

### Meeting markdown writing

| # | Status | Notes |
| --- | --- | --- |
| 12 | done | `meeting-markdown.test.ts` |
| 13 | done | key order test |
| 14 | done | `offset-date.test.ts`, round-trip tests |
| 15 | done | minimal sample test |
| 16 | done | |
| 17 | done | |
| 18 | done | |
| 19 | improved | B3 fixed. Title, audioFilePath, summaryProvider, attendees and the five optional fields lose CR and LF |
| 20 | done | golden sample |
| 21 | done | golden sample |
| 22 | improved | B21 fixed: whitespace-only Transcript, Summary and Notes are skipped |
| 23 | done | Proof: `meeting-markdown.test.ts` '23' checks the written text for a padded body (fails if the write-side trim is removed) |
| 24 | improved | B22: newlines inside action item text become a space |
| 25 | done | |
| 26 | done | header escaping tests |
| 27 | done | Byte-for-byte test ported from the xUnit golden, plus the spec 4.1 full sample |

### Meeting markdown reading

| # | Status | Notes |
| --- | --- | --- |
| 28 | done | BOM and CRLF test |
| 29 | done | |
| 30 | done | |
| 31 | done | |
| 32 | done | |
| 33 | done | |
| 34 | done | |
| 35 | done | |
| 36 | done | |
| 37 | done | |
| 38 | done | |
| 39 | done | |
| 40 | done | |
| 41 | done | |
| 42 | done | legacy file test |
| 43 | done | |
| 44 | done | Kept as a format error (B4 is not on the fix list); the skipped file is now reported |
| 45 | done | |
| 46 | done | |

### Meeting repository

| # | Status | Notes |
| --- | --- | --- |
| 47 | done | |
| 48 | done | |
| 49 | done | |
| 50 | done | |
| 51 | done | |
| 52 | done | |
| 53 | done | |
| 54 | done | |
| 55 | done | |
| 56 | done | |
| 57 | done | |
| 58 | improved | Same order and retry behavior. B25: a stored audio path outside the library is left in place and logged |
| 59 | done | |
| 60 | done | And reported through `skipped`. Audit fix: the notice now lists up to three file names with the reason (for example `EBUSY` for a locked file) and a count of the rest, so a meeting with a bad Jev block or a locked file can be found. Files locked at scan time come back on the next refresh |
| 61 | improved | B5, B6, B17, B19, B20, B28. Atomic temp-and-rename writes (`atomic-write.test.ts`), one lock per file shared by all instances, an in-memory index keyed by modified time and size, newest-file tie-break for duplicate ids |

### Folders repository

| # | Status | Notes |
| --- | --- | --- |
| 62 | done | `folders-json.test.ts` |
| 63 | done | |
| 64 | done | |
| 65 | done | |
| 66 | done | Case-only renames now change the directory name too (B7) |
| 67 | done | |
| 68 | improved | B9: only meetings with a recording beside them are rewritten |
| 69 | done | |
| 70 | done | |
| 71 | done | |
| 72 | improved | B6: one process-wide lock per file |

### Folder personality

| # | Status | Notes |
| --- | --- | --- |
| 73 | done | |
| 74 | improved | B1: FNV-1a over the id; pinned values in the test |
| 75 | done | |
| 76 | done | |
| 77 | done | 18 distinct line icons in `folder-visuals.ts`, drawn with the kit icon set; unset uses `folder`. `folder-visuals.test.ts` |
| 78 | done | Seven accents plus a neutral in `tokens.css`, light and dark, muted against the spec colors; forced colors map them to the system text color. The neutral token is defined as a fallback; Inbox shows no dot |

### Folder path list

| # | Status | Notes |
| --- | --- | --- |
| 79 | done | |
| 80 | improved | `Intl.Collator` with an explicit locale (B24) |
| 81 | done | |

### Library page state and rules

| # | Status | Notes |
| --- | --- | --- |
| 82 | improved | All is a new first node, Inbox the second, both virtual, then a gap and the folders. All shows every meeting and is not a drop target; All and Inbox both publish `null` as scope. `LibraryRoute.test.tsx`, `library-store.test.tsx` |
| 83 | done | `buildFolderTree` |
| 84 | improved | Reload only adds ancestors of the target to what the user already opened (B14). A selected folder with children is not auto-expanded, as in the spec. Holding a drag over a closed folder for 600 ms now opens it |
| 85 | done | `selectFolder` ignores the current id |
| 86 | done | `use-library.ts` saves the note of the folder being left before it switches; `LibraryRoute.test.tsx` (folder note) and `library-ui.spec.ts` |
| 87 | done | `workspace.dispatch publishSelectedFolder` |
| 88 | done | `Breadcrumbs.tsx`; Inbox first, the last item is `aria-current` |
| 89 | done | `selectMeetings` |
| 90 | done | |
| 91 | done | Sorted by instant, not by text |
| 92 | done | |
| 93 | done | `emptyFlags` truth table |
| 94 | improved | B15: `emptyFlags.showNoMatches`; string `Ui_LibrarySearchEmpty`. Search now reads inside meetings as well as titles, and offers to widen to everything from a narrower view. "No meetings match" waits for the second stage. See Search in the decisions |
| 95 | done | |
| 96 | improved | Skeleton rows of the real list (a day header, then rows with time and two lines) instead of a progress ring, and only on the first load; later reloads are silent so the page does not flash. Loading is cleared in `finally`. The preview has its own skeleton, after 150 ms. Screenshot `library-loading-light.png` |
| 97 | improved | Loads on mount, saves the note on unmount and on `pagehide`. It also reloads when the main process reports `library.changed`, which the WinUI page did not (it had no live refresh) |
| 98 | improved | The folders moved to the sidebar, 232 px at every width, so the narrow overlay and its `Folder` toggle are gone: the overlay was unreachable at the window minimum. The switch is now preview or no preview, at 760 px of the page area, not the window. `LibraryRoute.test.tsx`, `library-grid.spec.ts`, screenshots `library-all-*-960.png` |

### Folder actions

| # | Status | Notes |
| --- | --- | --- |
| 99 | done | `LibraryService.createFolder` |
| 100 | improved | The new folder is selected and its ancestors open. New folder is a quiet row at the end of the sidebar tree, reachable from any route. `LibraryRoute.test.tsx`, `library-ui.spec.ts` |
| 101 | done | `LibraryNewFolder_Title` and `LibraryNewFolder_TitleIn` |
| 102 | done | The primary button stays disabled for a blank name; Enter submits only a non-blank name; the service trims |
| 103 | done | Pre-filled; the directory moves on disk (`library-ui.spec.ts`) |
| 104 | improved | B7: `name-taken` |
| 105 | done | Seven swatches and 18 tiles as one radio group each (arrows move and select), live preview, resolved current values preselected. Swatch and tile accessible names are the English keys, as the spec says; they are not translated |
| 106 | done | `not-empty` plus the existing `LibraryDeleteFolder_NotEmpty` string |
| 107 | done | Cancel has the focus; confirm goes back to Inbox and the handler publishes null. `LibraryRoute.test.tsx`, `library-ui.spec.ts` |
| 108 | improved | B26: the check uses fresh data |
| 109 | improved | Right click on a real folder selects it first on `/library` (so Escape leaves it selected and the note of the previous folder is saved), then opens Rename, Personality, Delete folder; All and Inbox have no menu. Elsewhere it does not navigate until an entry is chosen. The same three items are in a `Folder actions` button in the list header. With a test |
| 110 | pending-real-validation | Saved on folder change, create, rename, personality, unmount and `pagehide` (B16). Audit fix: main now tracks library writes and `before-quit` waits for them (3 s cap), covered by a handler test. The save on a real window close was still not observed end to end, and a `pagehide` invoke that has not reached main when the window dies could still be lost |

### Meeting actions

| # | Status | Notes |
| --- | --- | --- |
| 111 | improved | `MeetingGrid.tsx`: time and duration in the mono face, 24 hour in every locale with the full date on hover; title; one-line snippet or `History_NoContent`; check and more button (shown on hover and focus, always in forced colors). Day headers carry the date. Rows also show length through the ruling. Snippet shows the words found |
| 112 | done | `snippet.test.ts` |
| 113 | improved | With a preview, a click previews and double click or Enter opens on Transcript (a search hit opens its own tab, notes hits Summary); Open summary opens on Summary. With no preview, a click opens. The shell navigates. Coming back restores the row and the scroll. `LibraryRoute.test.tsx`, `library-grid.spec.ts` |
| 114 | improved | Open summary, Move, Delete from the more button and from right click, plus keys (Delete, Shift+Delete, F2), the bulk bar for checked meetings, and drag to a folder with Undo; the dialog and the menu satisfy WCAG 2.5.7. `library-interactions.spec.ts` |
| 115 | done | The dialog lists the flattened paths; the current folder is preselected, Inbox when dangling |
| 116 | done | |
| 117 | improved | B13: busy refusal and `io-failed` with the message, as values |
| 118 | done | `isMeetingBusy` before the dialog and again inside `deleteMeeting`. Nothing reports busy until the recording and re-transcription modules register a probe |
| 119 | improved | Names the title and says it goes to the Recycle Bin; Cancel has the focus. If the bin refuses, a second dialog offers to delete permanently. `LibraryRoute.test.tsx` |
| 120 | improved | `HistoryDelete_Failed` with the message; the meeting stays listed, and in a bulk delete meetings that failed stay checked. Tested with a locked file in `LibraryRoute.test.tsx` |
| 121 | done | `library.deleteMeeting` calls `notifyDeleted` |
| 122 | done | Dispatches `navigateTo Recording`; the shell follows (`library-ui.spec.ts`) |
| 123 | done | `Notice`, closable, one at a time. Load problems, skipped files and the startup error get their own notices above it |

### Workspace

| # | Status | Notes |
| --- | --- | --- |
| 124 | done | `workspace.test.ts` |
| 125 | done | |
| 126 | done | And rejected at the wire by zod |
| 127 | done | |
| 128 | done | |
| 129 | done | `AppShell` is the only listener of `workspace.navigationRequested` and reports its tag with `setCurrentShellTag`. The Library only dispatches |

### Settings page data section

| # | Status | Notes |
| --- | --- | --- |
| 130 | done | Meetings row with the path, Open folder, Choose folder and, for a picked folder, Use the default folder. `DataSection.test.tsx`, `library-ui.spec.ts` (dialog and shell stubbed) |
| 131 | done | App data row, path only |
| 132 | done | Audit fix: the version is read from the desktop `package.json` (two levels above `out/main`, also inside the packaged archive) instead of `app.getVersion()`, which answered with the Electron runtime version when started from the built folder. The package version is now `1.0.0`; the fallback is `1.0.0.0`. Unit tested; the packaged value was not observed |
| 133 | done | `Settings_Data.Text`, `Settings_MeetingsLocation.Header`, `Settings_AppDataLocation.Header`, `Settings_OpenFolder.Content`, `Settings_About.Header` exist in both languages |

### Settings storage

| # | Status | Notes |
| --- | --- | --- |
| 134 | done | `settings.test.ts` |
| 135 | done | |
| 136 | improved | Unknown keys are preserved on write |
| 137 | done | |
| 138 | improved | B18: numeric text no longer parses |
| 139 | done | |
| 140 | improved | B17: `settings.update` takes a patch and runs read-modify-write under one lock |

### Migrations

| # | Status | Notes |
| --- | --- | --- |
| 141 | improved | The first error is returned as `startupError`; the Library page shows it as a notice. The shell module may show it more prominently |
| 142 | done | `migrations.test.ts` |
| 143 | done | |
| 144 | done | |
| 145 | improved | B11 |
| 146 | done | |
| 147 | done | |
| 148 | done | |
| 149 | done | B10. Audit fix: WinUI only reserves Inbox, so its top-level folder Meetings or Recordings has the directory `Library/Meetings`. A file there that belongs to that folder is no longer legacy (`markdown-meeting-repository.ts` `isUserFolderDirectory`) and the layout migration leaves it in place. Plain dump files still move. Test in `migrations.test.ts` |
| 150 | improved | B12: a current-layout copy wins and the legacy copy is removed |
| 151 | done | |
| 152 | done | |
| 153 | done | |
| 154 | done | |

### Compatibility checks

| # | Status | Notes |
| --- | --- | --- |
| 155 | done | A library written by the C# repositories opens whole (folders, nested folder, accents, note with a newline, color, icon, every meeting field). Fixture `packages/platform/src/library/fixtures/winui-library` (folders.json is stored as folders.json.fixture so Prettier keeps its bytes) was produced by running `JsonFolderRepository` and `MarkdownMeetingRepository` from MeetingLive.Core through a throwaway console project against a temp folder; only the audioFilePath prefix was replaced. Test: `winui-library.test.ts`. It is not a library from a real user install |
| 156 | done | Observed once, not committed as a test: a tree written by the TypeScript repositories was read by the same C# repositories (throwaway console project, outside the repo) with every folder, parent, note, color, icon, attendee, action item and section intact. Committed proof: the TypeScript side rewrites the C# fixture byte for byte (CRLF folders.json, `á` escapes included), so the formats agree in both directions |
| 157 | done | Minimal, full, header-escaped, CRLF and legacy flat dump samples round-trip (`meeting-markdown.test.ts`, `markdown-meeting-repository.test.ts`) |

## Bugs fixed (section 7)

Each has a regression test; the test name starts with the bug id.

| Bug | Fix | Test |
| --- | --- | --- |
| B1 | Deterministic color from the folder id | `folder-personality.test.ts` |
| B2 | A recording the saving meeting owns does not force a ` 2` suffix | `markdown-meeting-repository.test.ts` |
| B3 | CR and LF removed from single-line fields | `meeting-markdown.test.ts` |
| B5 | Atomic writes; damaged `folders.json` reported and never overwritten; damaged `settings.json` set aside | `atomic-write.test.ts`, `json-folder-repository.test.ts`, `json-settings-store.test.ts`, `markdown-meeting-repository.test.ts` |
| B6 | One lock per file, shared by every instance | `json-folder-repository.test.ts` |
| B7 | Duplicate and colliding sibling names refused; case-only rename changes the directory | `library-service.test.ts`, `json-folder-repository.test.ts` |
| B8 a, b, c | Trim order, surrogate-safe cut, device names | `names.test.ts` |
| B9 | Only meetings with a recording are rewritten | `json-folder-repository.test.ts` |
| B10 | `Meetings` and `Recordings` reserved folder names | `names.test.ts`, `json-folder-repository.test.ts` |
| B11 | No empty legacy folders created | `migrations.test.ts` |
| B12 | Legacy copy never overwrites a newer meeting | `migrations.test.ts` |
| B13 | No mutation of the snapshot; busy check on move; typed failures | `library-service.test.ts`, `LibraryRoute.audit.test.tsx` (failed create, rename and personality save show the folder message and change nothing) |
| B15 | `showNoMatches` | `library-view.test.ts` |
| B17 | Patch updates under one lock; unknown keys kept | `settings.test.ts`, `json-settings-store.test.ts` |
| B18 | Numeric provider text rejected | `settings.test.ts` |
| B19 | In-memory index by modified time and size | `markdown-meeting-repository.test.ts` ("picks up files changed outside the app"); timing above |
| B20 | Newest file wins, then path | `markdown-meeting-repository.test.ts` |
| B21 | Whitespace-only sections skipped | `meeting-markdown.test.ts` |
| B22 | Newlines in action item text | `meeting-markdown.test.ts` |
| B24 | Explicit locale | `folder-tree.test.ts` |
| B25 | Audio outside the library is not deleted | `markdown-meeting-repository.test.ts` |
| B26 a | Folder delete re-checks fresh data | `library-service.test.ts` |
| B26 b | Orphan folders listed as roots | `folder-tree.test.ts` |
| B27 | Dead folders read in the layout migration removed | (no test; the code path is gone) |
| B28 | The list reads snippets from the index, not every transcript | `markdown-meeting-repository.test.ts` |

Not changed, on purpose: B4 (kept, now reported), B23 (same order as the WinUI app; a crash window remains), B14 and B16 (UI state; see below).

## Left for other modules

**Recording and re-transcription modules**
- Register a probe on the `MeetingBusyRegistry` created in `main/index.ts` so delete and move refuse meetings in use (117, 118). The Library already asks `library.isMeetingBusy` before the delete dialog and the service checks again, so no UI change is needed. Until then nothing is ever busy.
- The recorder should create the WAV at the dated stem, then call the repository `save` with `audioFilePath` set; B2 is fixed for that flow.
- After a save that changes a meeting, call `workspace.dispatch notifyMeetingChanged`.

**Session module**
- Replace `features/session/SessionRoute.tsx` (placeholder). It reads `workspace.getState` for the meeting and tab and `library.getMeeting` for the record.
- `library.moveMeeting` and `library.deleteMeeting` are the only mutations the Library offers; the session screens save through the repository when they land.

**Shell module**
- `app.getVersion()` is `0.0.0` in the package until a release version is set in `apps/desktop/package.json`.
- The startup migration error is shown by the Library page; the shell may want a window-level notice.

**Not verified**
- A library written by the real WinUI app, and the reverse (155, 156). A real packaged build with a picked folder and a real folder dialog. The real file manager opening (stubbed in tests). Behavior on OneDrive-redirected Documents. Case-only folder rename on a case-sensitive volume. A WAV held open by a real recorder (only simulated with an injected `EBUSY`). The note save on a real window close. Spanish layout (screenshots are English; the Spanish strings are the existing translations). Screen reader behavior beyond axe.

## Audit round decisions

- Fixed: #132 version, #109 select-first on right click, #60 and B4 skipped files named in the notice, #110 main waits for in-flight library writes on quit (status moved to pending-real-validation).
- Design, fixed: Library and Settings page titles use the 20px heading (`quiet`) while the document keeps the large title; the search field hides Chromium's native clear button; the folder notes field is a borderless single line that shows its border on focus.
- Design, not changed: dates in the mono face sit at the far right with the row's `more` slot reserved. Rejected for now: the slot keeps rows aligned and keyboard reachable; low severity, decided without a user to ask.

## Second audit round decisions

- #110 and B16: the note is now autosaved 400 ms after the last keystroke and on blur, besides folder change, unmount and `pagehide`, so it no longer depends on a page-hide invoke reaching main. Covered by a component test and `e2e/library-close.spec.ts`. Observed: that e2e also passes on the previous code when windows are closed with `BrowserWindow.close()`, so the audit's loss was not reproduced here; the autosave removes the dependency anyway. Status stays pending-real-validation for a manual close with the window button.
- Fixed: the folder notes box kept `resize-y` and `min-h-16` because `cn` does not merge Tailwind classes; it is now a borderless auto-sized single line without a grip.
- Fixed: screenshots in `docs/port/screens/library-storage/` regenerated from the current build (20px page title, borderless note, version 1.0.0).
- Not a Library defect: items 113, 117 and 118 depend on the Session module; 155 and 156 stay unverified.

## Third audit round decisions

Fixed, with tests:

- B16 typing race: `refresh()` no longer overwrites the note box with the stored note when the user typed while `library.load` was in flight (`use-library.ts` compares the text at load start). Test: `LibraryRoute.audit.test.tsx` (a character typed during the reload after an autosave is kept).
- #96: a rejecting `workspace.getState` no longer leaves the skeleton up; the page opens on Inbox. Tests added for the skeleton, the hidden body and the rejection.
- #14: `renderMeetingMarkdown` now writes the id and folderId lowercase and the dates in round-trip form (seven fraction digits), whatever the caller passed; unparseable text is written unchanged. Test in `meeting-markdown.test.ts`.
- Tests added only (behavior already correct): #16/#17/#22 (whitespace-only sections, optional fields, empty provider), #53 (blank audioFilePath takes the sibling WAV), #54 (a file at the destination is replaced), #47 (EBUSY, EACCES, EPERM, ENOENT skipped with their code, never cached), B19 and B28 (a second list reads no file; a changed file is the only one re-read), #78 (all eight accent tokens in the four token blocks), #77 (18 distinct icons, unset draws the folder), #71 (delete ignores children), #84/B14, #85, #87, #97, #117, #123, #141 (a layout-step failure skips the meetings.json step; the startup error notice is rendered).
- Design: meeting dates use the proportional face with tabular numbers, not the mono face (reverses the earlier rejection). The Session placeholder Back control now dispatches `navigateTo('History')` through the workspace instead of a router link. Screenshots were not regenerated.

Still pending-real-validation, not provable here:

- #110: `e2e/library-close.spec.ts` gained a test that posts WM_CLOSE (what the title bar X sends) to the app's windows. In this agent session no top-level window was reachable (0 windows enumerated), so that test skipped itself and the real button close was not observed. The earlier `BrowserWindow.close()` test passes.
- #155 and #156: still need the real WinUI app and a library it wrote. The data-safety rules forbid reading the user's folder and no C#-generated sample library exists in the repo.

Rejected:

- #149 was first rejected with a wrong reason (the C# `SanitizeName` reserves only Inbox). Accepted on re-audit and fixed, see the row. New saves still go to "Meetings folder" or "Recordings folder" (port choice, kept so a new folder never collides with a dump).
- Jev leniency: a wrong-typed Jev property reads as its default and the file is kept, where System.Text.Json would drop the file. Deliberate: losing a whole meeting over one bad property is worse. Only invalid JSON or a non-object root is a format error.
- meetings.json keys are read with exact case. Files written by the app always use the written case; not changed.
- Remaining design notes (outline weight of buttons and the search field, dark Cancel weight, popover pointer) and the minor proof gaps for #80, #82 and #88 are left as they are: low severity, no user to ask.

## Second audit round

- Fixed: #149 (above); first-load selection lost when a live refresh replaced the first load (`use-library.ts` `selectionApplied`, test in `LibraryRoute.audit.test.tsx`).
- Tests added for gaps: #23 raw trimmed text, #13 `headerEscaping` last after attendees, #111 date text and `formatMeetingDate`, #114 right click and menu order on a meeting row, #115 Inbox preselected for a dangling folder id and a real folder preselected.
- Decided, not changed: #110 and B16 stay pending-real-validation; a window death with an invoke in flight cannot be proven here, and the 400 ms autosave plus before-quit wait is the mitigation. #155 and #156 stay pending: no WinUI app or C#-written library may be used. Meeting locks: the ledger line for #61 should read that meetings use one `KeyedMutex` per repository instance; production builds one, so no race.
- Decided, not changed: design notes (narrow-pane popover, outline weight of buttons, Data card paths, folder notes affordance) are low severity and stay as is; unviewed screenshots and env-gated screenshot specs were not re-run.

## Audit round 3 decisions

- Fixed: B13 folder half now has renderer proof (create, rename and personality failures reach the status bar). Item 105 preview follows the picked color and icon, now asserted.
- Fixed: B7 with B26b. `nameTaken` treats a folder with a dangling parent as a root, for create and rename, so an orphan shown at the top level blocks a same-name root. Test in `library-service.test.ts` (RED before the change).
- Fixed: `NameDialog` no longer stays busy if the submit handler rejects; the error shows in the dialog.
- #155 and #156: closed as above with the C#-written fixture.
- Rejected, no change: #110 and B16 stay pending-real-validation. The WM_CLOSE e2e skips itself in this session (no top-level window is enumerable), and a title-bar close with an invoke in flight cannot be reproduced here. Existing mitigation stays: 400 ms autosave, blur, unmount and pagehide saves, and the `before-quit` wait. No failing-before test exists, and none was invented.
- Rejected, no change: narrow-pane overlay covering the first rows (an overlay by design) and the empty versus disabled state tone (identical on purpose).

