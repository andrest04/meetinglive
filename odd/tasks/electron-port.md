# Electron port

## Objective

Port every Vozella feature from WinUI3/.NET to Electron, with a new interface built on the Vozella brand (Notion and Granola as visual references).

## Problem and why

The user wants the product on Electron so the brand tokens drive the UI and macOS becomes reachable later. WinUI ties the UI and the capture stack to Windows.

## Scope

- New app in `apps/desktop`, complete functional parity with `MeetingLive.App` and `MeetingLive.Core`.
- Fix bugs and uncovered cases found while porting; record each one.
- Research-backed stack per area, recorded in `docs/port/stack.md`.

## Constraints (agreed with the user, 2026-11-02)

- Windows implemented and tested tonight. Native code sits behind interfaces so macOS can follow without a rewrite.
- WinUI code stays intact. Nothing is deleted.
- Branch `feat/electron-port`. Work-unit commits only. No push, PR, or merge.
- Development uses an isolated data folder. The user's real `Documents\MeetingLive` is never read or written. The on-disk format stays compatible.
- Installing Rust, pnpm, C++ build tools, and downloading models is authorized.
- The user's Claude, Codex, xAI, and TypeSafe accounts are not used. Those integrations are tested with doubles and flagged as pending real validation.
- Unattended run: no further questions. Decisions are made and recorded here.
- Artifacts in English. No AI-looking design or copy. Red `signal` means live recording only.

## Delivery

- Strategy: `exception-ok`, one long-lived feature branch. The user asked for no PR and no interruptions; slicing is left for when they choose to deliver. The forecast is far over 400 authored lines.
- RDD: off (global), so no native review. Independent review runs through a workflow stage instead.
- Route: delegated direct. Trigger: more than two non-trivial files per module and broad mapping.

## Tasks

- [ ] T1 Research the stack per area and write behavior specs per module (`docs/port/research`, `docs/port/specs`)
- [ ] T2 Decide the stack and architecture (`docs/port/stack.md`), resolve project skills
- [ ] T3 Scaffold `apps/desktop`: shell, design system, IPC contract, test harness
  - [x] T3.1 Foundation: pnpm workspace, typed IPC, hardened shell, data-root guard, native addon, workers, test harness, NSIS packaging (see progress)
  - [ ] T3.2 Design system (`ui/`, tokens, fonts, i18n scaffolding): not started
- [ ] T4 Port the domain and persistence layer
- [ ] T5 Port native capture and ASR
- [ ] T6 Port summaries, chat, and integrations
- [ ] T7 Port all screens and windows
- [ ] T8 Review, end-to-end checks, packaging
- [ ] T9 Morning report: verified, pending, and what the user must validate

## Acceptance criteria

- Each module spec's parity checklist is implemented or has a recorded reason.
- Typecheck, lint, unit tests, and build pass in `apps/desktop`.
- The packaged app launches and its main flows are driven end to end with synthetic audio.

## Progress and evidence

Branch created from `main` at 53438c5.

### T3.1 foundation (observed 2026-11-03)

- Layout per stack.md: `apps/desktop`, `packages/{contracts,core,platform}`, `native/vozella-native`. Root scripts: `pnpm check` (typecheck, lint, unit tests), `dev`, `build`, `package`, `test:e2e`.
- pnpm 12: `allowBuilds` in `pnpm-workspace.yaml` (electron and esbuild on; koffi and electron-winstaller off). Root `postinstall` runs `apps/desktop/scripts/ensure-electron.mjs`, which retries the Electron binary download three times.
- IPC: `defineRequest` and `defineEvent` with zod; `serveRequest` and `callRequest` validate input and output at both ends; `app.getInfo` is the real request and `app.focusChanged` the real event.
- Security: contextIsolation, sandbox, no nodeIntegration, CSP (meta tag plus header), renderer served from a privileged `vozella://app` scheme (so the file-protocol fuse can be off), navigation, redirect, window-open and webview blocked, permissions denied, IPC sender check (top frame, known window, app origin), single instance, rotating log (1 MiB x 5), global error handling.
- Data root: `VOZELLA_DATA_ROOT` honored. The guard refuses `Documents\MeetingLive`, `%LOCALAPPDATA%\MeetingLive`, any path segment named MeetingLive, and links into them. Decision: an env override into those folders is refused in every mode; unset in dev or test falls back to a temp folder.
- Native: napi-rs crate with audio (mic, system, process), calendar probe and DPAPI. Loaded in a utilityProcess (`src/workers/audio`) with start, restart-on-crash with backoff, and stop. The ASR worker skeleton loads koffi.
- Fuses: the release build is hardened; the e2e variant keeps only the node CLI inspect fuse on (`VOZELLA_PACKAGE_VARIANT=e2e`).
- Pending in T3: design system, i18n scaffolding, signing, app icon, auto-update. Not validated: real device capture (tests open no audio device), clean-VM install, Windows 10.

## Next step

T3.2 design system, then T4.
