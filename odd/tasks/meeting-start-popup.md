# meeting-start-popup

## Objective
Replace the Windows toast shown when a meeting is detected with a Notion-style floating dark popup ("Start recording" split button) that starts recording in one click.

## Scope
Plan: `C:\Users\andres\.claude\plans\quizzical-tickling-valiant.md`. Window-based detection only (reuse `MeetingCallWatcher`); no tray / mic-session detection.

## Tasks
- [x] T1 Core: `MeetingPopupPolicy` + `MeetingPromptPlacement` + tests (route: delegated writer)
- [x] T2 Settings: `AppSettings.MeetingPopupEnabled` (default true) + test + Settings toggle + i18n keys en/es
- [x] T3 App: `MeetingPromptWindow` (dark, rounded, split button, flyout) + watcher event + `App.xaml.cs` wiring; remove toast
- [ ] T4 Verify: Core tests, app build x64, manual `winapp run` check

## Acceptance
Popup appears top-right without stealing focus on meeting detection; Start recording starts capture; Dismiss / Don't notify again work; setting off suppresses; none while recording.

## Delivery
Strategy: ask-on-risk. Branch: `feat/meeting-start-popup`. Forecast ~450 changed lines.

## Progress
Route: delegated direct (writer) — trigger: 2+ non-trivial files, UI + Core.
Commits: T1 3249053, T2 547d083, T3 909d2e8
Verified: Core tests 896 passed (RED observed first); App x64 build 0 errors. T4 manual winapp run check NOT done (no visual verification possible).
Note: popup subtitle is generic (no app name) because MeetingWindowScanner/MeetingCallDetector were outside the edit surface.
