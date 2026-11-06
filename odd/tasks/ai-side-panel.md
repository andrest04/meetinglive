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
- [ ] T2 — Content-type starter chips (video/talk/class vs meeting vs multi). Route: delegated.

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
- Known breakage outside T1 surface: `e2e/record-idle.spec.ts` reads `#content.nextElementSibling` as the chat bar (now gone); `e2e/library-ui.spec.ts:307` comment only. `Ctrl+J` is not in `app/shortcuts.ts` (outside surface); it lives in `ai-panel-layout.ts`.

## Next step
T1.
