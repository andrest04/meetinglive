# Live copilot overlay

## Objective

While recording, show a floating, always-on-top pill that expands into a mini panel. In it the user sees detected questions, answers them, and types live questions. Answers also use session context (topic or course), and use provider-side web search when Jev decides a question needs it.

## Problem

The live question copilot (`odd/tasks/live-question-copilot.md`) only lives inside `RecordingPage`, so the user can't see it when another app (Zoom, a class) is in front. Answers only know the 90 s transcript window and the model's own knowledge, with no session context and no web.

## Why

The user asked for a pill and an overlay mini panel, more context than the meeting, and free web search delegated to the provider (Claude Code / Codex CLI), with Jev deciding when the web is needed. The competitor research (Engram `research/live-copilot-competitors`) shaped the UX: a draggable pill, preset chips, a detected-question card, and a web badge. Hiding the pill from screen share is out of scope.

## Scope

In:

- Core: `sessionContext` and a web line in `LiveAnswerPromptBuilder`; a NeedsWeb Noul in `LiveQuestionJevJudge` (same request for armed lines, plus a separate typed-question call); `webSearch` args in `CliInvocation` and in the Claude/Codex providers.
- App: a live-only provider factory with web; streamed live answers; session context from the meeting Brief and title; a 🌐 toggle and web badge state.
- App: `LiveCopilotWindow` (pill and mini panel), a shared recording VM singleton, and pill lifetime tied to recording and main-window focus.

Out:

- Screen-share hiding.
- A system-wide global hotkey.
- A paid search API.
- Web search for xAI or Local.
- Auto-answering.
- Changes to summaries or chat.

## Constraints

- C#12 classic `[ObservableProperty]` private fields.
- Strings go in both `Strings/en-us` and `Strings/es` `Resources.resw`, using `x:Uid` / `AppStrings`.
- Test per csproj only, never the solution.
- App build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.
- Summaries must never get web args.
- No `Co-Authored-By` or AI attribution in commits (user rule). Conventional Commits.
- Execution model (user choice): Opus plans and reviews; one Sonnet subagent implements each task, sequentially.

## Delivery

Strategy: `ask-on-risk`. Forecast is about 1,300 authored lines (T1 ≈ 400, T2 ≈ 350, T3 ≈ 550), which is above the 400 budget, so the chain strategy is to be asked before the first PR. Running count: 0.

## Acceptance

- The pill appears when recording starts and the main window is not focused. It stays on top, is draggable, and shows REC, the timer, and a badge for an armed question.
- Expanded: the detected-question card with Answer/Dismiss, streamed Markdown answer, chips, typed ask with Ctrl+Enter, the 🌐 toggle, and Open app.
- Jev NeedsWeb, or the toggle, enables web search for Claude/Codex live answers only. The answer shows a web badge. xAI and Local show "no web search".
- The prompt includes session context (Brief and title) when present.
- The pill hides when the main window is focused and closes when recording stops or the app closes.
- Core tests are green and the App x64 build succeeds.

## Tasks

- [x] T1 Core: session context and web line in the prompt, NeedsWeb Noul plus `JudgeNeedsWebAsync`, CLI `webSearch` args, provider ctor flag, tests. Real CLI web-flag check for Claude and Codex. Route: delegated (Sonnet writer). Trigger: two or more non-trivial files.
- [ ] T2 App: `CreateLiveAnswerProvider`, resolver live path, `AskLiveAsync` web decision and streaming, session context from Brief and title, `LiveAnswerUsedWeb` / `CanUseWebSearch` / `ForceWebSearch`. Route: delegated (Sonnet writer).
- [ ] T3 App: `LiveCopilotWindow` pill and mini panel, `AppServices.Recording` singleton, lifetime wiring in `App.xaml.cs` / `MainWindow`, pill position settings, strings in en-us and es. Route: delegated (Sonnet writer).

## Checks

- T1: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~LiveAnswer|FullyQualifiedName~LiveQuestion|FullyQualifiedName~CliInvocation|FullyQualifiedName~CliSummaryProvider"`, then the full Core suite.
- T2 and T3: the full Core suite plus `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.
- Manual: `winapp run MeetingLive.App/MeetingLive.App.csproj -c Debug --arch x64 --debug-output`, following the plan's 4-step scenario.

## Progress

2026-10-04: Plan approved. Branch `feat/live-copilot-overlay` created from `main` at `136ed22`.

2026-10-04: T1 done (delegated Sonnet writer). Commit: the `feat(core): add session context and jev-gated web search for live answers` commit on this branch (hash in `git log`).

- RED: new tests first; Core test project failed to compile (34 CS errors) before implementation. GREEN after.
- `dotnet test ... --filter "FullyQualifiedName~LiveAnswer|...LiveQuestion|...CliInvocation|...CliSummaryProvider"`: Passed 88, Failed 0.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`: Passed 844, Failed 0.
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`: 0 errors.
- Real Claude run: `echo ... | claude -p --tools WebSearch --allowedTools WebSearch` exit 0, no permission prompt, answer cited web sources (G2, Krisp, Plaud). `ClaudePrint(webSearch)` appends ` --tools WebSearch --allowedTools WebSearch`.
- Codex form chosen: `--search exec -` (top-level `--search` flag, documented as "Enable live web search ... no per-call approval"; `codex exec --help` has none). End-to-end search NOT observed: in this env `codex exec` fails before the model (Windows sandbox `:root` read error), and with `-s danger-full-access` the model call returned "usage limit reached" (resets 6:00 PM). Argument parsing of `--search exec ... -` and `exec -c web_search="live" -` was accepted by the CLI in both cases. Re-verify once quota is back.
- Judge: web Noul rides in the same request (`web_{i}` beside `line_{i}`); `JudgeAsync` returns `ArmedQuestion(Body, NeedsWeb)`; `JudgeNeedsWebAsync` added. App caller uses `.Body` only (NeedsWeb is T2).

## Next step

T2 via a Sonnet writer.
