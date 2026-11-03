# Parity ledger: library-storage (domain and integration half)

Spec: `docs/port/specs/library-storage.md`. Section 8 has 157 items; every one is below.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`, and `open-ui`. `open-ui` is not a final status. It means the rule, the IPC and the strings exist and are tested here, and the visible screen belongs to the UI half. The UI half turns each `open-ui` into one of the four final words when its screen lands.

## Where things are

| Concern | Code |
| --- | --- |
| Name rules, dates, markdown format, folders.json and settings.json formats, tree helpers, snippet, view rules, workspace hub, use cases, ports | `packages/core/src/library/` |
| Atomic write, per-file lock, markdown and folder repositories, settings store, EnsureDirectories, migrations, library runtime (location choice) | `packages/platform/src/fs/`, `packages/platform/src/library/` |
| zod schemas and channels | `packages/contracts/src/library.ts` |
| Handlers, composition | `apps/desktop/src/main/ipc/library-handlers.ts`, `apps/desktop/src/main/index.ts` |
| Real-window check | `apps/desktop/e2e/library.spec.ts` |

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
| 23 | done | |
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
| 60 | done | And reported through `skipped` |
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
| 77 | open-ui | The 18 keys exist in core; the icon set is the UI half's |
| 78 | open-ui | Tokens for the 7 colors in both themes are the UI half's; stack.md asks for muted user-chosen accents |

### Folder path list

| # | Status | Notes |
| --- | --- | --- |
| 79 | done | |
| 80 | improved | `Intl.Collator` with an explicit locale (B24) |
| 81 | done | |

### Library page state and rules

| # | Status | Notes |
| --- | --- | --- |
| 82 | open-ui | The virtual Inbox node is a UI concern; `buildFolderTree` returns real folders only |
| 83 | done | `buildFolderTree` |
| 84 | open-ui | `expandedAncestors` is in core. B14 asks to keep the user's own expansion; that is UI state |
| 85 | open-ui | |
| 86 | open-ui | The save itself is `library.setFolderNote`; the UI calls it before it switches |
| 87 | done | `workspace.dispatch publishSelectedFolder` |
| 88 | open-ui | `buildBreadcrumbs` is in core |
| 89 | done | `selectMeetings` |
| 90 | done | |
| 91 | done | Sorted by instant, not by text |
| 92 | done | |
| 93 | done | `emptyFlags` truth table |
| 94 | improved | B15: `emptyFlags.showNoMatches`; string `Ui_LibrarySearchEmpty` |
| 95 | done | |
| 96 | open-ui | |
| 97 | open-ui | |
| 98 | open-ui | |

### Folder actions

| # | Status | Notes |
| --- | --- | --- |
| 99 | done | `LibraryService.createFolder` |
| 100 | open-ui | The UI selects the new folder and uses `expandedAncestors` |
| 101 | open-ui | Strings exist |
| 102 | open-ui | The trim and the empty check are in the service (`empty-name`); the dialog button state is the UI's |
| 103 | open-ui | Rename and directory move are done and tested; the dialog is the UI's |
| 104 | improved | B7: `name-taken` |
| 105 | open-ui | The service stores resolved keys; the dialog is the UI's |
| 106 | done | `not-empty` plus the existing `LibraryDeleteFolder_NotEmpty` string |
| 107 | open-ui | Publishing null is done in the handler; the Cancel default is the UI's |
| 108 | improved | B26: the check uses fresh data |
| 109 | open-ui | |
| 110 | open-ui | Trim, blank-to-null and no-op on unchanged are done. Flushing on window close (B16) needs the UI to call `library.setFolderNote` on `pagehide` |

### Meeting actions

| # | Status | Notes |
| --- | --- | --- |
| 111 | open-ui | The list item already carries title, date and snippet |
| 112 | done | `snippet.test.ts` |
| 113 | open-ui | `workspace.dispatch selectMeeting`, `openSession` |
| 114 | open-ui | |
| 115 | open-ui | `flattenFolderPaths` is in core |
| 116 | done | |
| 117 | improved | B13: busy refusal and `io-failed` with the message, as values |
| 118 | done | `isMeetingBusy` before the dialog and again inside `deleteMeeting`. Nothing reports busy until the recording and re-transcription modules register a probe |
| 119 | open-ui | |
| 120 | open-ui | `io-failed` plus the message; `HistoryDelete_Failed` exists |
| 121 | done | `library.deleteMeeting` calls `notifyDeleted` |
| 122 | open-ui | |
| 123 | open-ui | |

### Workspace

| # | Status | Notes |
| --- | --- | --- |
| 124 | done | `workspace.test.ts` |
| 125 | done | |
| 126 | done | And rejected at the wire by zod |
| 127 | done | |
| 128 | done | |
| 129 | open-ui | The shell must be the only listener of `workspace.navigationRequested` |

### Settings page data section

| # | Status | Notes |
| --- | --- | --- |
| 130 | open-ui | `library.getLocation`, `library.openFolder`, `library.chooseLocation`, `library.setLocation` |
| 131 | open-ui | |
| 132 | open-ui | `library.getLocation.version`: `app.getVersion()`, else `1.0.0.0`. The dev build reports `0.0.0` |
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
| 141 | done | The first error is returned as `startupError` in `library.getLocation`; showing it is the shell's |
| 142 | done | `migrations.test.ts` |
| 143 | done | |
| 144 | done | |
| 145 | improved | B11 |
| 146 | done | |
| 147 | done | |
| 148 | done | |
| 149 | improved | B10 |
| 150 | improved | B12: a current-layout copy wins and the legacy copy is removed |
| 151 | done | |
| 152 | done | |
| 153 | done | |
| 154 | done | |

### Compatibility checks

| # | Status | Notes |
| --- | --- | --- |
| 155 | pending-real-validation | Needs a library written by the WinUI app. Agents may not read the real folder; only spec-derived samples were used |
| 156 | pending-real-validation | Needs the WinUI app to open a library written here |
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
| B13 | No mutation of the snapshot; busy check on move; typed failures | `library-service.test.ts` |
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

**UI half of this module**
- The Library screen: tree with the virtual Inbox node, breadcrumbs, search, list, empty states, status bar, the four dialogs, context menus, narrow layout (items 77, 78, 82, 84 to 86, 88, 96 to 98, 100 to 103, 105, 107, 109 to 115, 119 to 123, 129).
- Settings Data and About cards (130 to 132), including the folder picker and the warning when `sharesMeetingLive` is true (`Ui_LibraryFolderShared`).
- Flush the folder note on `pagehide` (B16) and keep the tree expansion the user chose (B14).
- Show `startupError`, `skipped` and `corrupt` results with the strings added in `ui.{en,es}.json` (`Ui_Library*`).
- Replace the Library and Settings placeholders in `features/library` and `features/settings`.

**Recording and re-transcription modules**
- Register a probe on the `MeetingBusyRegistry` created in `main/index.ts` so delete and move refuse meetings in use (118, 117). Until then nothing is ever busy.
- The recorder should create the WAV at the dated stem, then call the repository `save` with `audioFilePath` set; B2 is fixed for that flow.
- After a save that changes a meeting, call `workspace.dispatch notifyMeetingChanged`.

**Session module**
- `library.getMeeting` returns the full record. `library.moveMeeting`, `library.deleteMeeting` are the only mutations the Library offers; the session screens save through the repository when they land.

**Shell module**
- Listen to `workspace.navigationRequested` and navigate; set the tag with `setCurrentShellTag`.
- `app.getVersion()` is `0.0.0` until a release version is set in `apps/desktop/package.json`.

**Not verified**
- A library written by the real WinUI app, and the reverse (155, 156). A real packaged build with a picked folder. Behavior on OneDrive-redirected Documents. Case-only folder rename on a case-sensitive volume. A WAV held open by a real recorder (only simulated with an injected `EBUSY`).
