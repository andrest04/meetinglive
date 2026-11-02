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
- [x] Remove residual native frame, align client/outer sizing and region geometry, and establish one collapsed-pill outline (user-reported visual acceptance received).
- [x] Verify build and obtain user-reported visual acceptance; automated geometry and additional scenarios remain unverified as recorded below.
- [x] Complete independent source verification; committed as `7bd7e82`.

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
- Commit: `7bd7e82`, following user-reported visual acceptance. Actual authored source changed lines: 109.

## Task T2: Logo navigation (user-approved follow-up)
- [x] Implement a native logo button routed to the existing main-app restore/activate handler (source verified; runtime pending).
- [x] Exclude logo presses from drag capture; retain other drag handling, badge placement/startup messaging, native button states, and localized Open MeetingLive copy (source verified; runtime pending).
- [ ] Build, verify pointer-routing separation, and review; parent owns independent verification selection and the eventual commit.
- Route: delegated direct; XAML button and code-behind drag/tooltip interaction require two non-trivial source surfaces.
- Allowed source surfaces remain the two files listed above. No new resources are expected: reuse `LiveCopilot_OpenApp` accessible name and tooltip.
- TDD: no meaningful deterministic Core test for this native UI wiring; static event-routing checks plus build and UIA when safely available. Do not initiate recordings without consent.
- Additional forecast: 40-100 authored source lines; combined feature expected below 400. Delivery remains ask-on-risk.

### T2 implementation and verification evidence
- Tracking reconciliation completed before source edits: T1 acceptance and commit `7bd7e82` plus approved T2 were mirrored in full to observation 1026 and read back. The newer file was authoritative, not a conflict.
- Static RED: pre-edit source and `git show 7bd7e82:MeetingLive.App/LiveCopilotWindow.xaml` show decorative `IconTile` with no Button/click route. No deterministic Core unit test applies to this native interaction.
- Source: replace only the logo's inner Border with a native 32-DIP Button (22-DIP image unchanged), retaining badge dimensions/margins and all other control positions. Reuse `LiveCopilot_OpenApp` on the second control; unique AutomationId is `BtnLiveCopilotLogoOpenApp`. Badge is non-hit-testable so it does not intercept the logo button.
- Pointer routing: walk OriginalSource ancestors up to CapsuleHost; an IconTile ancestor returns before capsule pointer capture. Existing non-logo capture, 4-DIP threshold, move/release, and docking code are unchanged.
- Tooltips: startup status remains attached to IconTile and its existing lifecycle is unchanged; localized action tooltip belongs to BtnLogoOpenApp and is never cleared by startup cleanup.
- Guidance: `winapp find-ui "Button icon tooltip"` and `winapp find-ui --id gallery-tooltip-1` succeeded; native Button with ToolTipService is the grounded pattern. Context7 WinUI routed-event guidance was consulted.
- Required foreground build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64 --no-restore` succeeded, 0 errors, 194 warnings, elapsed 65.54 seconds. Existing MVVMTK0045 field warnings are not migrated; repository C# 12 override is preserved.
- Static assertion command (PowerShell XML/source checks) passed: baseline has no logo button; new button is 32-DIP with expected UID/ID/Click; ancestor exclusion precedes capture; action tooltip is not overwritten; shared restore and activate calls remain. This is source evidence, not a native event execution test.
- `git diff --check` succeeded (exit 0), with three Git LF-to-CRLF advisory warnings, no whitespace errors.
- Post-build winui-code-review: no concrete new source defect found in changed lines; native semantic Button/template states, accessibility ID/name, localization reuse, theme resources, UI-only code-behind wiring, and drag separation checked. No bundled WUI analyzer injected by the required plain build; no independent review claimed.
- Read-only `winapp ui list-windows -a 30120 --json` succeeded: only main MeetingLive HWND 1377102, no pill window. `winapp ui inspect -a 30120 --interactive --json` succeeded: main page idle with BtnToggleRecording named Grabar. Existing app binary was not reloaded; no recording, stop/discard, restart, duplicate launch, or model download performed.
- Pending runtime acceptance: expose pill on the new binary with user-authorized reload/session setup; test logo single click (including minimized main app), stable action tooltip after startup hint, keyboard Enter/Space and focus, non-logo drag, badge overlay, both orientations/expanded layout, and High Contrast. No runtime/visual PASS claimed.
- Source diff: XAML 14 insertions/3 deletions; code-behind 11 insertions (28 authored changed source lines). Smaller than forecast because existing handler/resources were reusable; no checks were omitted for line budget.
- Rollback boundary: revert only T2 logo-button and pointer-guard changes in the two source files plus this T2 tracking section; preserve T1 outline commit `7bd7e82`.
- skill_resolution: loaded exact project winui-design, winui-dev-workflow, winui-ui-testing, and winui-code-review SKILL.md files; also loaded work-unit-commits. Parent owns independent risk/review selection and commit; no commit or push performed.

## Next step
Parent reviews the T2 diff, selects independent verification, and records the eventual T2 commit. Runtime acceptance needs user-authorized reload/exposure of the pill on the new binary. Do not initiate recording, discard a session, or stop/relaunch the user-owned app without explicit authorization. T1 is committed; T2 is source-implemented and build/static-verified, not committed or runtime-accepted.
