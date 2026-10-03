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
- No change to thread persistence format.
- Streaming (T8) is additive: `ISummaryProvider.StreamPromptAsync` default-interface method yields `CompletePromptAsync` once; local LLamaSharp and xAI override with real streaming; CLI providers keep the one-chunk fallback.

## Tasks
- [x] T1 Core context: human-readable local dates (`yyyy-MM-dd HH:mm`) in the packed context; prompt tells the model to answer in Markdown and not mention context limits unless asked. Route: delegated (writer). Checks: RED/GREEN in `ChatContextPackerTests` / `ChatPromptBuilderTests`.
  - Commit `c5e8922`. RED: filtered chat tests `Failed: 2, Passed: 12`. GREEN: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` → `Failed: 0, Passed: 803`.
- [x] T2 Optimistic send: clear the draft and show the user message plus a pending assistant row immediately; replace the pending row with the answer; on failure remove both, restore the draft, show the error. Route: delegated (writer). Checks: app build.
  - Commit `f5bc1f9`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. Rollback only restores the draft when the optimistic rows are still present (a successful turn rebuilds `Messages`) and the composer is still empty.
- [x] T3 Chat XAML: assistant text via `MarkdownTextBlock`, user messages as right-aligned subtle bubbles, pending row with `ProgressRing` + "Thinking…", remove the stray toolbar spinner, taller transcript, auto-scroll on new rows. Route: delegated (writer). Checks: app build + launch.
  - Commit `ab85004`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`; Core tests `Failed: 0, Passed: 803`. Removed unused `Chat_Sending`, added `Chat_Thinking.Text` (en/es). Parent launch check: sent a real question via `winapp ui`; user bubble + "Pensando…" appeared instantly, answer rendered bold + bullets, readable date, no context-count leak.
- [x] T4 Header actions: move History and New chat out of the composer row into the Expander header (right side); composer keeps Send, Personal tasks (when shown), Recipes. Route: delegated (writer). Checks: app build.
  - Commit `14ce8ce`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. Header buttons are transparent Buttons in their own header Grid columns (inner Buttons handle pointer input, so the header toggle is not triggered). New chat and opening a thread from History also expand the panel.
- [x] T5 Empty-state suggestions: when the open chat has no messages, show up to 4 recipe suggestions for the current scope as clickable chips above the composer; clicking one sends it. Route: delegated (writer). Checks: app build.
  - Commit `88d4c3c`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. `StarterRecipes` (first 4 scope recipes) + `ShowStarterRecipes` (`!HasMessages && !IsSending`), rendered as rounded chip Buttons in an `ItemsControl` with the Toolkit 7.1.2 `WrapPanel` (already referenced through the Markdown package); added `Chat_Starters.AutomationProperties.Name` (en/es).
- [x] T6 Scope chip: show the chat scope (this meeting / this folder / all meetings) as an icon + label in the Expander header instead of plain text. Route: delegated (writer). Checks: app build.
  - Commit `f32b639`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. VM `ScopeGlyph` (Live E720, Meeting E7C3, Folder E8B7, All E8F1) next to the unchanged `ScopeLabel` text inside a rounded subtle Border; `LblMeetingChatScope` AutomationId kept.
- [x] T7 Clickable citations: pack `Id:` per meeting; prompt asks to cite meetings as `[Title, date](meeting://<id>)` using only context IDs; assistant `MarkdownTextBlock.LinkClicked` opens the meeting via `AppServices.Workspace.SelectMeeting` + `OpenSession(TabSummary)`; other http(s) links open in the browser. Route: delegated (writer). Checks: RED/GREEN `ChatContextPackerTests` / `ChatPromptBuilderTests`, app build.
  - Deviation: links use `https://meetinglive.local/meeting/<id N>` (`ChatPromptBuilder.MeetingLink` / `TryParseMeetingLink`) instead of `meeting://`. The Toolkit 7.1.2 Markdown parser drops links whose scheme is not in its `KnownSchemes` allow-list (`IsUrlValid`), so a custom scheme would render as plain text.
  - Core commit `5ef998a`. RED (stubs): filtered chat tests `Failed: 4, Passed: 19`. GREEN: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` → `Failed: 0, Passed: 812`.
  - UI commit `40e1d8e`. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. `LinkClicked` opens existing meetings on the Summary tab, shows `Chat_MeetingLinkMissing` (en/es) for deleted ones, and launches other http(s) links in the browser. A real click in the running app has not been checked yet.
- [ ] T8 Streaming: `StreamPromptAsync` default method; real streaming for `LocalLlmSummaryProvider` (InferAsync tokens) and `XaiSummaryProvider` (`stream: true` SSE); chat appends chunks to the pending row (observable `Text`, batched on the UI thread), then persists the full answer. Route: delegated (writer). Checks: RED/GREEN provider tests, app build.

## Acceptance criteria
- `**bold**` and lists render formatted in assistant answers.
- Pressing Enter shows the user message instantly and empties the composer.
- Answers never quote ISO timestamps from context.

## Progress
- Document created; branch `feat/chat-ux`. T1–T3 done and launch-verified. T4–T8 approved by the user ("vamos con todo").
- T4–T7 done and build-verified (`14ce8ce`, `88d4c3c`, `f32b639`, `5ef998a`, `40e1d8e`); launch check pending.

## Next step
Launch check of T4–T7 (header buttons do not toggle the expander, starter chips, scope chip, citation click), then T8.
