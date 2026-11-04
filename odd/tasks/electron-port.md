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

- [x] T1 Research the stack per area and write behavior specs per module (`docs/port/research`, `docs/port/specs`)
- [x] T2 Decide the stack and architecture (`docs/port/stack.md`), resolve project skills
- [x] T3 Scaffold `apps/desktop`: shell, design system, IPC contract, test harness
  - [x] T3.1 Foundation: pnpm workspace, typed IPC, hardened shell, data-root guard, native addon, workers, test harness, NSIS packaging (see progress)
  - [x] T3.2 Design system, i18n (647 keys, en/es parity), shell. Independent verifier: check passes, e2e 9 passed and 3 screenshot specs skipped by default
- [x] T4 Port the domain and persistence layer. Audit findings stay open, see Closing state
- [x] T5 Port native capture and ASR. Audit findings stay open, see Closing state
- [x] T6 Port summaries and chat. JEV/TypeSafe and xAI were cut. Audit findings stay open, see Closing state
- [ ] T7 Port all screens and windows. Partial: live copilot and shell-platform not ported
- [ ] T8 Review, end-to-end checks, packaging. Not run
- [x] T9 Closing report: verified, pending, and what the user must validate

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

### Accepted changes (owner, 2026-11-03)

- Topology: remaining modules run in parallel waves, each module in its own worktree under `C:\Code\vozella-worktrees`, on `port/<module>` branches merged into this branch after each wave. Waves, shortened at the owner's request for speed: summaries and call detection; recording, chat, and session views; live copilot and shell. Packages inside a module stay sequential, because writers in one worktree would break each other's checks.
- Method: small work packages per module, audit slices of at most 25 items with file:line evidence, and a fix after every audit round. The first four modules were re-audited this way because the earlier audits left findings open.
- Cut from the port, may return later: JEV/TypeSafe; calendar reading (Coming up, reminders, event linking, calendar settings, pre-meeting brief), while call detection and its popup stay; xAI/Grok; suggest title, custom note template, nav-pane resize grip, meeting-app suggestion bar; chat thread history and user recipes. On-disk keys for these stay readable and are preserved.
- Open: the last fix of each re-audited module had no audit after it, so T8 audits them again. Settings and audio capture were converging poorly.

- Closed by the owner on 2026-11-03 at a stopping point after wave 2. Live copilot and shell-platform were not ported, and T8 and the packaged launch were not run.

### Closing state (observed 2026-11-03)

- Integrated on `feat/electron-port`: audio capture, transcription, library and storage, settings, summaries, call detection, recording, chat, session views. Nothing pushed; `main` untouched.
- Run by the orchestrator on the integrated branch: `pnpm check` exit 0 (contracts 44, core 1454, platform 419 with 13 skipped, desktop 1501 with 6 skipped, native 21) and `pnpm build` exit 0. `cargo` must be on PATH.
- Reported by the integration agent, not repeated: full e2e 199 passed, 53 skipped, 0 failed. The skips were not reviewed one by one. One clipboard copy test failed once in an interrupted run and passed on rerun, cause unproven.
- Recording: the round 3 fix made no changes, because the agent took the owner's closing message as an order to stop. Open and unverified: 52, 53, 58, B-9, 87, 101, 97, 122, 108, 155, 182, plus a service coverage gap at 163. The ledger still marks 52, 53, and 182 as `done`.
- Round 3 audit findings, raw counts: session views 15, recording 18, summaries 3, chat 4, calendar detection 0. Only recording's were left unprocessed; the others had a fix pass with no audit after it. Rounds for the first four modules also ended on an unaudited fix.
- Not run: packaged launch, installer, real end-to-end with synthetic audio, real meetings, real accounts, a library written by the WinUI app, Windows 10.
- Worktrees remain under `C:\Code\vozella-worktrees`. Their branches are merged.

## Next step

If the work resumes: process the open recording findings, port live copilot and shell-platform, then run T8. The app has no tray, app icon, global shortcuts, or toast handling until shell-platform is ported.
