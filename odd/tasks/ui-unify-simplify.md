# UI unify and simplify

## Objective

Reduce duplicated controls and surface clutter without removing capabilities the user still needs.

## Problem

A read-only UX audit (2026-09-29) found three provider pickers, two draft buttons that overlap chat recipes, a note-template picker on two pages, duplicated Copy / Open location on both session tabs, crowded Library toolbar and row buttons, and two post-stop buttons that do the same navigation.

## Why

Fewer places to make the same choice. The Recording page (959 XAML lines, 2096-line VM) and the Library are the most crowded surfaces.

## Scope (user-approved plan, 2026-09-29)

- T1 Single provider: remove the chat provider flyout and the live-answer provider picker. Chat and live answers use `SelectedSummaryProvider`. Remove `SelectedChatProvider`, `SelectedLiveAnswerProvider`, their resolvers and tests. Old JSON keys must still deserialize (ignored).
- T2 Summary drafts: remove "Write follow-up email" and "Draft project plan" buttons, their draft InfoBar, `FollowUpEmailPromptBuilder`, `ProjectPlanPromptBuilder` and tests. Keep "List actions". Add a built-in "Project plan" chat recipe (single-meeting scope). `MeetingRecord.FollowUp` / `ProjectPlan` stay readable.
- T3 Note template: remove the picker and Save custom template from RecordingPage. First summary uses Auto. Summary page keeps the picker.
- T4 Session header: move Copy and Open location to a single SessionPage header toolbar. Copy copies the active tab's content. Remove the duplicated buttons from TranscriptPage and SummaryPage. My Notes / Enhanced stays.
- T5 Library + post-stop: folder Rename / Delete move to the folder context menu (toolbar keeps New folder). Meeting rows: Move / Summary / Delete move to a row context menu plus one "..." button. Post-stop "View transcript / View summary" becomes one "Open" button (summary if present, else transcript).
- T6 Personal tasks: hide the chat-bar Personal tasks button when there is no TypeSafe key or TypeSafe is disabled.

## Out of scope

- Removing Jev/TypeSafe, the live copilot, pre-meeting brief, folder personality, xAI (audit "remove" group, not approved).
- Collapsing Settings provider expanders (only the selected one is visible already).
- Removing the per-calendar list (it filters reminders and Coming up).
- Discard confirmation (already exists).

## Constraints

- C# 12, classic `[ObservableProperty]` private fields.
- Build/test per csproj, never `MeetingLive.sln`.
- UI strings only in `Strings/en-us` and `Strings/es` resw; delete unused keys in both.
- Skills: winui-design, winui-dev-workflow, csharp-xunit, run-tests, winui-code-review before commits.
- Commits directly on `main`, Conventional Commits, no AI attribution, no push until the user asks.

## TDD

- Mode: on (strict). Source: session configuration "Strict TDD Mode: enabled".
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- RED first for Core behavior (recipe catalog, settings deserialization). App-only XAML changes have no test project; verified by build.

## Delivery

- Strategy: `ask-on-risk`. Forecast about 600 authored lines, mostly deletions.
- RDD: on (default). Assess each work-unit commit.

## Tasks

- [x] T1 Single provider — route: delegated (2+ non-trivial files) — commit 5026939
- [x] T2 Summary drafts to recipe — route: delegated — commit 2cc817f
- [x] T3 Note template only on Summary — route: delegated — commit e24c448
- [x] T4 Session header Copy / Open location — route: delegated — commit 7b4d50b
- [x] T5 Library context menus + single Open — route: delegated — commit 3ef2a22
- [x] T6 Hide Personal tasks without key — route: delegated (bundled with T1 writer) — commit 5026939

## Checks

- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` — 0 errors
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` — all pass

## Progress

- Created 2026-09-29. Baseline: 656 tests (previous session).

## Next step

Done: all tasks committed; awaiting user push decision.

## Evidence

- T1+T6 (5026939): guard test `Deserialize_WhenJsonHasRemovedProviderKeys_LoadsAndIgnoresThem` added before removal (passed while the properties still existed, so no RED is possible for a pure removal; it stays as the regression guard). Obsolete live-answer and chat resolver tests deleted. Build: 0 errors. Tests: 643 passed, 0 failed.
- T2 (2cc817f): RED observed (ChatRecipeCatalogTests failed to compile: ChatRecipeCatalog.ProjectPlanId missing, CS0117), GREEN after adding the recipe and localized name (CoreStrings en/es): 13 recipe tests passed. FollowUp/ProjectPlan prompt builders and their tests deleted. Deviation: the draft InfoBar (SummaryPage_DraftError) is kept because "List actions" still reports copied / no-items / copy-failed through it. Build: 0 errors. Tests: 641 passed, 0 failed.
- T3 (e24c448): App-only removal (no Core behavior change, no test project for XAML), verified by build. Pipeline request now carries no template (Auto). Build: 0 errors. Tests: 641 passed, 0 failed.
- T4 (7b4d50b): App-only change verified by build. Copy uses ISessionCopySource implemented by TranscriptPage (transcript) and SummaryPage (My notes text in notes mode, otherwise the summary); Open location and the copy confirmation now live in SessionPageViewModel. Build: 0 errors. Tests: 641 passed, 0 failed.
- T5 (3ef2a22): App-only change verified by build. Row menu is built in code (MenuFlyout from the More button and ContextRequested, so keyboard Menu / Shift+F10 works); Delete keeps its confirm dialog. Build: 0 errors. Tests: 641 passed, 0 failed.
