# Settings polish

Feature identity: `settings-polish` · Branch: `feat/settings-polish` · Engram mirror: `odd/settings-polish/tasks`

## Objective

Bring the Electron Settings page (`apps/desktop/src/renderer/features/settings/`) to the DESIGN.md quality bar and clear the P1 backlog of the critique snapshot `.impeccable/critique/2026-11-05T22-16-54Z__derer-features-settings-settingsroute-tsx-d147deb6.md` (25/40).

## Problem

- The local summary model list marks every model "Recommended" (it is a hardware-fit rating, not a pick), disabled radios give no reason, and "Set up" competes with four Download buttons.
- Deleting a model or the transcription engine happens without confirmation and looks like Download.
- The transcription section reads like a spec sheet: "Not installed" next to "Live transcription: On", duplicate speaker rows, jargon, "Defaults to Spanish" in the English UI.
- Section order follows the internal registry, not the user's mental model; About is folded into Data.

## Why

The owner chose "polish + break WinUI parity" on 2026-11-05: confirmations and a new order are wanted even though the WinUI page has neither.

## Scope (authorized)

- Section order by meeting lifecycle, About as its own section.
- Summary model guidance: fit label renamed, disabled reason visible, action hierarchy.
- Confirmation before destructive deletes (models and transcription engine), visually distinct from Download.
- Transcription section clarity: state consistency, duplicate removal, jargon, wrong default copy, orphan caption.
- Visual drift on the page against DESIGN.md.
- Both locales (`en.json`, `es.json`) stay in sync.

Out of scope / follow-up: a section index or in-page navigation for the long scroll (critique P2), settings search.

## Constraints

- DESIGN.md: no danger color, signal red only for recording, ink primary, 4px/6px radii, 150ms motion.
- No behavior change outside the listed items; settings persistence untouched.
- Test-first where a deterministic Vitest test applies.

## Tasks

- [x] **T1 Order and About.** Reorder `SETTINGS_SECTIONS` by lifecycle: Microphone, Recording, Call detection, Meeting language, Transcription, Summary provider, Appearance, Language, Data, About. Move the version row out of Data into an About section. Route: delegated (writer, 3+ files). Commit `f8b823d`. RED: order tests in `sections.test.ts` and `SettingsRoute.test.tsx`, About test in `DataSection.test.tsx` failed; GREEN after the change. New copy in `ui.*.json` (`Ui_About`, `Ui_AboutVersion`); `Settings_About.Header` listed in `UNUSED_BY_DECISION`.
- [ ] **T2 Summary model guidance.** Rename the fit labels so they read as hardware fit (en "Runs well on this PC" / "May be slow" / "Too heavy for this PC", es equivalents), show why a radio is disabled ("Download to use"), keep a single primary action. Route: delegated. Partial: disabled reason ("Download to use") and the single-primary guard test in `8490397` (RED on the reason test, the primary guard passed from the start since Download was already secondary). Fit-label rename pending: it changes the setup wizard too and `features/summaries/SetupWizardDialog.test.tsx` (170-172, 357, 363, 367-368) and `e2e/summaries-wizard.spec.ts:108` assert the old text, both outside the authorized edit surfaces. Ready patch kept by the writer.
- [x] **T3 Confirmed deletes.** Confirm dialog (existing `ui/Dialog`) before deleting a summary model or the transcription engine; Delete trigger styled quiet, not like Download; announce completion. Route: delegated. Commit `bbcfbb8`; the speaker model delete is confirmed too (it is a downloaded model in the same section). RED: 7 tests in `SettingsRoute.test.tsx` and `TranscriptionSection.test.tsx`; GREEN after. Completion is spoken through a polite `role=status` region.
- [x] **T4 Transcription clarity.** Resolve the "Not installed" vs "Live transcription: On" conflict, remove the duplicate speaker rows, plain-language labels, drop the orphan acceleration caption. "Defaults to Spanish" kept: accurate. Route: delegated. Commit `37c499a`. RED: 6 tests in `TranscriptionSection.test.tsx`; GREEN after. Engine buttons keep the model name in their accessible names (passes WCAG 2.5.3, keeps e2e selectors). Summary provider labels ("Claude Code CLI", "Detected on PATH") left as is: product terminology per PRODUCT.md, outside the transcription scope.
- [x] **T5 Visual pass and verification.** Fix page-level drift against DESIGN.md, run `pnpm check` and the settings e2e, capture a light and dark screenshot. Route: delegated. Commit `9209a59` (folder paths in 13px UI text, selectable; no other drift found: no raw colors, off-scale type or arbitrary radii on the page). Styling only, no RED. Checks: `pnpm check` exit 0; settings e2e 21 passed; `impeccable detect` `[]`. `e2e/transcription-ui.spec.ts:142` fails at line 172 because Delete now opens the confirmation (outside the edit surfaces, see next step).

## Acceptance

- Every P1 in the critique snapshot is resolved; the snapshot is closed with `impeccable critique-storage close`.
- `pnpm check` passes; settings unit tests and relevant e2e pass.
- en/es locale keys match.

## Delivery

Forecast: ~400–500 authored changed lines. Strategy: `ask-on-risk`. Work-unit commits per task on `feat/settings-polish`; push and PR are the owner's decision.

## Progress

- 2026-11-05: branch created, feature document written.
- 2026-11-05: edit surfaces widened by the owner to `ui.en.json`, `ui.es.json` and `i18n-catalog-checks.test.ts`, because `en.json`/`es.json` are pinned to the WinUI resw. "Defaults to Spanish" (en.json:163) kept: accurate, `DEFAULT_SUMMARY_LANGUAGE` is `es`.
- 2026-11-05: T1 done (`f8b823d`).
- 2026-11-05: T2 partial (`8490397`), fit rename blocked on edit surface. T3 done (`bbcfbb8`).
- 2026-11-05: T4 done (`37c499a`), T5 done (`9209a59`).

## Next step

- Authorize `apps/desktop/src/renderer/features/summaries/SetupWizardDialog.test.tsx`, `apps/desktop/e2e/summaries-wizard.spec.ts` and `apps/desktop/e2e/transcription-ui.spec.ts`, then apply the parked fit-label rename (T2) and add the confirmation clicks to `transcription-ui.spec.ts` (lines 172 and 176).
- Close the critique snapshot once T2 lands (P1 #1 still has the "Recommended" wording).
