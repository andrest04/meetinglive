# Library redesign

Locator: `odd/tasks/library-redesign.md`. Engram mirror: `odd/library-redesign/tasks`.

## Objective

Redo the Library screen as three panes: folders in the app sidebar, a date-grouped logbook list, and a preview beside it. It must look deliberate, be well organized, and carry no generic AI styling.

## Problem and why

- Folders and list share one scrolling column.
- Rows show only title, date and snippet.
- Search covers titles in the current folder only.
- Every click leaves the screen.
- There is no multi-select, and delete is permanent while local files are the only copy.

## Scope

In: everything in the tasks below. Out: scrolling to the exact line of a transcript hit, a splitter between panes, folder reparenting, tags, trash inside the app, SQLite.

## Constraints

- `docs/port/stack.md`: tokens only; `signal` only for live recording; hairlines over shadows; radius 4-6; no gradients, glass, emoji or purple; no cards inside cards; motion 120-160 ms, opacity and small translate; one quiet line for empty, skeletons of real layout; sentence case; WCAG 2.2 AA; forced colors; flows are not removed (:71); parity recorded (:73); test first where deterministic (:74); i18n en and es (:75); `pnpm check` before each commit (:77).
- `features/*` talk to IPC, `ui/` is pure, `core` has no Electron or Node I/O, IPC goes through zod in `packages/contracts`.
- New strings go in `ui.en.json` and its `es` counterpart with the `Ui_` prefix (`translate.test.ts:26-34`). Do not edit generated `en.json` and `es.json`.
- `cn` in `ui/cn.ts` only joins classes, so use exclusive ternaries instead of overriding Tailwind classes.
- Playwright loads `out/`: rebuild first and keep `ELECTRON_RENDERER_URL` unset.
- Conventional Commits with no AI attribution or Co-Authored-By lines.
- About 400 authored lines per task is a planning heuristic only, not a cap. Never omit tests or split artificially to fit it.
- Receipt-driven development is off globally: no native review runs. Ordinary checks apply.

## Design

Direction: a meeting logbook, ruled like a ledger and reading like a document.

```
+----------+--------------------------+----------------------------+
| Vozella  | Clients  12    ...       |                            |
| Record   | Note about this folder   | Roadmap review             |
| Library  | [Search meetings]  [x]   | Tuesday 3 November,        |
|  All 128 | Today               [ ]  | 10:30 to 11:15             |
|  Inbox 3 | 10:30  Roadmap review    | [Open meeting] Summary     |
|  ------- | 45 min Agreed to ship... |   Transcript               |
|  * Client| ======-------------------|                            |
|  * Studio| 09:00  Standup           | Summary text in reading    |
|          | 10 min Blockers on...    | width...                   |
|  New fold| ==-----------------------| Action items               |
| Settings | Yesterday           [ ]  | Attendees, recording       |
+----------+--------------------------+----------------------------+
|                 chat bar (scope follows the folder)              |
+------------------------------------------------------------------+
```

- Memorable element: each row's bottom ruling is the data. It darkens from the left in proportion to duration: square-root scale, capped at 120 min and 64 px. `aria-hidden`; the duration is also in the row text. No `endedAt` means no darkened ruling and no duration. Stroke of 1 or 2 px is decided from real screenshots in batch 4.
- Color: existing tokens only. `paper` for list and preview, `paper-raised` for sidebar, `hairline` for structure, `pressed` for the cursor row and `<mark>`. Forced colors: `Highlight`, `Mark`, `CanvasText`.
- Type: `heading` 20/28 semibold for the view name; `ui-lg` medium for row titles; `ui` 13/20 medium for day headers and plain for snippets; Plex Mono `caption` for time, duration and counts; `title` 30/36 semibold -0.02em for the preview title, up to 3 lines (`features/session/SessionHeader.tsx:49`); `read` 15/24 at about 62ch for body. The meta line is a plain sentence: "Tuesday 3 November, 10:30 to 11:15".
- Rejected as generic: card rows, status pills, all-caps group labels, avatars, colored tags, dotted meta strings, waveform thumbnails, a tinted preview panel, a page-level "Library" title.

## Decisions

**State.** Zustand `features/library/library-store.ts`, connected once from `AppShell` by `connectLibrary()` in the `connectLiveAsk` pattern (`stack.md:14`). Holds folders, meetings, skipped, problem, view, expansion, cursor id, scroll offset. Load deferred to idle, refresh debounced 150 ms, because `library.load` costs about 709 ms at 3,000 meetings and now runs on every route. Route-local: query, checked set, dialogs, preview fetch, and note through `useFolderNote`, which keeps the B16 logic of `use-library.ts:150-179`. Keep the audit tests passing unchanged.

**Views.** `{all} | {inbox} | {folder,id}`. All and Inbox both publish `null` as now (`scope-resolver.ts:47`); the distinction lives in the store. Default is All. Deleting a folder still lands on Inbox (#107).

**Sidebar.** `NavRail` gets a slot after Library: Record, Library, tree (`flex-1`, own scroll), quiet New folder row, Settings pinned at the bottom, DOM order unchanged. One tree, one tab stop: All, Inbox, gap, folders, with mono direct counts. Always visible on all routes; selection highlighted only on `/library` and `/session`. Folder click elsewhere: set the view, then dispatch `navigateTo History` (`AppShell.tsx:21` navigates). Right click elsewhere must not navigate: add `selectOnContextMenu` to `Tree` (`Tree.tsx:161`); choosing a menu entry goes to `/library` and opens the dialog there. Dialogs and notices stay in the route. `Tree` gets `rowProps(id)` for drop targets so `ui/` stays pure.

**Shell.** `paned = pathname === '/library'`. `main` becomes `overflow-hidden flex flex-col` with no `pb-8`; the column becomes `flex min-h-0 flex-1 flex-col`. Same elements, so `Outlet` does not remount. `CallPromptBar` stays above the panes, `ChatBar` under `main`; panes are `min-h-0`.

**Folder header (list pane).** Breadcrumbs for real folders only (#88), `h1` with accent icon, count, `...` menu (rename, personality, delete), borderless note. The old narrow overlay goes away: it was unreachable at the 960 px window minimum.

**Narrow.** Keep the ResizeObserver hook because click behavior changes. Content 760 px or more shows list and preview, list `clamp(340px, 38%, 440px)`. Below that, no preview and a click opens the meeting. Sidebar stays 232 px.

**List.** `role="grid"` with `aria-multiselectable` and `aria-rowcount`, `rowgroup > row[aria-rowindex, aria-selected] > gridcell`, with roving tabindex; headers are `row > rowheader`. Flat `{header|meeting}` items, fixed 32 and 64 px. `rangeExtractor` adds the active header, focused row and dragged rows; the active header is `position: sticky`, others use transforms, with no duplicate node and no `aria-hidden` clone. jsdom needs `offsetHeight` and `offsetWidth` stubs in `library-test-kit.tsx`.

**Click and selection.** Click previews; double-click or Enter opens (default tab Transcript, a search hit opens its own tab, notes hits open Summary). Cursor and checked set are separate: arrows move cursor and preview, Space toggles, Shift+arrow extends, Esc clears checks and then the query. Autoselect newest on wide layouts. Coming back from a meeting restores cursor and scroll. Checked set clears on view or query change; refresh intersects it with live ids. Ctrl+A selects every match and waits for stage 2 search. Ctrl+F and Ctrl+A go in `app/shortcuts.ts`; F2, Delete and the rest in a pure `library-keys.ts`, since `ShortcutDef.ctrl` is always true. F2 reuses `session.rename`: verify it broadcasts `library.changed`.

**Preview.** `MarkdownView` (`features/summaries/MarkdownView.tsx:163`), 120 ms debounce, sequence guard, small record cache refetched on change, skeleton only after 150 ms. No summary: start of transcript. Preview does not dispatch `selectMeeting`, since that emits `scopeChanged` on each arrow key (`workspace.ts:105-109`). Dispatch only on open.

**Delete.** Today `deleteLocked` unlinks audio, sibling WAV and markdown (`markdown-meeting-repository.ts:166-172`). Add `discard` used only at those three calls; line 147 keeps `unlink`, as it removes the old file of a move. Inject through `library-runtime.ts:283` with `shell.trashItem` from `main/index.ts`; under `fakeNative` keep unlink. New key `Ui_LibraryDeleteContent` replaces the "permanently" text. If trash rejects, return reason `trash-failed` and offer an explicit "Delete permanently" with `mode: 'permanent'`. Shift+Delete asks for permanent delete directly.

**Bulk.** `library.moveMeetings {meetingIds, folderId}` and `library.deleteMeetings {meetingIds, mode}` return per-id results, one `library.changed` and `notifyDeleted` per id. Single channels stay (`session-shell.spec.ts:192`). Show a busy bar. Add batch-scoped scanning only if 200 moves measure over 10 s.

**Search.** `library.search {query, scope, requestId}` returns `{requestId, stale, hits:[{meetingId, field, snippet|null}]}`. Pure logic in `packages/core/src/library/meeting-search.ts`, length-preserving folding so offsets map to the original. Port gains `bodies(filter)`; repository keeps an LRU of folded text capped at 64 MB keyed by mtime and size. Originals re-read only for the newest 200 hits; later hits fall back to the index snippet. Superseded requests are abandoned between files. Accent-insensitive, words ANDed, stage 2 needs 2+ characters and a 200 ms debounce, merged results stay date-ordered, and the scope switch appears unless already in All. Gate: at most 800 ms cold and 150 ms warm at 3,000 meetings; report the measurement.

**List items.** Add `endedAt`, `hasSummary`, `hasTranscript`, `busy` in `contracts/library.ts:20`, `core/library/meeting.ts:62`, `in-memory-library.ts:14`, `markdown-meeting-repository.ts:315`. `busy` is mapped in `LibraryService.load` from `isBusy`, which means summarizing only (`main/index.ts:744`): check that generation start fires `library.changed`, and add a broadcast if not. The index is memory-only and `indexFile` already parses the whole file, so no migration.

**Drag.** Native HTML5. Type `application/x-vozella-meetings`, ids held in the store because `getData` is unavailable during `dragover`. Unchecked row drags alone; checked row drags the set. Pin dragged rows in the range. Hovering a collapsed folder 600 ms expands it. All is not a target. Move shows a toast with Undo using prior folder ids. The Move dialog and menu satisfy WCAG 2.5.7.

## Delivery

Strategy `feature-branch-chain`, one branch per batch, each from the previous: `feat/library-redesign-b1-data`, `-b2-shell`, `-b3-interactions`, `-b4-polish`. Base: `feat/library-redesign`. Push, PR and merge stay with the owner. Forecast: about 3,700 authored lines.

Route: delegated direct through a Workflow requested by the owner, one writer at a time. Trigger: 2+ non-trivial files per batch.

## Tasks

### Batch 1: data and search (about 900)
- [x] T1.1 List items carry length and state; All view; folded titles
- [x] T1.2 Delete goes to the Recycle Bin
- [x] T1.3 Bulk move and delete
- [x] T1.4 Full-text search with timing harness

### Batch 2: shell, sidebar, list (about 1,250)
- [x] T2.1 Folders move to the sidebar, with store and counts
- [x] T2.2 Paned layout and folder header
- [x] T2.3 Date-grouped virtual grid (`pnpm --filter @vozella/desktop add -E @tanstack/react-virtual`)

### Batch 3: preview, search UI, bulk, keyboard, drag (about 1,250)
- [x] T3.1 Preview pane
- [x] T3.2 Two-stage search UI
- [x] T3.3 Multi-select and bulk bar
- [x] T3.4 Keyboard
- [x] T3.5 Drag to folders, Undo

### Batch 4: visual critique and close-out (about 300)
- [ ] T4.1 Screenshots and critique: light and dark, en and es, 960 and 1180 wide, empty, loading, search, bulk, forced colors, 3,000 meetings; fix what fails; remove one accessory
- [ ] T4.2 Axe e2e pass over grid and tree
- [ ] T4.3 Update `docs/port/parity/library-storage.md` (improved: 82, 84, 94, 96, 98, 100, 109, 111, 113, 114, 119, 120; must stay true: 86, 87, 88, 105, 107, 110/B16, 115, 123; rewrite the "Layout" and "Shell" notes, add search and trash decisions) and regenerate `docs/port/screens/library-storage/`

## Acceptance

- All checks below pass on the final branch.
- Every existing Library flow still works, and parity is recorded.
- Search gate is measured and reported.

## Checks

- Per commit: `pnpm check`
- Focused unit: `pnpm --filter @vozella/desktop exec vitest run src/renderer/features/library`
- Focused e2e: `pnpm --filter @vozella/desktop build`, then `pnpm --filter @vozella/desktop exec playwright test e2e/library-ui.spec.ts`
- From batch 2, by the owner's decision on 2026-11-04 for speed, as an exception to `stack.md:77`: focused Library unit tests per commit, `pnpm check` at the end of each batch, and one e2e run at the end of batch 4, excluding the `pill-*` specs. Those specs cover the screen with a magenta backdrop and stay pending for the owner to run while away from the machine. Every Playwright run sets `VOZELLA_E2E_BACKGROUND=1` (`e2e/background-windows.cjs`), because the owner is using the machine: sampled across 16 specs, no Electron window was on-screen and focus never moved. Batch 1's full e2e run was interrupted and has no result.
- Screenshots: `VOZELLA_SCREENSHOTS=1` with `library-screens.spec.ts`
- Manual, pending: real Recycle Bin restore; `trashItem` on a volume with no bin; screen reader pass

## Progress

Each batch writer records its commit hashes and observed check results here. A commit cannot name its own hash, so each entry is filled in by the next commit.

### Batch 1 (`feat/library-redesign-b1-data`)

- T1.1 `faa918e` `feat(library): list items carry length and state, with an All view and folded titles`. `pnpm check`: passed; contracts 44 tests, core 1654, platform 428 passed and 13 skipped, desktop 1875 passed and 6 skipped. Generation start did not fire `library.changed`: `ObservedSummaryService` in `main/summaries` now broadcasts at the start and end of a run, because `packages/core/src/summaries` is not part of this batch. `emptyFlags` is unchanged, so T2.1 decides the All view's empty copy.
- T1.2 `ed6d91c` `feat(library): deleting a meeting moves it to the Recycle Bin`. `pnpm check`: passed; contracts 44, core 1656, platform 432 passed and 13 skipped, desktop 1878 passed and 6 skipped. When the bin refuses, the current screen opens a second dialog offering "Delete permanently". Real Recycle Bin restore and a volume with no bin stay manual and pending.
- T1.3 `230f639` `feat(library): move and delete many meetings in one request`. `pnpm check`: passed; contracts 44, core 1661, platform 435 passed and 14 skipped, desktop 1883 passed and 6 skipped. 200 moves at 3,000 meetings measured 29,838 ms, over the 10 s line, so the repository gained `batch`, which reuses one scan: 2,537 ms after it (`library-timing.test.ts`, about 3 KB per meeting).
- T1.4 `feat(library): full-text search across meetings`. `pnpm check`: passed; contracts 44, core 1681, platform 447 passed and 17 skipped, desktop 1885 passed and 6 skipped. An earlier run failed once on `notepad-markdown.test.ts` "is idempotent for a long mixed document" with a 5000 ms timeout under the full suite; that file is untouched here and it passed alone (106 tests) and on the rerun.
  - Search gate, measured on this machine at 3,000 meetings with files the OS already cached. Gate: 800 ms cold, 150 ms warm. Figures are every word matching every meeting / one meeting matching / nothing matching, in ms.
    - 13 MB (40 transcript lines): cold after `library.load` 148 / 83 / 72, warm 137 / 76 / 67. Gate met. Cold as the first thing in the process, which the app never does: 1161 / 1022 / 982.
    - 78 MB (250 lines, about 30 minutes): cold after load 195 / 167 / 78, warm 191 / 164 / 69. Cold gate met; warm over by 41 and 14 ms in the first two. First thing in the process: 2168 / 1987 / 2054.
    - 156 MB (500 lines, about an hour): cold after load 1166 / 1280 / 990, warm 1221 / 1150 / 954. Gate missed: the folded text outgrows the 64 MB cap, so part of the library is re-read on every search. First thing in the process: 3799 / 3878 / 3632.
    - `library.load` first run: 985 ms at 13 MB, about 2 s at 78 MB, about 2.7 s at 156 MB; second run about 70 ms.
  - Choices the document left open: indexing keeps the folded text it already parsed, so a search after `library.load` reads nothing twice; the cache will not evict what the last two searches used, because a repeated full scan otherwise gets no hits at all once the library outgrows the cap; stamps and speaker tags are not searchable; `summary` also holds action items, follow up and project plan, `notes` also holds brief and attendees; a query shorter than 2 characters returns no hits.
  - The e2e for T1.3's bulk channels landed with this commit, in `library.spec.ts`.

### Batch 2 (`feat/library-redesign-b2-shell`)

- T2.1 `0cac442` `feat(library): folders live in the sidebar, backed by a shared store`. RED: the new store and sidebar tests failed on the missing modules and the three new `Tree` tests failed, then passed. Focused unit: 62 passed. `playwright test e2e/library-ui.spec.ts` with `VOZELLA_E2E_BACKGROUND=1`: 7 passed, 2.4 min. Choices: an empty All shows the empty library copy with its Record action, even when folders exist; a stored folder that no longer exists lands on the Inbox; opening the route still reloads, because a store that outlives the route would otherwise miss files that appeared with no change event; counts of zero are not drawn; `LibraryRoute.audit.test.tsx` changed only in the mount line and import, since the tree no longer lives inside the route. The `TreeNode` type stays as it was: counts come through a `trailing` prop.

- T2.2 `01d6df0` `feat(library): the list and preview are panes, with a folder header`. RED: 4 of 32 tests in `LibraryRoute.test.tsx` failed on the header and preview pane, then passed. Focused unit: 67 passed. `playwright test e2e/library-ui.spec.ts e2e/shell.spec.ts e2e/shell-chrome.spec.ts` with `VOZELLA_E2E_BACKGROUND=1`: 26 passed, 1 skipped (screenshot-only), 4.3 min. The preview pane is empty on purpose until T3.1. At the 960 px window minimum the content is 728 px, under the 760 px line, so the smallest window has no preview.

- T2.3 `8eb279c` `feat(library): meetings are a date-grouped virtual grid`. RED: `logbook.test.ts` failed on the missing module, and `library-grid.spec.ts` failed with the grid not found. Then GREEN. `library-grid.spec.ts` is the real-renderer proof of the recipe, 5 passed: only part of 210 rows is in the DOM; the header of the day under the top row is `position: sticky`, sits at the top of the grid and names that row's day; every `aria-rowindex` appears once, so no clone; the focused row stays attached and focused 4,000 px away, and ArrowDown lands clear of the sticky header; coming back from a meeting restores the row and the scroll. `playwright test` with `VOZELLA_E2E_BACKGROUND=1` over `library-grid`, `library-ui`, `chat-bar`, `chat-recipes`, `transcription-ui`, `session-shell`, `transcription-screens`: 37 passed, 11 skipped, 4.4 min (the skips include the specs gated on `VOZELLA_SCREENSHOTS=1`). `library-screens.spec.ts` was edited for grid and row but did not run: it needs a shown window and belongs to T4.1.
  - Differences from the decisions above: the installed virtual core reads `clientHeight`, not `offsetHeight`, so `stubLayout` stubs that. Rows are reached with ArrowUp, ArrowDown, Home, End, PageUp and PageDown, Enter opens, and Tab goes on to the row's More actions, because a roving tab stop without arrows would have removed keyboard access; the rest of T3.4 stays in batch 3. `aria-selected` is always false until T3.3. Time is 24 hour in every locale, as the design shows it, with the full short date and time on hover (item 111). A meeting with an unreadable date goes under "No date".
  - For T4.1: in background mode CSS transitions lag behind in screenshots, so a highlight can look stale. Wait longer or disable transitions before judging the sidebar.
- Batch close, on `8eb279c`: `pnpm check` passed; contracts 44 tests, core 1681, platform 447 passed and 17 skipped, desktop 1928 passed and 6 skipped. The focused e2e runs came before two class-only changes in that commit (note and empty-state padding); batch 4's full run is their first e2e proof.

### Batch 3 (`feat/library-redesign-b3-interactions`)
- T3.1 `feat(library): a click previews the meeting beside the list`.  `2714bb0` RED: 18 of 108 focused tests failed on the missing preview, `formatMeetingSpan` and `nextCursor`, then passed. Focused unit: 108 passed. `playwright test` with `VOZELLA_E2E_BACKGROUND=1` over `library-grid`, `library-ui`, `session-shell`, `chat-bar`, `chat-recipes`, `transcription-ui`: 36 passed, 3 skipped, 1 failed on the first run. The failure was real: the time on the cursor row was `ink-faint` on `pressed`, under AA, and autoselect now always shows such a row. The cursor row uses `ink-muted` for it, and `library-ui.spec.ts` then passed, 8 of 8. `transcription-screens.spec.ts` was edited for double click and did not run, because it is gated on screenshots. Choices: Open meeting opens the tab the preview shows; a row that goes away moves the cursor to the next row; the audit test at item 117 now finds the row by role, because the preview repeats the title (its only change).
- T3.2 `feat(library): search reads inside meetings as well as titles`.  `d655c8f` RED: 8 route tests failed and `search-results.test.ts` failed on the missing module, then passed. Focused unit: 124 passed. `playwright test e2e/library-ui.spec.ts` with `VOZELLA_E2E_BACKGROUND=1`: 8 passed, 2.5 min, including a word found only in a transcript through the real channel, with its `<mark>`. Choices: while the second stage reads, the list holds title matches only, because an answer for other text says nothing about this one; "No meetings match your search." waits for that answer; if the second stage fails the title matches stay and the line says only titles were searched; a change in the library asks again without flicker.
- T3.3 `feat(library): check several meetings and act on them together`.  `eb73b3e` RED: 10 route tests failed and `library-selection.test.ts` failed on the missing module, then passed. Focused unit: 143 passed. New `library-interactions.spec.ts` with `VOZELLA_E2E_BACKGROUND=1`: failed first on `color-contrast`, because `ink-faint` time on a checked row is under AA, then 1 passed (30 s), with the files checked on disk and axe run with the bar up. Choices: the row and day checks are not tab stops, because Space checks from the row and the grid keeps its one stop; the day checks therefore have no keyboard route of their own, and Shift+arrow gives the same result; a plain click never clears checks; a row action from a checked row applies to the set; meetings that failed stay checked.
- T3.4 `feat(library): the list works from the keyboard`.  `6b04c9a` RED: 19 tests failed across `LibraryRoute.test.tsx` and `shortcuts.test.ts`, and `library-keys.test.ts` failed on the missing module, then passed. Focused unit with `src/renderer/app/shortcuts`: 169 passed. `library-interactions.spec.ts` with `VOZELLA_E2E_BACKGROUND=1`: 2 passed, 43 s. `session.rename` does not broadcast `library.changed` (only the Library handlers and generation do), and `src/main` is outside this batch, so F2 refreshes the list itself after the rename. Choices: Ctrl+A acts only with the focus on a row, because in a text field it must keep selecting text; Ctrl+A during the second stage waits for the whole list; ArrowDown from the search goes to the list; after a keyboard delete the focus goes to the neighbor row, and a mouse delete leaves focus alone.
- T3.5 `feat(library): drag meetings to a folder, with Undo`. RED: 8 of 95 route tests failed (a ninth, meaningless, test was dropped before GREEN), then passed. Focused unit: 172 passed. **Playwright drag works in Electron**, also off-screen: `locator.dragTo()` moved a meeting to a tree row with `VOZELLA_E2E_BACKGROUND=1`, the file moved on disk and Undo brought it back; `library-interactions.spec.ts`: 3 passed, 57 s. `library-grid.spec.ts` gained a real mouse drag proving the dragged row stays attached while the list scrolls 6,000 px away. That spec failed once of three runs on the older "coming back" test, in `name` being empty: `scrollTo` waits a fixed 150 ms, and the off-screen window had not rendered the new rows yet. It now polls for a row in view: 6 passed. Deviation: Undo is its own `UndoOffer` inside the list pane, not a toast, because `ui/Toast.tsx` has no action and is outside this batch; 8 s, held while hovered or focused. Choices: Undo also follows the Move dialog; a meeting from a folder that is gone is returned to the Inbox; a drop where the meetings already are does nothing.

## Next step

Batch 3. Owner to decide whether the 64 MB cap or the gate moves for libraries of hour-long meetings.
