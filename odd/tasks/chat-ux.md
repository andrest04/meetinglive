# Chat UX

## Objective
Make the context-aware meeting chat feel responsive and readable: Markdown answers, instant send feedback, clean dates, and a roomier transcript.

## Problem
- Assistant answers render in a plain `TextBlock`, so Markdown (`**bold**`, lists) shows raw.
- On send, the user message only appears after the answer arrives (`PersistTurnAsync`); the draft stays in the box and a stray `ProgressRing` spins to the right of the toolbar.
- `ChatContextPacker` writes `RecordedAt.ToString("O")`, so answers quote ISO timestamps (`2026-10-02T20:34:24.0000000-05:00`).
- The model repeats internal context metadata ("the 12 most recent of 40").
- The transcript is capped at 280 px.

## Scope
- `MeetingLive.Core/Services/ChatContextPacker.cs`, `ChatPromptBuilder.cs` + their tests.
- `MeetingLive.App/ViewModels/MeetingChatViewModel.cs`, `ChatComposerItems.cs`.
- `MeetingLive.App/MainPage.xaml`, `MainPage.xaml.cs`, both `Resources.resw`.

## Constraints
- C#12 classic `[ObservableProperty]` private-field syntax.
- Strings via `x:Uid` / `AppStrings`, English + Spanish.
- No streaming (provider API is request/response); no change to thread persistence format.

## Tasks
- [x] T1 Core context: human-readable local dates (`yyyy-MM-dd HH:mm`) in the packed context; prompt tells the model to answer in Markdown and not mention context limits unless asked. Route: delegated (writer). Checks: RED/GREEN in `ChatContextPackerTests` / `ChatPromptBuilderTests`.
  - Commit `c5e8922`. RED: filtered chat tests `Failed: 2, Passed: 12`. GREEN: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` → `Failed: 0, Passed: 803`.
- [x] T2 Optimistic send: clear the draft and show the user message plus a pending assistant row immediately; replace the pending row with the answer; on failure remove both, restore the draft, show the error. Route: delegated (writer). Checks: app build.
  - Commit `f5bc1f9`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. Rollback only restores the draft when the optimistic rows are still present (a successful turn rebuilds `Messages`) and the composer is still empty.
- [ ] T3 Chat XAML: assistant text via `MarkdownTextBlock`, user messages as right-aligned subtle bubbles, pending row with `ProgressRing` + "Thinking…", remove the stray toolbar spinner, taller transcript, auto-scroll on new rows. Route: delegated (writer). Checks: app build + launch.

## Acceptance criteria
- `**bold**` and lists render formatted in assistant answers.
- Pressing Enter shows the user message instantly and empties the composer.
- Answers never quote ISO timestamps from context.

## Progress
- Document created; branch `feat/chat-ux`.

## Next step
T1.
