# Feature: AI side panel (Phase 1 of the AI panel plan)

## Objective
Replace the bottom chat bar with a Notion-style AI side panel: a floating launcher bottom-right that opens a resizable panel docked on the right, available on every route except Settings, with starter chips that fit the content type.

## Problem / why
The chat bar sits at the bottom of every route, force-collapses on every scope change and shows fixed meeting recipes. Users expect the Notion/Zoom pattern (right panel + launcher). Plan: `~/.claude/plans/quiero-saber-como-podemos-whimsical-flute.md` (approved 2026-11-05), competitor research in Engram `research/meeting-ai-chat-competitors`.

## Scope
In: panel + launcher + Ctrl+J, resizable (Splitter `fixedPane: 'end'`), overlay mode on narrow windows, persisted open state/width, scope chip, stays open across navigation, content-type starter chips, docs + tests.
Out (later phases): real streaming, citations, attachments, live chips, saved prompts, chat history UI.

## Constraints
- Reuse `ChatBody.tsx` and chat hooks; `ChatBar` mount removed from `AppShell.tsx`.
- DESIGN.md: `bg-paper-raised`, `border-s border-hairline`, no shadow at rest, 150ms `--ease-out-quick`, reduced motion.
- Min window 960×680, sidebar 232px; toasts at bottom-right z-50.
- Keep test ids where possible; update e2e that depended on the bar.

## Delivery strategy
`exception-ok` (local merge into `main`). Forecast ~700 authored lines. RDD off (global).

## Tasks
- [x] T1 — Panel shell: `AiPanel`, `AiLauncher`, Splitter end-pane option, overlay mode, Ctrl+J, persistence, scope chip, remove bottom bar; unit + e2e + DESIGN.md/spec. Route: delegated (multi-file).
- [x] T2 — Content-type starter chips (video/talk/class vs meeting vs multi). Route: delegated (core + renderer, 2+ non-trivial files).

## Acceptance criteria
- Launcher visible bottom-right when panel closed; click or Ctrl+J toggles; panel docks right, resizes 320–520px, remembers width/open state across restarts.
- Below the dock threshold the panel overlays content instead of crushing it.
- Panel stays open when navigating; scope chip follows the current view; hidden on Settings.
- Sending, recipes menu, stop, copy, links and provider gate behave as before.
- Chips fit the content type.

## Checks
`pnpm typecheck`, `pnpm --filter @vozella/desktop test`, `pnpm --filter @vozella/core test`, chat e2e specs (`pnpm test:e2e` filtered), manual run with screenshot.

## Progress / evidence
- T1 implemented (delegated writer), commit pending. Files: `features/chat/{AiPanel,AiLauncher}.tsx`, `ai-panel-layout.ts`, `ui/Splitter.tsx` (`fixedPane`, `initialSize`, `collapsed`), `ui/splitter-logic.ts`, `ui/Toast.tsx` (`--launcher-clearance`), `AppShell.tsx`, `ChatBody`/`MessageList` (fill height), `RecipesMenu` (`max-w-full`), i18n `Ui_AiPanel{Open,Close,Resize}`, DESIGN.md, spec chat §2.1. `ChatBar.tsx` deleted; its tests migrated to `AiPanel.test.tsx` / `AiPanel.send.test.tsx`; `chat-bar.spec.ts` renamed `chat-panel.spec.ts`.
- RED observed: splitter-logic end-pane (3 fail), Splitter end-pane (3 fail), ai-panel-layout and AiPanel (module missing). GREEN: all pass.
- Checks: `pnpm typecheck` pass; `pnpm --filter @vozella/desktop test` 2113 passed / 6 skipped; prettier + eslint clean on touched code. e2e: `chat-panel.spec.ts` 8/8 passed in one run before the stop; the other chat specs and shell-chrome were updated but not re-run (skipped, user request: no app windows).
- Resolved at chat-speed-citations T5 (commit pending): `record-idle.spec.ts` rewritten for the panel layout (row meets the window bottom; launcher never covers row controls), `library-ui.spec.ts` comment fixed, `chat-recipes.spec.ts` counts the content recipes; all chat specs, shell-chrome, record-idle, library-ui, session-shell pass. Was: `e2e/record-idle.spec.ts` reads `#content.nextElementSibling` as the chat bar (now gone); `e2e/library-ui.spec.ts:307` comment only. `Ctrl+J` is not in `app/shortcuts.ts` (outside surface); it lives in `ai-panel-layout.ts`.
- T2 implemented (delegated writer), commit pending. Core `recipes.ts`: 4 content recipes (ids `…106`–`…109`, name keys `Ui_Recipe{KeyIdeas,Explain,Quotes,Study}Name`, English prompts that answer in the language of the recording), `RecipeContext { hasActionItems? }`, `prefersContentRecipes`, `recipesForScope`/`starterRecipes` take an optional context. A Meeting scope with `hasActionItems === false` orders key-ideas, explain, quotes, discussed, study, then the meeting recipes; otherwise catalog order (meeting first, content after). Live/Folder/AllMeetings unchanged (Live menu now also lists the content recipes after the meeting ones). Renderer: `features/chat/use-recipe-context.ts` reads the scoped meeting through the existing `library.getMeeting` IPC (no new IPC), re-reads on `library.changed`, unreadable meeting = content; `ChatBody` shows no chips until it is known. i18n keys in `ui.{en,es}.json`.
- RED observed: core `recipes.test.ts` 9 failed; `ChatBody.test.tsx` 5 failed. GREEN: all pass.
- Checks: `pnpm --filter @vozella/core test` 1733 passed; `pnpm typecheck` pass; prettier + eslint clean on touched files; `pnpm --filter @vozella/desktop test` 2118 passed / 6 skipped. e2e skipped (user request: no app windows).
- Outside surface, not updated: `docs/port/parity/chat.md` (items 106, recipe API line) still says "first 4 of the scope list" / old signature.

## Next step
Commit T2; update `docs/port/parity/chat.md`; run chat e2e when the user allows app windows.
