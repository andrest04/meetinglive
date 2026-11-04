# Parity ledger: live-copilot (pill window and answer path)

Spec: `docs/port/specs/live-copilot.md`. Section 8 has 155 items and section 7 has 20 bugs; every one has a row. Package owners: P1 pure core (`packages/core/src/live-copilot/`), P2 lifecycle, window adapter, drag and snap, P3 answer path audit, P4 capsule renderer, P5 chat panel. Each package edits only its own rows.

Status words: `pending`, `done`, `improved`, `dropped`, `pending-real-validation`.

## Where things are (P1)

| Concern | Code |
| --- | --- |
| Edge, along, nearest edge, position, along inverse, expanded bounds, `parseEdge` | `packages/core/src/live-copilot/pill-dock.ts` |
| Constants, px sizes, capsule host margin, panel rect, shape radius, offscreen rect, drag threshold | `pill-layout.ts` |
| Banker rounding helper | `round.ts` |
| Easings, tween progress, `lerpRect`, `planSnap`, `snapFrame`, `shouldRedock` | `pill-motion.ts` |
| Settings codec: `resolveDock`, `shouldSaveDock`, `dockPatch` | `pill-dock-settings.ts` |
| `Rect`, `Point`, `clamp` (shared with the meeting popup) | `meeting-detection/popup-placement.ts` |
| Tests | `live-copilot/*.test.ts`, `popup-placement.test.ts` (placement rows), `packages/platform/src/library/json-settings-store.test.ts` (round trip) |

## Decisions (P1)

- Item 40: banker rounding is replicated (`roundHalfEven`) for every px computation, so a fractional DPI lands on the same pixel as the WinUI app. Geometry works in DIP rects from Electron with `scale` kept as a parameter.
- Item 46 and bug 5: `parseEdge` accepts only `Left`, `Right`, `Top`, `Bottom`, case-insensitive. `0` to `3` and `Left,Top` fall back to Right. Stricter than C#; a hand-edited numeric value now means the default edge.
- Bug 8: no migration from `liveCopilotPillX` and `liveCopilotPillY`. They are tolerated and rewritten unchanged, never read.
- `dockPatch` carries only the two current fields, so saving a dock never touches the legacy keys or unknown keys.
- Surrounding spaces in the edge string are not trimmed (C# `Enum.TryParse` trims; a file written by this app never has them).

## Scope cuts (owner decision 2026-11-03)

Rows marked `dropped` are not missing. The armed question card, badge and Answer button, Jev judgment and its failure modes, and the privacy note belong to the TypeSafe cut. `LiveQuestionDetector` is dead code and is not ported.

## Items

| # | Item | Owner | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Pill is created lazily on first need and reused; hiding does not destroy it. | P2 | pending | |
| 2 | Pill closes when the main window closes. | P2 | pending | |
| 3 | Show rule is `isRecording && (!mainWindowActive \|\| handingOff)`; recording includes the paused state. | P2 | pending | |
| 4 | `mainWindowActive` starts true; any activation state other than Deactivated sets it true. | P2 | pending | |
| 5 | Pill visibility is re-evaluated on every main-window activation change and every `IsRecording` change. | P2 | pending | |
| 6 | Handoff fires only on the false-to-true recording transition, not on pause, resume, import, discard or stop. | P2 | pending | |
| 7 | Handoff dismisses the "meeting detected" popup. | P2 | pending | |
| 8 | Handoff minimizes the main window and then forces `mainWindowActive = false`. | P2 | pending | |
| 9 | Handoff shows the pill immediately without waiting for deactivation, then calls the started hint. | P2 | pending | |
| 10 | The main window is never auto-restored. | P2 | pending | |
| 11 | Stop or discard hides the pill and collapses an open panel. | P2 | pending | |
| 12 | Bringing the main window forward hides the pill without collapsing the panel; the panel state persists across hide and show. | P2 | pending | |
| 13 | `SetVisibleAsync` show and hide races are resolved by the latest requested visibility. | P2 | pending | |
| 14 | Showing while already visible and not exiting is a no-op. | P2 | pending | |
| 15 | Showing during an exit animation cancels the exit and re-enters from the docked rectangle. | P2 | pending | |
| 16 | Always on top. | P2 | pending | |
| 17 | No border and no title bar; native caption and thick-frame styles stripped and the frame refreshed. | P2 | pending | |
| 18 | DWM border suppressed; DWM rounding disabled when the custom shape is applied and enabled as the fallback. | P2 | pending | |
| 19 | Not resizable, not maximizable, not minimizable. | P2 | pending | |
| 20 | Hidden from the taskbar and Alt+Tab. | P2 | pending | |
| 21 | Shown without activation; keyboard focus stays in the previously focused app. | P2 | pending | |
| 22 | Clicking the pill activates it so typing works; no click-through anywhere. | P2 | pending | |
| 23 | Window shape is a capsule (radius half the short side) when collapsed and a 28 DIP rounded rectangle when expanded. | P2 | pending | |
| 24 | Shape uses the window pixel size verified against the client size, with the region right and bottom `+1`. | P2 | pending | |
| 25 | Shape falls back to DWM round corners when the region cannot be applied; stale regions are cleared on failure. | P2 | pending | |
| 26 | Exactly one outline when collapsed (1 stroke inset by 1 physical pixel); expanded adds a capsule surface border of 1. | P4 | pending | |
| 27 | Dark theme always; high-contrast colors honored for the stop button. | P4 | pending | |
| 28 | Window title is `LiveCopilot_Title`. | P2 | pending | |
| 29 | Capsule is 64 DIP on the short side, 240 DIP long when vertical, 272 DIP long when horizontal. | P1 | done | `CAPSULE_*_DIP` and `capsuleSizePx` in `pill-layout.ts`; constants and sizes tested in `pill-layout.test.ts`. |
| 30 | Pixel sizes use `round(dip * scale)` with a fresh DPI each time. | P1 | done | `roundHalfEven(dip * scale)` in `capsuleSizePx`, `marginPx`, `gapPx`, `panelSizePx`; scale is a parameter, never cached. Tests at 1, 1.25, 1.5 and on midpoints. |
| 31 | Edge margin is 16 DIP. | P1 | done | `EDGE_MARGIN_DIP = 16` and `marginPx(scale)`. |
| 32 | Panel is 380x500 DIP with an 8 DIP gap from the capsule. | P1 | done | `PANEL_WIDTH_DIP`, `PANEL_HEIGHT_DIP`, `PANEL_GAP_DIP`, `panelSizePx`, `gapPx`. |
| 33 | Vertical layout on Left and Right edges; horizontal on Top and Bottom. | P1 | done | `isVertical` in `pill-dock.ts`; `capsuleSizePx` picks the orientation from the edge. |
| 34 | Capsule content order: logo tile, audio bars, elapsed time, pause, stop, chat; spacing 8 DIP. | P4 | pending | |
| 35 | Panel padding 12 DIP, row spacing 8 DIP, five rows as specified. | P5 | pending | |
| 36 | Default dock is the right edge at along 0.5. | P1 | done | `DEFAULT_EDGE = Right`, `DEFAULT_ALONG = 0.5`; `resolveDock` of empty settings returns them. |
| 37 | `NearestEdge` uses strict comparisons with tie order Right, Left, Bottom, Top. | P1 | done | `nearestEdge`; tie order tests (Right, Left, Bottom, Top). |
| 38 | `PositionFor` clamps along to 0..1 and maps NaN or infinity to 0.5. | P1 | done | `positionFor` clamps a finite `along` to 0..1 and maps NaN and both infinities to 0.5. |
| 39 | `TravelRange = max(0, areaLen - capsuleLen - 2*margin)`; a capsule longer than the edge is pinned to the start. | P1 | done | `travelRange` is `max(0, area - capsule - 2*margin)`; a capsule that does not fit is pinned to `area + margin`. |
| 40 | `PositionFor` rounds the travel offset with banker's rounding (decide whether to replicate). | P1 | done | Decision: replicate banker rounding. `roundHalfEven` in `round.ts` is used for the travel offset, the lerp and every px size. Geometry works in DIP rects from Electron with `scale` kept as a parameter. Midpoint tests use a power-of-two travel so the .5 cases are exact. |
| 41 | `AlongFor` returns 0.5 when there is no travel and clamps to 0..1 otherwise. | P1 | done | `alongFor`: 0.5 when `range <= 0`, else clamped `offset / range`; round trip tests on four edges. |
| 42 | `ExpandedBounds` vertical: width = min(cap+gap+panel, area), height = min(max(cap, panel), area); horizontal is the analog. | P1 | done | `expandedBounds` vertical and horizontal formulas; four edge tests with 380x500 and gap 8; worked example 1452,270. |
| 43 | `ExpandedBounds` centers on the capsule using truncating integer division (`Math.trunc` in JS). | P1 | done | `Math.trunc` in both centering lines; tests for the -259 / 2 = -129 case, vertical and horizontal. |
| 44 | `ExpandedBounds` result is clamped inside the work area. | P1 | done | `expandedBounds` clamps with `clamp` from `meeting-detection/popup-placement.ts`; near end and oversize panel tests. |
| 45 | `Clamp` pins an oversize window to the area origin. | P1 | done | `clamp` (not duplicated) pins an oversize window to the area origin; the placement rows were added beside `popup-placement.test.ts`. |
| 46 | `ParseEdge` is case-insensitive and falls back to Right for unknown values (decide the numeric-string behavior explicitly). | P1 | improved | Decision: `parseEdge` accepts only the four names, case-insensitive. Numeric strings `0` to `3` and comma flags (`Left,Top`) fall back to Right, stricter than C# (bug 5). Surrounding spaces are not trimmed. Unknown, null and empty give Right. |
| 47 | First placement uses the primary display work area; later placements use the display nearest the window. | P2 | pending | |
| 48 | On first placement the window is moved to the work-area origin before DPI is read. | P2 | pending | |
| 49 | DPI and work area are re-read on every `Dock()` and every snap. | P2 | pending | |
| 50 | Capsule host margin inside the window equals `(capsule - window) / scale`. | P1 | done | `capsuleHostMargin` returns `(capsule - window) / scale` in DIP. |
| 51 | Panel position and size inside the window follow the per-edge formulas (Left and Top offset by capsule thickness plus gap). | P1 | done | `panelRect` per edge, using the unrounded `8 * scale` gap as `SetBounds` does; never negative. |
| 52 | The OS may refuse the requested size; the actual size is read back and used for the shape and the expected rectangle. | P2 | pending | |
| 53 | Re-dock when the system moves or resizes the window by more than 2 px from the expected rectangle, deferred once to the dispatcher and ignored during drag, press, tween or a queued re-dock. | P2 | pending | |
| 54 | Entrance: start from the off-screen rectangle, 300 ms ease-out quint, opacity follows eased progress. | P2 | pending | |
| 55 | Exit: 160 ms ease-in cubic, opacity `1 - eased`, then hide, reset opacities, move back to the docked position. | P2 | pending | |
| 56 | The off-screen rectangle shifts the docked rectangle past its edge by its own thickness plus the margin. | P1 | done | `offscreenRect(edge, docked, margin)` for the four edges. The adjacent monitor case is bug 11 and belongs to P2. |
| 57 | With animations disabled in the OS, show and hide are immediate and no pulse or panel animation plays. | P2 | pending | |
| 58 | Tween timer is 16 ms; rectangle lerp is rounded per component; size changes reapply the shape. | P1 | done | Pure part: `TIMINGS.tickMs = 16`, `lerpRect` rounds each component half to even, `snapFrame`. The timer and the shape reapply on size change belong to P2. |
| 59 | Audio bars start on show and stop on hide. | P4 | pending | |
| 60 | The position is saved (awaited) before the exit animation starts. | P2 | pending | |
| 61 | The hint is requested on the recording start handoff only. | P2 | pending | |
| 62 | If the pill is not yet visible or is entering, the hint waits for the entrance to finish. | P2 | pending | |
| 63 | The pulse scales the capsule content 1 to 1.08 and back in 2 x 180 ms with sine ease-in-out. | P4 | pending | |
| 64 | Tooltip text `LiveCopilot_StartedMessage` opens on the logo tile for 2500 ms, placed away from the docked edge. | P2 | pending | |
| 65 | The hint is cancelled on hide, on drag start and on window close. | P2 | pending | |
| 66 | The hint tooltip is separate from the logo button's own "Open Vozella" tooltip. | P4 | pending | |
| 67 | A left-button press on the capsule (not on the logo tile) captures the pointer. | P2 | pending | |
| 68 | Presses are ignored while a tween runs. | P2 | pending | |
| 69 | Drag starts after the cursor moves 4 DIP (Euclidean, in physical px) from the press point, using global cursor coordinates. | P2 | pending | |
| 70 | Starting a drag closes the hint and instantly collapses an open panel. | P2 | pending | |
| 71 | While dragging, the window follows the cursor delta from the origin captured at drag start. | P2 | pending | |
| 72 | Release or capture loss ends the drag; a press without a drag does nothing. | P2 | pending | |
| 73 | A drop snaps to the nearest edge based on the window center and the nearest display work area. | P1 | done | `planSnap`: center by truncating division of the dropped window, `nearestEdge` on that center and the work area passed in (the caller supplies the nearest display). |
| 74 | The new `along` is computed from the center using the new orientation size. | P1 | done | `planSnap` computes `along` with `alongFor` from the center and the new orientation size. |
| 75 | Snap tween is 240 ms: ease-out cubic without a flip, ease-in-out cubic with a flip. | P2 | pending | |
| 76 | On a flip the orientation switches at eased progress >= 0.5 and host opacity is `\|2*eased - 1\|`. | P2 | pending | |
| 77 | After the snap completes: opacity 1, instant `Dock()`, debounced save (500 ms). | P2 | pending | |
| 78 | The chat button toggles the panel; its name and tooltip switch between the Expand and Collapse strings. | P5 | pending | |
| 79 | Opening grows the window from the capsule toward the screen center, keeping the capsule position. | P5 | pending | |
| 80 | Opening animates panel opacity 0 to 1 and a 16 DIP slide from the docked edge over 220 ms with cubic ease-out. | P5 | pending | |
| 81 | Closing is instant when initiated by a drag or by `collapse`. | P5 | pending | |
| 82 | The panel closes on stop or discard. | P5 | pending | |
| 83 | The header shows `LiveCopilot_Title` and an "Open Vozella" button. | P5 | pending | |
| 84 | The logo button and the header button both restore the main window if minimized and activate it. | P5 | pending | |
| 85 | The detected-question card is visible only while a question is armed. | P5 | dropped | owner decision 2026-11-03, may return later |
| 86 | The card shows the info bar (title plus body), an accent Answer button and a Dismiss button. | P5 | dropped | owner decision 2026-11-03, may return later |
| 87 | The armed badge `?` shows on the logo tile only while armed and is not hit-testable. | P5 | dropped | owner decision 2026-11-03, may return later |
| 88 | The Answer button tooltip is `RecordPage_LiveAnswerTooltip`; Ctrl+Enter is scoped to it. | P5 | dropped | owner decision 2026-11-03, may return later |
| 89 | Text box Ctrl+Enter is scoped to the box; neither accelerator is global. | P5 | pending | |
| 90 | The answer area shows the error bar, progress ring, web badge, markdown text and empty hint with the stated visibility rules. | P5 | pending | |
| 91 | The empty hint shows only when there is no answer, not answering and no error. | P5 | pending | |
| 92 | The progress ring is active only while answering. | P5 | pending | |
| 93 | The web badge shows only if the last answer used the web. | P5 | pending | |
| 94 | Markdown links open only for absolute http or https; other schemes and failures are ignored. | P5 | pending | |
| 95 | Two preset chips with localized labels and prompts. | P5 | pending | |
| 96 | The web toggle is enabled only when the provider supports web; its tooltip changes accordingly. | P5 | pending | |
| 97 | The send button is disabled unless recording with non-blank typed text. | P5 | pending | |
| 98 | The Answer button is disabled unless recording and (typed non-blank or armed). | P5 | dropped | owner decision 2026-11-03, may return later |
| 99 | Dismiss adds the body to the dismissed set and clears the armed question and its web verdict. | P5 | dropped | owner decision 2026-11-03, may return later |
| 100 | Typed text takes priority over the armed question for the question text. | P3 | pending | |
| 101 | Typed-only commands (send, presets) ignore the armed question and do not clear it. | P3 | pending | |
| 102 | The confirm path clears the armed question immediately and restores it only on provider-setup failure. | P5 | dropped | owner decision 2026-11-03, may return later |
| 103 | Starting an ask supersedes any previous ask by generation and cancellation. | P3 | pending | |
| 104 | UI updates from a stale generation are dropped. | P3 | pending | |
| 105 | Stop, discard and a new recording cancel in-flight answers and judgments. | P3 | pending | |
| 106 | A new recording resets armed question, dismissed set, baseline, snapshots, typed text, answer, error and the web-used flag, and refreshes web capability; `ForceWebSearch` persists. | P3 | pending | |
| 107 | Web decision is `supportsWeb && (forced \|\| judged)`; Jev is consulted only when supported and not forced. | P3 | pending | |
| 108 | Armed questions use the stored web verdict; typed questions get a fresh Jev web judgment; any failure, disabled TypeSafe or missing key means no web. | P3 | pending | |
| 109 | The provider setup gate (model download, CLI availability, xAI sign-in) runs through host resolvers; unresolved yields `Status_SetupCancelled` or `LiveCopilot_NeedsSetup`. | P3 | pending | |
| 110 | An empty or whitespace answer shows `RecordPage_LiveAnswerEmpty`. | P3 | pending | |
| 111 | Other failures show a localized CLI failure message or the exception message. | P3 | pending | |
| 112 | Streaming shows nothing until non-whitespace text arrives, publishes the first chunk at once, then at most every 80 ms with leading whitespace trimmed. | P3 | pending | |
| 113 | The final answer is trimmed and flagged with whether the web was used. | P3 | pending | |
| 114 | Cancellations are silent. | P3 | pending | |
| 115 | The prompt text is reproduced verbatim including line breaks. | P3 | pending | |
| 116 | Language is English only for `en` (case-insensitive, trimmed); everything else is Spanish. | P3 | pending | |
| 117 | The session context block appears only when non-blank and is trimmed. | P3 | pending | |
| 118 | The web line appears only when `webSearch` is true; otherwise no "web" word appears. | P3 | pending | |
| 119 | Session context is `Meeting: {title}\n{brief}` with either part optional, null when both are blank, capped at 1500 and right-trimmed. | P3 | pending | |
| 120 | Provider web support is limited to Claude Code and Codex. | P3 | pending | |
| 121 | Default window is 90 s; fallback is 2500 characters when no stamps parse. | P3 | pending | |
| 122 | Stamp grammar is `[mm:ss.ff-mm:ss.ff]` with at least 2-digit minutes, 2-digit seconds <= 59 and 2-digit hundredths. | P3 | pending | |
| 123 | `latest` is the maximum end time; the span is inclusive on both ends. | P3 | pending | |
| 124 | Headers (`Recorded `, `Ended `) are always dropped from the window. | P3 | pending | |
| 125 | Unstamped lines are kept only between the first and last in-span lines. | P3 | pending | |
| 126 | Output newline is `\r\n` if the input had any `\r\n`, else `\n`; line splitting accepts `\r\n`, `\n` and `\r`. | P3 | pending | |
| 127 | Body extraction strips the stamp and a ` [ Speaker-N ]` tag. | P3 | pending | |
| 128 | Judgment runs off the UI thread on every committed-text change, one in flight (a new one cancels the old). | P3 | dropped | owner decision 2026-11-03, may return later |
| 129 | TypeSafe disabled or a missing key advances the baseline without judging. | P3 | dropped | owner decision 2026-11-03, may return later |
| 130 | New lines are determined by whole-line set difference against the baseline, excluding headers and blank bodies. | P3 | dropped | owner decision 2026-11-03, may return later |
| 131 | One request carries two noul questions per new line with ids `line_{i}` and `web_{i}`. | P3 | dropped | owner decision 2026-11-03, may return later |
| 132 | Arm threshold 0.7 inclusive; web threshold 0.6 inclusive; missing or non-noul answers never arm and never request web. | P3 | dropped | owner decision 2026-11-03, may return later |
| 133 | The last armed line wins and carries its own web verdict. | P3 | dropped | owner decision 2026-11-03, may return later |
| 134 | Request body shape, model `jev-latest`, endpoint, headers and retry policy as in section 3.6. | P3 | dropped | owner decision 2026-11-03, may return later |
| 135 | Question, true and false texts are reproduced verbatim. | P3 | dropped | owner decision 2026-11-03, may return later |
| 136 | Failures never surface in the UI and never stop the recording. | P3 | dropped | owner decision 2026-11-03, may return later |
| 137 | Dismissed bodies are never re-armed in the same recording; the baseline advances only on success or skip. | P3 | dropped | owner decision 2026-11-03, may return later |
| 138 | A result is dropped if the generation is stale or recording ended. | P3 | dropped | owner decision 2026-11-03, may return later |
| 139 | A new armed question replaces any existing one. | P3 | dropped | owner decision 2026-11-03, may return later |
| 140 | Five bars, 3 DIP wide, 3 DIP gap, 24 DIP max height, resting dot 3 DIP. | P4 | pending | |
| 141 | Profile, phase step and phase speed arrays as specified. | P4 | pending | |
| 142 | Attack 0.55 and decay 0.14 at 33 ms ticks when running with animations on; direct snap otherwise. | P4 | pending | |
| 143 | Paused forces level fraction 0. | P4 | pending | |
| 144 | The meter maps amplitude with the -60 dBFS floor and 1e-6 minimum amplitude to 0..100. | P4 | pending | |
| 145 | Elapsed text is `mm:ss` with unbounded minutes, updated each second, with a status tooltip (`REC` or `Paused`). | P4 | pending | |
| 146 | Edge and along are stored as `liveCopilotPillEdge` and `liveCopilotPillAlong` in the settings JSON. | P1 | done | `resolveDock` and `dockPatch` in `pill-dock-settings.ts`; the settings store test writes and reads `liveCopilotPillEdge` and `liveCopilotPillAlong`. |
| 147 | Loaded once per process on first show; failure keeps the defaults. | P2 | pending | |
| 148 | Saved 500 ms after each snap and immediately on hide; the write is skipped if unchanged within 0.0005. | P2 | pending | |
| 149 | Save errors are swallowed. | P2 | pending | |
| 150 | Legacy X and Y fields are tolerated on load and unused. | P1 | done | Legacy `liveCopilotPillX` and `liveCopilotPillY` are tolerated, never read (bug 8, no migration) and round trip untouched through `JsonSettingsStore.update(dockPatch(...))`. |
| 151 | All AutomationIds in sections 2.6 and 2.8 are preserved (or mapped to equivalent test ids). | P5 | pending | |
| 152 | Accessible names exist for pause and resume, stop, expand and collapse, open-app, armed badge, web toggle, send, ask box and chips. | P5 | pending | |
| 153 | All strings in section 2.8 exist in en-us and es with identical keys. | P5 | pending | |
| 154 | `LiveCopilotPillPlacement.Clamp` is reused by the meeting-detected popup placement. | P1 | done | `clamp` stays in `popup-placement.ts` and is imported by `pill-dock.ts`; the popup keeps using it; placement tests added. |
| 155 | Optional (not wired in the app): port `LiveQuestionDetector` only if a local fallback is wanted; if ported, carry over its tests. | P3 | dropped | owner decision 2026-11-03, may return later |

## Bugs

| Bug | Summary | Owner | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Stale typed text shadows armed questions | P3 | dropped | owner decision 2026-11-03, may return later |
| 2 | Confirming with typed text present discards the armed question | P3 | dropped | owner decision 2026-11-03, may return later |
| 3 | The armed question is lost on non-setup failures | P3 | dropped | owner decision 2026-11-03, may return later |
| 4 | `LiveQuestionDetector` is dead code in production; its only reference is a comment (`RecordingPageViewModel.cs:391`) | P3 | dropped | owner decision 2026-11-03, may return later |
| 5 | `ParseEdge` accepts numeric strings `"0"` to `"3"` and comma-separated names (`LiveCopilotPillDock.cs:318-321`), so a corrupt value can silently select an edge | P1 | improved | Fixed with item 46: strict names only; regression test `bug 5` in `pill-dock.test.ts`. |
| 6 | The monitor is not persisted | P2 | pending | |
| 7 | The `Light` theme resource dictionary in the XAML is unreachable because the root forces `RequestedTheme="Dark"` (`LiveCopilotWindow.xaml:11`, `:20-23`); only the Dark and HighContrast colors apply | P4 | pending | |
| 8 | Legacy settings fields `LiveCopilotPillX` and `LiveCopilotPillY` are kept but unread (`AppSettings.cs:160-167`); no migration from them to edge and along exists | P1 | done | Kept as designed: no migration. Test `bug 8` in `pill-dock-settings.test.ts` and the store round trip. |
| 9 | The baseline stalls on judgment errors | P3 | dropped | owner decision 2026-11-03, may return later |
| 10 | Only the last qualifying new line is armed per judgment batch (`LiveQuestionJevJudge.cs:83-94`); an earlier question in the same batch is dropped and, because the baseline advances, never revisited | P3 | dropped | owner decision 2026-11-03, may return later |
| 11 | The off-screen slide target can land on an adjacent monitor | P2 | pending | |
| 12 | Settings read-modify-write race | P2 | pending | |
| 13 | `SetVisibleAsync` is fire-and-forget from `UpdateLiveCopilotPill` (`App.xaml.cs:399`), so exceptions in the async path are unobserved | P2 | pending | |
| 14 | If the main window's presenter is not an `OverlappedPresenter`, the handoff does not minimize (`App.xaml.cs:358-360`) but `handingOff` still shows the pill; nothing re-evaluates visibility afterwards, so the pill can stay visible over an active main window until the next activation change | P2 | pending | |
| 15 | `CanUseWebSearch` is refreshed only on recording start and at ask time (`:1236`, `:576`); the toggle can show a stale state if the provider changes mid-recording | P5 | pending | |
| 16 | `TakeRecent` drops any unstamped line that begins with `Recorded ` or `Ended ` (the header test applies to every line), and its 2500-character fallback and the 1500-character session-context cut can split surrogate pairs (`LiveAnswerWindow.cs:148`, `:186-192`; `LiveAnswerWebPolicy.cs:94`) | P3 | pending | |
| 17 | Cross-platform newlines | P3 | pending | |
| 18 | Drag is blocked while a tween runs (`:918`), so a press during the 300 ms entrance or the 240 ms snap does nothing (buttons still work) | P2 | pending | |
| 19 | `ApplyShape` recreates the HRGN on every size change during a snap tween (`:646`), producing many short-lived GDI regions per second; each is replaced, so not a leak, but wasteful | P2 | pending | |
| 20 | Privacy | P3 | dropped | owner decision 2026-11-03, may return later |

## Bugs fixed

- Bug 5 (P1): `parseEdge` no longer accepts numeric strings or comma flags. Regression tests in `pill-dock.test.ts`.
- Bug 8 (P1): decided as no migration; legacy X and Y are never read and survive a save. Tests in `pill-dock-settings.test.ts` and `json-settings-store.test.ts`.

## Left for other modules

- P2: the pill window adapter, lifecycle, drag handling, the 16 ms tween timer, shape application, re-dock on OS changes (use `shouldRedock`), the save debounce and the awaited save on hide (use `shouldSaveDock` and `dockPatch`), first placement on the primary display, bugs 6, 11, 12, 13, 14, 18, 19.
- P3: answer path audit (items 100 to 127), bugs 16 and 17.
- P4: capsule renderer, audio bars, started hint pulse (`PULSE_SCALE`), shape outline, bug 7.
- P5: chat panel (use `panelRect`, `PANEL_SLIDE_DIP`, `TIMINGS.panelMs`), bug 15.
- Anything that needs the real window (DPI, multi monitor, mixed DPI) stays `pending-real-validation` until P2 runs the OS pixel checks.
