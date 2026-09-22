# Granola-style meeting chat

## Objective

A private chat composer docked under the content column. It answers from the meetings in the current scope, keeps threads, and runs saved recipes. Drafts stay in the chat. Nothing is sent.

## Problem

Ask this meeting finds personal tasks in one transcript. It does not answer questions, does not look across a folder or the library, and does not draft follow-ups. Granola Chat does that from a bottom composer whose scope follows where you are.

## Why

The user asked to implement https://www.granola.ai/chat in this app.

## Scope

In:

- Bottom composer on Record, Library, and an open session. Hidden on Settings.
- Scope follows location: live capture, open meeting, selected Library folder, otherwise all meetings.
- Multi-turn threads, private history, delete a thread.
- Built-in recipes plus user recipes, opened with `/`.
- Engine is the selected summary provider `CompletePromptAsync` (Local, Claude Code, Codex, xAI).
- Context pack truncates. One meeting may include transcript. Many meetings use title, summary, action items, and notes.

Out:

- Replacing the Ask tab.
- Gmail, Slack, or Calendar send. No connectors exist, and this app has no remote backend.
- Sharing recipes, workspaces, People/Companies, file upload, meeting multi-select checkboxes.
- Feeding `JevAnalysis` into chat. Chat does not require a TypeSafe key.

## Constraints

- C# 12. Classic `[ObservableProperty]` private fields. No partial properties.
- UI strings in `MeetingLive.App/Strings/en-us/Resources.resw`. No hardcoded UI copy.
- Threads and recipes live under `%LOCALAPPDATA%\MeetingLive`, not Documents. Path override in constructors so tests never touch the real files.
- Do not pack full transcripts for folder or all-meetings scope.
- Local `CompletePromptAsync` is capped at 512 tokens. Prompts must still be useful for CLI and xAI.
- `PaneDisplayMode` stays `Auto`. Do not add a nav item or a session tab.

## Acceptance

- From Library with no folder filter beyond Inbox, chat can answer from all meetings' summaries without requiring a TypeSafe key.
- Opening a meeting scopes chat to that meeting and may use its transcript, truncated.
- A selected Library folder scopes chat to that folder's meetings.
- While recording, chat uses the live window, not a previously opened meeting.
- `/` lists recipes. Running one sends its prompt as the user turn.
- Threads persist across restart. Delete removes the thread.
- The model is told to answer only from the packed context and to say when the answer is not there.
- Ask tab behavior is unchanged.

## Delivery

- Strategy: `ask-on-risk`. User chose `stacked-to-main` on 2026-09-21.
- Reviewed boundary: branch point of `feat/granola-chat`. RDD is off.
- Slices, in merge order. Do not open PRs until asked.
  1. Persist private chat threads.
  2. Persist user recipes.
  3. Pack meeting context. Packer plus tests exceed 400 lines; do not split the tests off. `size:exception` for that slice.
  4. Grounded prompts and built-in recipes.
  5. Resolve scope from the shell.
  6. Composer. ViewModel and XAML are one behavior and exceed 400 lines. `size:exception`. Do not shrink the bar to fit the budget.

## TDD

- Mode: unknown. No session config names strict TDD. Do not invent a RED ceremony.
- Checks: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` and `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.

## Tasks

- [x] T1 Core thread and recipe stores, with path-override tests. Route: delegated (writer trigger, 2+ files).
- [x] T2 Context pack and prompt builder, with truncation tests. Route: delegated (same writer as T1).
- [x] T3 Publish folder and live scope on `WorkspaceService`. Route: delegated.
- [x] T4 Shell composer, thread flyout, provider picker, strings. Route: delegated (writer trigger).
- [x] T5 `/` recipes, including built-ins, and create/delete user recipes. Route: delegated.
- [x] T6 Wire send through `SummaryProviderResolver` and `CompletePromptAsync`. Append prior turns. Route: delegated with T4.

## Progress

2026-09-21: Explored. Ask is a Jev checklist, not this chat. No bottom bar. No shared folder selection. No multi-select.

2026-09-21: T1–T6 implemented on `feat/granola-chat`. Chat filter: 65 passed. Full suite: 546 passed. App x64 build: 0 errors. App was not launched.

Commits, stacked-to-main order:

- `eaaffac` persist private chat threads — 387 lines
- `127bdff` persist user chat recipes — 260 lines
- `c33ed54` pack meeting context — 512 lines, `size:exception`
- `2594c33` ground chat prompts — 405 lines, 5 over budget, left intact
- `bc0e2df` resolve chat scope — 240 lines
- Composer commit follows in the same branch. ViewModel and XAML stay together. `size:exception`.

Checks for the core slices: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` — 546 passed, 0 failed. Runtime harness: N/A, no UI in those slices.

## Next

Composer commit, then stop. Do not push or open PRs unless asked.
