# Record idle screen UX

## Objective

Make the idle Record screen read as a new meeting document with one obvious next action, inside the existing design system.

## Problem and why

Observed in the running app on 2026-11-04, at a 1196x768 window:

- The primary action (`Record` or `Set up to record`) sits below the fold, under the sources and setup rows.
- The setup rows use an empty circle that looks like the radio buttons directly above them, though they cannot be selected.
- The same information repeats: the sources summary line above the controls that show it, and the idle status line under the setup panel.
- The page heading and subtitle use the top of the screen for words the user only needs once, while the meeting title is a plain form field.

## Scope

Idle state of the Record page only: title and destination, sources summary line, setup rows, primary action placement, and copy for those. The recording, processing, and result states keep their behavior.

## Constraints

- `docs/port/stack.md` Design direction and `docs/port/design-system.md`: tokens only, hairlines over shadows, radius 4 to 6, no cards inside cards, `signal` only for live recording, so the Record button stays ink.
- No flow or capability is removed. Shortcuts, import, setup, and every state stay.
- All text through i18n in `en` and `es`.
- Existing `data-testid` values stay.

## Delivery

Strategy: `ask-on-risk`. Forecast: about 300 authored changed lines, on `feat/record-idle-ux`. Push, PR, and merge are the owner's decisions.

## Tasks

- [x] T1 Name the setup rows by what they do. Route: inline, one mechanical string change. Commit: see Progress.
- [x] T2 Meeting title as the document heading, destination as a quiet line under it. Route: delegated, 2+ non-trivial files.
- [x] T3 Action row that stays visible while the page scrolls, shared by `Record` and `Set up to record`. Route: delegated.
- [x] T4 Setup rows that do not look selectable, plus plainer copy. Route: delegated.
- [x] T5 Remove the repeated summary and idle status lines from the idle view. Route: delegated.

## Acceptance criteria

- At 1196x768 the primary action is visible without scrolling, in both the setup and ready states.
- Setup rows cannot be mistaken for radio buttons.
- Errors and warnings in the status area still show.
- The page keeps one `h1` and the title field keeps an accessible name.
- Light and dark screenshots read correctly. Axe reports no serious or critical issue.

## Checks

`pnpm --filter @vozella/desktop typecheck`, `pnpm --filter @vozella/desktop test`, and the Record e2e specs.

## Progress and evidence

- T1: focused i18n and Record tests passed, 281 of 281. The full desktop suite was not run for this commit.
- T1 repair: 8da467b edited `en.json` and `es.json` directly, so `scripts/convert-strings.mjs --check` and `src/main/i18n-catalogs.test.ts` failed (observed: both files reported stale). Those catalogs are regenerated from the WinUI resources again, and the new copy lives in `ui.{en,es}.json` as `Ui_Setup*`, mapped from the WinUI keys in `SetupCards.tsx`. RED: the row-name test failed once the catalogs were restored. GREEN: Record, i18n and catalog tests passed, 283 of 283.
- T2: RED, the idle document test failed on the visible heading and label. GREEN in `RecordRoute.test.tsx`. Title focus and a long title checked by screenshot; hover has no screenshot.
- T3: RED, four action row tests failed. GREEN. `record-idle.spec.ts` measured the row flush with the bottom of the scroll container and above the chat bar in a 480 px tall window. A keyboard focus test failed at 340 px tall, with the radio behind the row; a scroll margin on the idle page fixed it.
- T4: RED, heading and glyph tests failed. GREEN. No meaningful RED for the visual layout, checked by screenshot. The Check first pulled the status word 2 px off the row's baseline; fixed.
- T5: RED, `withoutSetupRepeat` tests and the summary test failed. GREEN. `Status_ReadyToRecord` was kept at first, because it does not repeat the setup panel.
- T5 follow-up, accepted by the owner: the idle page also drops `Status_ReadyToRecord` at info severity, because an enabled Record button already says it. The filter is now `withoutIdleRepeats`. RED: two tests failed. GREEN: Record tests passed, 270 of 270, and typecheck exit 0. The changed assertion in `recording-screen.spec.ts` was not run.
- Width: the idle page is now 640 px, the text column of the 720 px document layout. At the old 960 px column the 1196x768 screenshot left the status words about 500 px from the row text, so the eye could not connect them.
- Accessory removed: the setup list's bottom rule, which doubled the action row's rule. The dialog that shares the rows loses it too and still reads correctly.
- Checks: typecheck exit 0. Unit tests 1872 passed, 6 skipped. Axe found no serious or critical issue on Record in light and dark, with setup missing and ready.
- E2E: 48 of 51 passed against the running dev server's renderer (`ELECTRON_RENDERER_URL=http://localhost:5173`), since `out/renderer` is from before this work and a build would disturb the dev server. Two close-dialog tests failed and one did not run after them: those specs find the main window by `/index.html` in its URL, which a dev server URL lacks. All three passed in throwaway copies with a dev-aware lookup, and the unchanged close test passed on the older built renderer.
- Not verified: the specs on a production bundle of this code, the error notice inside the action row by screenshot (covered by unit tests only), the hover state, forced colors.

## Next step

The owner asked to merge and push on 2026-11-04, with the e2e gap below still open. `pnpm check` exit 0 on the branch: contracts 44, core 1644, platform 427 with 13 skipped, desktop 1873 with 6 skipped, native 21. ESLint now ignores `.claude/**`, because the scripts of an installed skill failed the lint.

Run the Record e2e specs on a real build when the dev server is stopped, including the changed assertion in `recording-screen.spec.ts`.
