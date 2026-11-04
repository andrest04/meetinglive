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
- [ ] T2 Meeting title as the document heading, destination as a quiet line under it. Route: delegated, 2+ non-trivial files.
- [ ] T3 Action row that stays visible while the page scrolls, shared by `Record` and `Set up to record`. Route: delegated.
- [ ] T4 Setup rows that do not look selectable, plus plainer copy. Route: delegated.
- [ ] T5 Remove the repeated summary and idle status lines from the idle view. Route: delegated.

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

## Next step

T2 to T5 in one delegated writer pass.
