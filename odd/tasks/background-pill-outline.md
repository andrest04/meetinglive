# Background pill outline

## Objective
Remove the fragmented bright frame around the background recording pill without changing its controls or behavior.

## Problem and rationale
Runtime inspection found a residual native dialog frame, a 3-pixel client inset at 125% DPI, and two XAML outlines with different bounds. Fix geometry and frame ownership rather than masking the color.

## Scope and constraints
- Authorized source surfaces: `MeetingLive.App/LiveCopilotWindow.xaml` and `MeetingLive.App/LiveCopilotWindow.xaml.cs`.
- Preserve dock orientations, expanded panel, dragging, keyboard access, theme support, and C# 12.
- No dependency changes, unrelated cleanup, remote operations, or publishing.
- Receipt-driven development: off, decided by global preference; no native review lifecycle.
- Route: delegated direct; two non-trivial source files and native/runtime investigation require one writer.
- Delivery strategy: ask-on-risk. Forecast: 100-200 authored changed lines; one work-unit commit.
- Engram mirror: topic `odd/background-pill-outline/tasks` (observation 1026).

## Task T1
- [x] Remove residual native frame, align client/outer sizing and region geometry, and establish one collapsed-pill outline (source implementation; runtime acceptance pending).
- [x] Verify build and obtain user-reported visual acceptance; automated geometry and additional scenarios remain unverified as recorded below.
- [x] Complete independent source verification; work-unit commit is being recorded before the next source task.

## Acceptance and checks
- No retained native frame/client inset in the running pill.
- No clipped or doubled capsule outline; existing controls remain usable.
- Build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64 --no-restore`.
- Runtime: `winapp run MeetingLive.App/MeetingLive.App.csproj -c Debug --arch x64 --debug-output`; confirm responsive window and matching window/client geometry.
- UI-only/native-shell change has no deterministic Core unit-test RED; capture the existing native frame/inset defect as runtime RED, then compare the same measurements after implementation. Use UI checks instead of claiming Core tests prove window rendering.
- Run check-only whitespace validation: `git diff --check`.
- Native risk assessment after writer returns determines independent verification; an unavailable assessment is high risk for verification.

## Progress
- Exploration complete: `LiveCopilotWindow.xaml.cs:372-445` uses outer window dimensions for shaping; worker measured 340x80 outer versus 334x74 client at 125% DPI with WS_DLGFRAME retained.
- Implementation: 103 insertions and 6 deletions across the two authorized source files; removes duplicated collapsed outline, strips native frame with frame refresh, suppresses DWM border, aligns outline inset, and clears stale regions on failure.
- Writer build: 0 errors, 194 warnings. Writer and parent `git diff --check`: passed; independent verifier repeated it successfully.
- Native assessment unavailable because the untracked task document requires an explicit declaration; treated as high risk for verification. RDD remains off; no review lifecycle invoked.
- Independent verifier found no concrete source defect; P/Invoke, native styles, region ownership/fallback, and DPI arithmetic checked statically.
- Updated app launched as PID 30120. Baseline PID 34860 is absent. The app is idle and no pill HWND exists yet, so geometry and visual GREEN cannot be observed without starting a recording.
- Pending runtime checks: capsule outer/client geometry, horizontal/vertical/expanded visuals, drag, keyboard, High Contrast, mixed DPI, and fallback execution. No visual PASS claimed.
- User confirmed the running fix works and the appearance is satisfactory. This is manual visual acceptance, not automated geometry proof.
- Commit: initial outline work-unit commit follows this update; identity will be recorded in the next task update. Actual authored source changed lines: 109.

## Task T2: Logo navigation (user-approved follow-up)
- [ ] Make a single click on the pill logo restore the main app via the existing handler.
- [ ] Keep other capsule areas draggable, preserve badge/startup messaging, and provide native keyboard/accessibility feedback with the existing localized Open MeetingLive copy.
- [ ] Build, verify pointer-routing separation, review independently as selected by native risk assessment, and commit the coherent work unit.
- Route: delegated direct; XAML button and code-behind drag/tooltip interaction require two non-trivial source surfaces.
- Allowed source surfaces remain the two files listed above. No new resources are expected: reuse `LiveCopilot_OpenApp` accessible name and tooltip.
- TDD: no meaningful deterministic Core test for this native UI wiring; static event-routing checks plus build and UIA when safely available. Do not initiate recordings without consent.
- Additional forecast: 40-100 authored source lines; combined feature expected below 400. Delivery remains ask-on-risk.

## Next step
Commit T1 using the user's manual acceptance, then implement and verify the approved logo navigation as T2. Do not initiate recording, discard a session, or stop the app without explicit authorization.
