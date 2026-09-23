# UX/UI & Responsive Layout Fixes

## Objective

Fix the actionable findings from the ultracode UX/UI + responsive audit (2026-09-22) of MeetingLive's WinUI3 XAML surfaces.

## Problem / why

No minimum window size is enforced and no VisualStateManager/AdaptiveTrigger exists anywhere in the app, so several pages (RecordingPage, HistoryPage, MainPage) use hard-coded pixel widths that clip or squeeze content when the window is resized narrow. Secondary text uses raw `Opacity` in some pages instead of the theme-aware brush, which breaks High Contrast. Two of six setup dialogs lack a ScrollViewer for long text. Primary live-call actions (record/pause/discard/send chat) have no keyboard accelerators.

## Scope (in)

- T1 — MainWindow.xaml.cs: enforce a minimum window size.
- T2 — RecordingPage.xaml(+.cs): MinWidth instead of fixed Width on controls, wrap the Auto-height header stack in a ScrollViewer so the live transcript keeps a guaranteed floor, verify ShowComingUp/ShowMeetingBrief actually collapse layout on record start, make the transcript/notes split respect available height (not just a boolean), add KeyboardAccelerators for Record/Pause/Discard.
- T3 — HistoryPage.xaml(+.cs): collapse the folder tree into a flyout below a width threshold (AdaptiveTrigger/VisualState) instead of a hard-fixed 260px column; loosen the 280px search column to MinWidth; replace Opacity dimming with ThemeResource TextFillColorSecondaryBrush.
- T4 — MainPage.xaml(+.cs): give the chat composer TextBox a MinWidth, collapse the 180px provider ComboBox into a flyout-triggered button (mirroring the existing Recipes/History buttons) below a width threshold, add a KeyboardAccelerator for Send.
- T5 — AskPage.xaml, SummaryPage.xaml, TranscriptPage.xaml: replace Opacity-based dimming with ThemeResource TextFillColorSecondaryBrush.
- T6 — Dialogs/CliToolSetupDialog.xaml, Dialogs/TranscriptionEngineSetupDialog.xaml: wrap content in `ScrollViewer MaxHeight="480"` matching the other four dialogs.

## Scope (out) — explicitly not fixing, disclosed to user

- DPI-change re-assertion of window size after a monitor change (MainWindow.xaml.cs) — audit rated this low priority, no actual bug, only relevant if a future need arises.
- Converting the Loading/Empty/Content Visibility-binding pattern to a formal VisualStateManager (TranscriptPage/SessionPage/AskPage/SummaryPage) — audit noted this is fragile-but-not-broken; the booleans are currently mutually exclusive. Rewriting it is a robustness refactor beyond what the audit's bug list requires.

## Approach for RecordingPage/HistoryPage (design note)

RecordingPage's fixed-width controls just need a floor (MinWidth), not a different shape at a breakpoint — so it gets graceful MinWidth + ScrollViewer degradation rather than a discrete AdaptiveTrigger. HistoryPage's folder tree genuinely becomes unusable at narrow widths (a 260px tree with a squeezed content column serves no one), so it gets an actual AdaptiveTrigger-driven collapse.

## Verification / TDD

Strict TDD is enabled project-wide, but every change here is declarative XAML layout (MinWidth/ScrollViewer/AdaptiveTrigger/Opacity→ThemeResource/KeyboardAccelerator) with no existing unit-test seam for WinUI visual layout or window presenter behavior — there is no RED/GREEN cycle applicable to a XAML attribute change. Verification is: solution builds clean, and each edit is checked against the specific audit finding it targets. If any task introduces new testable C# logic (e.g. a height-calculation helper), it will get unit coverage against the appropriate existing test project.

## Tasks

- [x] T1 — MainWindow.xaml.cs minimum window size — 679c603
- [x] T2 — RecordingPage responsive/layout fixes + record-action accelerators — 84b1503
- [x] T3 — HistoryPage adaptive sidebar collapse + secondary-text brush fix — 8c4b31e
- [x] T4 — MainPage composer bar responsive fix + send accelerator — 2754a96
- [x] T5 — Secondary-text brush fix (AskPage, SummaryPage, TranscriptPage) — ec46b76
- [x] T6 — ScrollViewer on CliToolSetupDialog + TranscriptionEngineSetupDialog — 5990af8

## Verification performed

- `dotnet build MeetingLive.App/MeetingLive.App.csproj -c Debug -p:Platform=x64` — 0 errors (174 pre-existing MVVMTK0045 warnings, unrelated).
- One real bug caught before commit: `TogglePause_AcceleratorInvoked` called `.ExecuteAsync` on `TogglePauseCommand`, which is a sync `[RelayCommand]` (`IRelayCommand`, not `IAsyncRelayCommand`) — fixed to `.Execute(null)`.
- All 6 writer diffs reviewed manually against the audit findings they target before committing.
- Not run: the app itself (WinUI, needs a live Windows session) — visual/interactive confirmation of the resize behavior is still pending manual check by the user.

## Delivery

Direct work-unit commits to `main` (established repo convention — no branch, no PR), one commit per task, conventional commit messages, no AI attribution. Push after each commit.
