# Live question copilot

## Objective

While a meeting is recording and live transcription is on, arm a notice when a direct question is committed, and answer it only after the user confirms. The user can also type a question. The recent transcript is already attached. The user chooses which existing summary engine answers.

## Problem

In class the professor asks something ("what is the third principle of the Agile Manifesto?") and looking it up, or opening another chat, is too slow. Post-meeting Ask/Jev only points at lines already said. It does not answer a fact the transcript does not contain.

## Why

User asked for this explicitly. Confirmed trigger: detect, notify, user confirms. Also a typed question with context already loaded. Confirmed engine: the user chooses. Do not hardcode Grok or ChatGPT. Do not auto-answer.

## Scope

In:

- Pure detector over newly committed transcript lines.
- 90-second transcript window and a short answer prompt that may use knowledge when the transcript lacks the fact.
- Recording-page notice, dismiss, confirm, typed question, answer card.
- Persisted `SelectedLiveAnswerProvider`, defaulting to the current summary provider. Choices: Local, ClaudeCode, Codex, Xai.
- Off-thread `CompletePromptAsync`. UI updates only via `DispatcherQueue`.

Out:

- Auto-answering without confirmation.
- Stealth overlay, global hotkey, screen-share hiding.
- A new OpenAI/ChatGPT HTTP provider. Codex CLI is the existing OpenAI-shaped choice.
- Changing summary generation, Jev/Ask, or `MicrophoneLevelMeterService.cs`.
- Sending audio or the whole meeting.

## Constraints

- C#12 classic `[ObservableProperty]` private fields. No C#13 partial properties.
- English UI strings in `Strings/en-us/Resources.resw`. XAML `x:Uid`. C# `AppStrings`.
- Do not block `OnPcmFrame` or `LiveTranscriptionService`'s gate. Do not call a provider from the ASR worker.
- Detect only on committed lines. Interim display text is rewritten and will false-arm.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` — never the solution.
- App build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.
- Work only in this worktree: `C:\Users\andres\Code\meetinglive-worktrees\live-question-copilot`.
- Branch: `feat/live-question-copilot`, based on `feat/jev-meeting-intelligence` at `0208071`. The other worktree has a dirty `MicrophoneLevelMeterService.cs`. Do not touch it.

## Route

Delegated writer. Trigger: two or more non-trivial files. TDD mode: unknown (no `sdd-init` testing cache). Do not invent strict RED/GREEN. Write tests with the behavior and run them. Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Delivery

Strategy: `ask-on-risk`. Chain: `stacked-to-main` (user chose 2026-09-21). Forecast was about 500; actual T1 is 835 additions and T2 is about 620. Both slices stay one behavior each. Neither fits 400 lines without splitting tests away from the code, so each slice needs `size:exception` if opened as a PR. No PR opened: this branch also contains the Jev commits above `origin/main`, so a PR to main would be polluted. Running count: 835 plus T2.

## Acceptance

- A committed direct question arms a notice. Rhetorical checks ("¿se entiende?", "¿ok?", "right?") do not.
- Confirm or Ctrl+Enter on the notice asks the selected provider and shows a short answer. Dismiss clears the notice without a call.
- A typed question uses the same prompt and provider, with the recent transcript attached.
- The provider combo is the user's choice and is persisted. Empty setting follows the summary provider.
- The recording pump keeps running while an answer is in flight.
- Core tests cover detector, window, and prompt. App x64 build succeeds after the UI task.

## Tasks

- [x] T1 Detector, 90-second window, prompt builder, and Core tests. Route: delegated. No UI.
- [x] T2 Recording notice, typed ask, answer card, provider combo, committed-text event, off-thread call. Route: delegated.

## Checks

- T1: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~LiveQuestion|FullyQualifiedName~LiveAnswer"`
- T2: same Core tests, plus `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Progress

2026-09-21: T1 done. Commit `6bd8859`. `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~LiveQuestion|FullyQualifiedName~LiveAnswer"` — passed 24, failed 0, skipped 0. Parent re-ran the same command. `porque` does not arm; `por qué` still does. WinUI review N/A (no XAML or view models in this unit). Runtime harness N/A (pure Core, no UI boundary). Diff is 835 additions because the parser, prompt, and tests ship with the detector; not split by file type.

2026-09-21: T2 commit `059dc5f`. Same filter re-run by parent: passed 32, failed 0, skipped 0. Writer build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` — 0 errors. WinUI review: no error-severity issues. C#12 private fields kept over WUI3xxx. Notice sits above the transcript scroller. Provider call is `Task.Run`. App was not launched. Rollback: revert the T2 commit; T1 detector still stands.

## Next

Manual smoke while recording. Do not open a PR to main until Jev is on main, or the diff stays polluted.
