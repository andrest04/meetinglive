# docked-live-pill

## Objective
Redesign the live copilot pill as a Notion-style rounded capsule: app icon, live audio bars, pause and stop buttons; docked to a screen edge only (default mid-right), snapping to the nearest edge after a drag, vertical on left/right and horizontal on top/bottom, with premium animations. The chat mini panel stays.

## Scope
Plan: `C:\Users\andres\.claude\plans\quizzical-tickling-valiant.md`. No changes to recording, pause or stop logic (reuse `TogglePauseCommand`, `ToggleRecordingCommand`, `MicLevel`).

## Tasks
- [x] T1 Core: `LiveCopilotPillDock` (edge, orientation, nearest edge, position, along) + tests
- [x] T2 Settings: `LiveCopilotPillEdge` / `LiveCopilotPillAlong` + tests
- [x] T3 UI: capsule layouts (vertical/horizontal), `AudioBarsControl`, pause/stop buttons, strings en/es
- [x] T4 Window: capsule shape, custom drag, snap tween, orientation flip, chat panel anchored to the edge, entrance/exit
- [ ] T5 Verify: Core tests, x64 build, manual `winapp run` check (writers cannot see the UI)

## Acceptance
Capsule appears mid-right vertical; bars follow the mic and freeze on pause; pause/resume and stop work; dropping anywhere snaps to the nearest edge and flips orientation; chat opens toward screen center and stays on-screen; position persists across restarts.

## Delivery
Strategy: ask-on-risk. Branch: `feat/docked-live-pill`. Forecast ~700 changed lines. Merge to main only when the user asks.

## Progress
Route: delegated direct (one writer) — trigger: 2+ non-trivial files, UI + Core.
Commits (work-unit commits): T1 dbc2243 (dock math), T2 0bb8c00 (settings), T1b b27169a (expanded bounds), T3+T4 81efbaf UI and window (single commit: the XAML handlers live in the window code-behind, so the two are not independently buildable).
Checks observed: `dotnet test MeetingLive.Core.Tests` 956 passed / 0 failed; `dotnet build MeetingLive.App -p:Platform=x64` 0 errors. T1 and T2 observed RED (compile errors) before GREEN; the expanded-bounds helper was written together with its tests (no separate RED).
Not verified (writers cannot see the UI): capsule silhouette (SetWindowRgn), drag/snap, flip crossfade, chat anchoring, DPI/multi-monitor. T5 manual `winapp run` check is pending for the user.
