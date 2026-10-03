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
- [x] T8 Streaming: `StreamPromptAsync` default method; real streaming for `LocalLlmSummaryProvider` (InferAsync tokens) and `XaiSummaryProvider` (`stream: true` SSE); chat appends chunks to the pending row (observable `Text`, batched on the UI thread), then persists the full answer. Route: delegated (writer). Checks: RED/GREEN provider tests, app build.
  - Core: `ISummaryProvider.StreamPromptAsync` default method; `XaiApiClient.StreamChatAsync` (`stream: true` only on streaming requests, SSE `data:` deltas until `[DONE]`, same HTTP error mapping, `EmptyOutput` when no content); `XaiSummaryProvider` and `LocalLlmSummaryProvider` (shared `InferTokensAsync`) override it. RED (stub): filtered provider tests `Failed: 4, Passed: 22`. GREEN: filtered `Failed: 0, Passed: 26`; `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` → `Failed: 0, Passed: 818`.
  - Core commit `8600605`.
  - UI: `ChatMessageItem` is an `ObservableObject` (observable `Text`/`IsPending`, derived `HasText`, `IsThinking`, `HasAnswer`); `SendAsync` consumes `StreamPromptAsync` in `Task.Run`, pushes the trimmed buffer to the pending row through `App.DispatcherQueue` at most every 80 ms plus a final flush, then trims, checks empty, and persists exactly as before (rollback unchanged). Template bindings are `OneWay`: Markdown shows once text arrives, "Thinking…" only while pending with no text, copy only for completed answers. `MainPage` follows a pending row's `Text` changes by scrolling the transcript `ScrollViewer` to its extent. `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` → `0 Error(s)`. UI commit `0e8a3bc`. A live streaming run in the app has not been checked yet.

## Acceptance criteria
- `**bold**` and lists render formatted in assistant answers.
- Pressing Enter shows the user message instantly and empties the composer.
- Answers never quote ISO timestamps from context.

## Progress
- Document created; branch `feat/chat-ux`. T1–T3 done and launch-verified. T4–T8 approved by the user ("vamos con todo").
- T4–T7 done and build-verified (`14ce8ce`, `88d4c3c`, `f32b639`, `5ef998a`, `40e1d8e`). T8 done (`8600605`, `0e8a3bc`): provider tests RED 4 → GREEN 26; full Core suite 818 passed.
- Parent launch check (via `winapp ui`): starter chips, scope chip, header History/New, citation rendered as a link, and a full send with the current provider (answer + citation + copy) all work after T8. Not verified: clicking a citation (needs window foreground) and token-by-token streaming with local/xAI providers (current provider uses the one-chunk fallback).
- Review consent offered for each candidate; the user declined each time.

## Next step
User checks: click a citation link; try streaming with the local model or xAI. Then push, fast-forward `main`, delete the branch.
