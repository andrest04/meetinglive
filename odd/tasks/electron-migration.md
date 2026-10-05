# Electron migration (Windows first, mirror port)

## Objective
Port MeetingLive (WinUI 3 / C# 12 / .NET 10) to a 100% Electron app (Electron + React + TypeScript, no .NET sidecar). Mirror port, feature by feature, using the untouched WinUI app as the behavioral reference.

## Decisions (confirmed by the user)
- Branch `feat/electron-migration` holds this plan; the new app lives in its own repo `E:\Code\meetinglive-electron` (sibling folder); WinUI projects stay intact until parity.
- Windows first until full parity; macOS and Linux afterwards.
- Everything must follow the official Electron docs (https://www.electronjs.org/docs/latest/): process model, security checklist, IPC, packaging. No decisions from memory; cite the doc URL in the task evidence.
- No Next.js: the renderer is a plain web page without a server. Vite + React + TS.
- Work is spread across several sessions, one task per sitting.

## Constraints and doc-backed rules
- `contextIsolation` on, sandbox on, `nodeIntegration` off, CSP, `setWindowOpenHandler`/`will-navigate` lockdown, validate `senderFrame.origin` in every `ipcMain.handle`, never expose raw `ipcRenderer` (tutorial/security, tutorial/context-isolation).
- Heavy work (audio, native ASR, LLM) runs in a `utilityProcess` connected to the renderer by MessagePort (tutorial/process-model, api/utility-process).
- Native code: N-API (`node-addon-api`) is the documented route; `.node`/DLL/model files unpacked from ASAR (tutorial/native-code-and-electron, tutorial/asar-archives). FFI (koffi) is NOT in the docs: validate with a spike before adopting.
- Secrets via `safeStorage` (async) in main only; settings JSON under `app.getPath('userData')` (api/safe-storage, api/app).
- Transparent windows cannot be resized: the capsule expands through `setBounds` (api/browser-window, tutorial/custom-window-styles).
- Windows system audio: `setDisplayMediaRequestHandler` with `audio: 'loopback'` (api/session). Per-process loopback is not documented: needs a native addon.
- Reference inventory: Core 13,969 LOC, App ~8.6k LOC + 29 ViewModels, ~732 xUnit facts/theories, 27 specs in `odd/tasks/`.

## Tasks
- [x] T0 Scaffold decision: electron-vite 5 + React + TS + electron-builder (research in session; Next.js rejected: no SSR/API routes in Electron, file:// asset-path issues). `setAlwaysOnTop` levels still to verify in T8.
- [x] T1 Scaffold in the SEPARATE repo `E:\Code\meetinglive-electron` (commit 303a978): Electron 44, hexagonal layout (`docs/ARCHITECTURE.md`), lint-enforced dependency rules, `app://` protocol, strict CSP, fuses, typed IPC with sender validation, Vitest (17 tests pass; typecheck, lint, build ok). Pending from T1: i18n catalog (en/es), `build:unpack` smoke test of fuses/asar protocol, deny-all permission handler before mic work.
- [ ] T2 Pure leaf logic + tests: AppSettings model, `LiveCopilotPillDock`/`Placement`, calendar helpers, chat prompt/context packers, folder helpers, WAV/level/normalizer utils, meeting-call detector/popup policy, prompt builders, catalogs.
- [ ] T3 Persistence: AppPaths, settings service, JSON repos, Markdown meeting repository + formatter (format-compatible with existing files), library layout/migrations, safeStorage credential stores.
- [ ] T4 Network clients: resumable downloader (SHA-256), TypeSafe, xAI + OAuth device flow, CLI runner/providers (claude, codex), Jev + live-question judge.
- [ ] T5 Summary/chat orchestration: ISummaryProvider, node-llama-cpp provider/polisher, recording pipeline orchestrator, retranscription, chat services.
- [ ] T6 SPIKE + engine: NeMo-Speech C ABI from a utilityProcess (N-API vs koffi), struct layout tests (sizes 16/24/24/40/16/80/72), runtime/model managers, offline + live transcription, accumulator.
- [ ] T7 SPIKE + audio capture (Windows): mic via getUserMedia, system loopback via display-media loopback, per-process loopback addon, 16 kHz mono mixer + WAV writer, active-audio-app list.
- [ ] T8 UI: shell/navigation, History/Library, Transcript/Summary/Session, Settings, Recording page, dialogs, capsule BrowserWindow with dock math, meeting-prompt popup, calendar source decision.
- [ ] T9 Packaging (Windows): Forge makers, fuses, signing plan, CI workflow. Then macOS/Linux phase.

## Acceptance
Each task closes only with observed passing tests (ported Vitest equivalents of the xUnit suites where they exist), a behavior comparison against the WinUI reference, and a work-unit commit. Delivery budget ~400 authored lines per slice; PR strategy decided per slice.

## Progress
- Exploration and Electron docs research done (research was partial; gaps listed in T0).
- Next step: T0, then T1.

## Route declaration
Planning only so far; exploration and research were delegated to read-only workers (mapping and broad-research triggers).
