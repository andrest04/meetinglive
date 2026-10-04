# Recording start handoff

## Objective

When a normal recording starts, minimize MeetingLive, show the live copilot pill with a short "recording started" message, then leave the normal collapsed pill in the corner. The main window stays minimized.

## Problem

The pill only appears after the user leaves MeetingLive. Starting a recording keeps the main window in front, so the pill never shows until they alt-tab.

## Why

The user wants the handoff to happen by itself: start recording, the app gets out of the way, a brief confirmation appears, and the pill remains in the corner for the rest of the take.

## Scope

In:

- Minimize the main window only when `IsRecording` goes from false to true (a successful start). Not on pause, resume, import, discard, or stop.
- Show the pill immediately on that transition, without waiting for a later deactivation event, and without activating the pill (no focus steal).
- For about 2.5 seconds, the collapsed pill shows a localized "recording started" message and widens only enough to avoid clipping. Then it returns to the normal 240×48 REC pill. Do not open the mini panel.
- The app stays minimized when the hint ends and when recording stops. Existing "hide the pill while the main window is active" behavior stays.

Out:

- Restoring the main window on stop.
- A system toast, `TeachingTip`, or `ContentDialog` for the hint (those can steal focus or fail on a non-activated always-on-top window).
- Repeating the started message every time the user alt-tabs away.
- Screen-share hiding.

## Constraints

- C#12 classic `[ObservableProperty]` private fields. Do not add partial properties.
- Strings in both `Strings/en-us/Resources.resw` and `Strings/es/Resources.resw`, via `x:Uid` / `AppStrings`.
- Test per csproj, never the solution. App build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.
- No `Co-Authored-By` or AI attribution. Conventional Commits.
- The pill must keep being shown with `activateWindow: false`.

## Delivery

Strategy: `ask-on-risk`. Forecast is about 180 authored lines, under the 400 budget. Running count: 0. No chain question yet.

## Acceptance

- Pressing Record minimizes MeetingLive and shows the pill in its saved or default corner without taking focus.
- The pill briefly reads "Recording started" / "Grabación iniciada", then settles to the normal REC pill.
- Pause, resume, import, discard, and stop do not minimize the window or replay the hint.
- Stopping a recording does not restore the main window.
- Focusing the main window still hides the pill. Leaving it again shows the normal pill, without the started message.
- Core handoff tests are green and the App x64 build succeeds.

## Tasks

- [x] T1 Core policy plus tests, then App handoff. Route: delegated. Trigger: two or more non-trivial files (policy, tests, `App.xaml.cs`, pill window, both string files).

## Checks

- T1: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~LiveCopilotRecordingHandoffTests"`
- T1: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Progress

2026-10-04: Feature opened. Branch `feat/recording-start-handoff` from `main` at `074b959`.

2026-10-04: T1 done (delegated writer). Parent spot check: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~LiveCopilotRecordingHandoffTests"` Passed 9, Failed 0. App x64 build reported by the writer: 0 errors. Runtime handoff not observed yet.

- RED: the filter command failed with CS0103 (`LiveCopilotRecordingHandoff` does not exist) before the production type. No WinUI RED: `LiveCopilotWindow` has no xUnit runner.
- GREEN: same filter, Passed 9, Failed 0.
- Running authored lines: about 250, under the 400 budget. Strategy stays `ask-on-risk`. No chain question.

## Next step

Commit T1, then assess native review. Relaunch so the handoff can be tried.
