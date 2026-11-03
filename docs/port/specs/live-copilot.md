# Spec: live-copilot

Source of truth: the C# in `MeetingLive.App/LiveCopilotWindow.xaml(.cs)` and `MeetingLive.Core/Services/{LiveAnswerPromptBuilder, LiveAnswerWebPolicy, LiveAnswerWindow, LiveCopilotPillDock, LiveCopilotPillPlacement, LiveCopilotRecordingHandoff, LiveQuestionDetector, LiveQuestionJevJudge}.cs`, plus the callers that make the module work: `App.xaml.cs` (pill lifecycle), `ViewModels/RecordingPageViewModel.cs` (question arming and answering), `Controls/AudioBarsControl`, `CommittedTranscriptLine.cs`, `TypeSafeApiClient.cs`. Intent documents: `odd/tasks/docked-live-pill.md`, `odd/tasks/background-pill-outline.md`.

Conventions: "DIP" is a device-independent pixel (1 DIP = `scale` physical pixels, `scale = windowDpi / 96`). "px" is a physical pixel. All window rectangles are in physical screen pixels. Line references are `file:line` in the repo at branch `feat/electron-port`.

## 1. Purpose

While a recording runs and the main app window is not in front, Vozella shows a small always-on-top capsule docked to a screen edge. The capsule shows recording state (app icon, live microphone bars, elapsed time) and offers pause, stop, "open Vozella" and a chat button. The chat button opens a mini panel that grows from the capsule toward the screen center. The panel is the "live copilot": it surfaces questions detected in the live transcript, answers them (or typed questions) with the user's configured summary provider using the last 90 seconds of transcript as context, and optionally uses web search when the provider supports it.

The module has four parts:

1. The floating window (capsule + panel): placement, docking, drag, animation, visibility rules.
2. Question detection: an external classifier (TypeSafe "Jev") decides which newly committed transcript line is a direct question and whether it needs the web.
3. Answer generation: prompt construction, transcript windowing, web policy.
4. A tested but unused local heuristic detector (`LiveQuestionDetector`), kept for reference.

## 2. User-facing features

### 2.1 Pill visibility and lifecycle

Owner: `App.xaml.cs:329-400`, rule in `LiveCopilotRecordingHandoff.ShouldShowPill`.

- The pill window object is created lazily the first time it is needed (`show == true`) and kept alive afterwards. Hiding it does not destroy it. It is closed when the main window closes (`App.xaml.cs:122-125`).
- Visibility rule: `show = isRecording && (!mainWindowActive || handingOff)`.
  - `isRecording` is `RecordingPageViewModel.IsRecording`. It stays true while paused.
  - `mainWindowActive` is `true` until the main window reports `WindowActivationState.Deactivated`; any other activation state sets it true. Initial value `true`.
  - `handingOff` is true only for the duration of one `ApplyRecordingHandoff` call (the false-to-true recording transition).
- `UpdateLiveCopilotPill` runs on every main-window activation change and on every `IsRecording` change. It calls `SetVisibleAsync(show, collapse: !recording)` fire-and-forget. If `show` is false and the pill was never created, nothing happens.
- Recording start handoff (`Decide(wasRecording, isRecording)`): when `!wasRecording && isRecording`, both `MinimizeMainWindow` and `ShowStartedHint` are true; in every other combination both are false. On that transition the app: dismisses the "meeting detected" popup, minimizes the main window (only if its presenter is an `OverlappedPresenter`), sets `mainWindowActive = false` after the minimize (so a re-entrant activation event cannot leave it true), sets `handingOff = true`, updates the pill, calls `ShowStartedHint()`, then clears `handingOff`. The main window is never restored automatically.
- Pause, resume, import, discard and stop do not trigger the handoff.
- Stop or discard (`IsRecording` becomes false): the pill hides and `collapse = true` folds the chat panel back to the capsule first.
- User brings the main window to the front during a recording: the pill hides (exit animation) with `collapse = false`, so an open panel stays open and is shown again the next time the pill appears. Minimizing or switching away shows the pill again with the entrance animation and no started hint.
- Clicking the pill does not change `mainWindowActive` (the pill is a separate window). Activating the pill keeps it visible.

### 2.2 Window chrome and behavior

Constructor `LiveCopilotWindow.xaml.cs:156-209`.

- Presenter: `OverlappedPresenter` (set if not already). `IsAlwaysOnTop = true`, `IsResizable = false`, `IsMaximizable = false`, `IsMinimizable = false`, `SetBorderAndTitleBar(hasBorder:false, hasTitleBar:false)`.
- Native frame: after the presenter setup, `WS_CAPTION` (0x00C00000 = WS_BORDER | WS_DLGFRAME) and `WS_THICKFRAME` (0x00040000) are removed from `GWL_STYLE`, followed by `SetWindowPos(SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)`; then the DWM border color is set to `DWMWA_COLOR_NONE` (-2, attribute 34). Reason: a fixed-size overlapped window otherwise keeps a 3 px client inset at 125% DPI and a stray bright frame (`background-pill-outline.md`). If any call fails the failure is logged to debug output only.
- Hidden from taskbar and Alt+Tab (`AppWindow.IsShownInSwitchers = false`).
- Never activated on show: `AppWindow.Show(activateWindow:false)`. Keyboard focus stays in the app the user is working in. There is no `WS_EX_NOACTIVATE`, so clicking the pill (for example to type in the ask box) does activate it.
- Click-through: none. There is no `WS_EX_TRANSPARENT` and no pass-through region. The whole window region receives input. Only two XAML elements are non-hit-testable: `WindowOutline` and the armed-question badge.
- Always on top: yes, via presenter. Not user-configurable.
- Fixed size, not user-resizable. The window size changes only programmatically (orientation flip, panel open/close).
- Window shape: a GDI region cut with `CreateRoundRectRgn(0,0,w+1,h+1, 2r, 2r)` and `SetWindowRgn` (right/bottom are exclusive, hence `+1`). `r` in DIPs is `min(w,h)/scale/2` when collapsed (a full capsule, fully round ends) and `28` when expanded; `rPx = round(rDip * scale)`. The region is recreated only when `(w, h, rPx)` changes. Region failure (`CreateRoundRectRgn == 0` or `SetWindowRgn == 0`) falls back to no region plus `DWMWCP_ROUND` (value 2) corner preference; success uses `DWMWCP_DONOTROUND` (value 1, attribute 33).
- Before shaping, `GetClientRect` must equal the window size. If not, native frame removal is retried once; if still different the fallback shape is used and the region is cleared.
- Outline: an inner XAML border `WindowOutline` (1 px stroke, `SurfaceStrokeColorDefaultBrush`) with margin `1/scale` DIP and corner radius `max(0, rDip - 1/scale)`, drawn inside the hard region edge because HRGN is not anti-aliased. `CapsuleSurface` (the capsule background, radius 32) has `BorderThickness = 1` only when expanded and 0 when collapsed, so there is exactly one outline when collapsed.
- Theme: the root grid forces `RequestedTheme="Dark"`; background is `SolidBackgroundFillColorBaseBrush`. Capsule surface is `SolidBackgroundFillColorSecondaryBrush`.
- Window title (used by assistive tech and task switchers): string `LiveCopilot_Title`.

### 2.3 Sizes, margins, constants

| Constant | Value |
|---|---|
| Capsule short side | 64 DIP |
| Capsule long side, vertical (left/right edge) | 240 DIP |
| Capsule long side, horizontal (top/bottom edge) | 272 DIP |
| Edge margin | 16 DIP |
| Panel width | 380 DIP |
| Panel height | 500 DIP |
| Gap between capsule and panel | 8 DIP |
| Expanded corner radius | 28 DIP |
| Drag threshold | 4 DIP (compared in physical px as `4 * scale`, Euclidean distance) |
| Panel slide-in offset | 16 DIP |
| Pulse scale | 1.08 |
| Snap tween | 240 ms |
| Entrance tween | 300 ms |
| Exit tween | 160 ms |
| Panel fade/slide | 220 ms |
| Pulse (one direction, auto-reverse) | 180 ms |
| Started hint duration | 2500 ms |
| Position save debounce | 500 ms |
| Tween timer tick | 16 ms |

Pixel sizes: `shortPx = round(64 * scale)`, `longPx = round(longDip * scale)`; vertical = `(shortPx, longPx)`, horizontal = `(longPx, shortPx)`. `marginPx = round(16 * scale)`. Rounding is C# `Math.Round` (banker's rounding, midpoint to even); a port must decide whether to replicate it, because it affects 1 px positions at fractional DPI.

### 2.4 Docking model

The capsule is never free-floating. State is `(edge, along)`: `edge` in `{Left, Right, Top, Bottom}`; `along` in `[0,1]` is the fractional position along the free travel of that edge. Defaults: `edge = Right`, `along = 0.5` (center of the right edge). Vertical orientation on Left/Right, horizontal on Top/Bottom.

Algorithms (`LiveCopilotPillDock.cs`, integer pixel math):

- `NearestEdge(centerX, centerY, area)`: `right = areaX + areaW - cx`, `left = cx - areaX`, `bottom = areaY + areaH - cy`, `top = cy - areaY`. Start with edge=Right, best=right; replace with Left if `left < best`; then Bottom if `bottom < best`; then Top if `top < best` (strict less-than each time). Ties therefore prefer Right, then Left, then Bottom, then Top.
- `TravelRange(areaLen, capsuleLen, margin) = max(0, areaLen - capsuleLen - 2*margin)`.
- `PositionFor(edge, along, w, h, area, margin)`: `t = isFinite(along) ? clamp(along,0,1) : 0.5`.
  - Vertical: `x = (Left) areaX + margin | (Right) areaX + areaW - w - margin`; `y = areaY + margin + round(t * TravelRange(areaH, h, margin))`.
  - Horizontal: `x = areaX + margin + round(t * TravelRange(areaW, w, margin))`; `y = (Top) areaY + margin | (Bottom) areaY + areaH - h - margin`.
  - A capsule longer than the edge has travel 0 and is pinned to the start (`areaX/Y + margin`).
- `AlongFor(edge, x, y, w, h, area, margin)`: vertical `offset = y - areaY - margin`, `range = TravelRange(areaH, h, margin)`; horizontal `offset = x - areaX - margin`, `range = TravelRange(areaW, w, margin)`; result is `0.5` when `range <= 0`, else `clamp(offset/range, 0, 1)`.
- `ExpandedBounds(edge, capsule rect, panelW, panelH, gap, area)` (panel open):
  - Vertical edge: `width = min(capW + gap + panelW, areaW)`, `height = min(max(capH, panelH), areaH)`, `x = Left ? capX : capX + capW - width`, `y = capY + (capH - height) / 2`.
  - Horizontal edge: `width = min(max(capW, panelW), areaW)`, `height = min(capH + gap + panelH, areaH)`, `x = capX + (capW - width) / 2`, `y = Top ? capY : capY + capH - height`.
  - `/ 2` is C# integer division, truncating toward zero. It is negative when the panel is taller than the capsule, so `-259/2 = -129`, not -130. A JS port must use `Math.trunc`.
  - The rectangle is then clamped inside the work area with `Clamp` (below). The result is the window rectangle; the capsule keeps its screen position unless the clamp moved the window.
- `Clamp(x, y, w, h, area)` (`LiveCopilotPillPlacement.cs`): `maxX = max(areaX, areaX + areaW - w)`, `maxY = max(areaY, areaY + areaH - h)`; result `(clamp(x, areaX, maxX), clamp(y, areaY, maxY))`. A window larger than the area is pinned to the area's top-left. This class is also used by the meeting-detected popup (`MeetingPromptPlacement`), which belongs to another module.
- `ParseEdge(raw)`: case-insensitive enum parse; unknown, null or empty yields `Right`. Quirk: numeric strings `"0".."3"` are accepted (0=Left, 1=Right, 2=Top, 3=Bottom) and comma-separated names parse as flags (`"Left,Top"` becomes Top); any value that is not a defined member (for example `"7"`) yields Right.

Worked example (scale 1, work area 0,0,1920x1040): vertical capsule 64x240, margin 16, Right, along 0.5: `x = 1920-64-16 = 1840`, travel `= 1040-240-32 = 768`, `y = 16 + round(384) = 400`. Expanded: `width = 64+8+380 = 452`, `height = 500`, `x = 1840+64-452 = 1452`, `y = 400 + (240-500)/2 = 270`. Top edge, along 0.5, capsule 272x64: travel `= 1920-272-32 = 1616`, `x = 16+808 = 824`, `y = 16`.

Work area used for docking (`CurrentWorkArea`): the primary display work area the very first time (`_placed == false`); afterwards the display nearest to the window's current rectangle (`DisplayAreaFallback.Nearest`). The work area excludes the taskbar. The monitor is not persisted: after an app restart the capsule always docks first on the primary display.

`Dock()` (instant re-dock, also the recovery path): read the work area; if this is the first placement, move the window to the work-area origin first so `GetDpiForWindow` reports the target monitor DPI, and set `_placed`; read scale fresh; apply orientation for the current edge; compute capsule and window rectangles; call `SetBounds`.

`SetBounds(window, capsule, expanded, scale)`: `MoveAndResize(window)`; `CapsuleHost.Margin = ((capsule.x - window.x)/scale, (capsule.y - window.y)/scale, 0, 0)`. When expanded, the panel grid is placed in DIPs:
- Vertical edge: `x = Left ? capsule.w + gap : 0`, `y = 0`, `width = window.w - capsule.w - gap`, `height = window.h`.
- Horizontal edge: `x = 0`, `y = Top ? capsule.h + gap : 0`, `width = window.w`, `height = window.h - capsule.h - gap`.
- Panel margin = `(x/scale, y/scale, 0, 0)`, width/height `max(0, value/scale)`.
Then the actual position and size are read back (Windows may refuse the requested size), stored as `_expectedRect`, and the shape is applied to the actual size.

Orientation (`ApplyOrientation(vertical)`): stack orientation vertical or horizontal; capsule host size 64x240 or 272x64 DIP; `_verticalLayout` updated.

Re-dock on system changes (`OnAppWindowChanged`): ignored unless position or size changed, the window is visible, and none of `_dragging`, `_pressed`, a running tween, `_redockQueued` hold. If the new rectangle differs from `_expectedRect` by more than 2 px on any of x, y, width, height, a single `Dock()` is queued on the dispatcher (re-checked when it runs). This handles monitor removal and DPI changes.

### 2.5 Show and hide

`SetVisibleAsync(visible, collapse=false)` (`:275-322`):

Show path:
1. `_wantVisible = true`. The first call starts `RestoreDockAsync` (once, cached for the process lifetime) and awaits it: loads settings, reads `LiveCopilotPillEdge` and `LiveCopilotPillAlong`. Any exception leaves the defaults.
2. If `_wantVisible` flipped to false while loading, return.
3. If the window is already visible and not exiting, return (no re-dock, no animation).
4. Otherwise stop any tween, clear `_exiting` and `_entering`, set root and capsule opacity to 1, `Dock()`, start the audio bars (`AudioBars.IsRunning = true`), `PlayEntrance()`.

Hide path:
1. `_wantVisible = false`; cancel any started hint (timer stopped, pending flag cleared, tooltip closed).
2. If `collapse` and the panel is open, collapse it instantly (no animation).
3. If the window is not visible or is already exiting: stop the bars and return.
4. Stop the save timer and save the dock immediately (awaited). If a show request arrived meanwhile, return.
5. `PlayExit()`.

Entrance (`PlayEntrance`): with animations on: `_entering = true`, root opacity 0, move/resize to the off-screen rectangle, show without activation, tween the off-screen rect to the docked rect over 300 ms with ease-out quint (`1-(1-t)^5`) while root opacity = eased progress; on done: opacity 1, `_expectedRect = docked`, `_entering = false`, run a pending started hint. With animations off (Windows "animation effects" setting, `UISettings.AnimationsEnabled == false`): show immediately at the docked rect and run a pending hint.

Off-screen rectangle: the docked rectangle shifted past its own edge by its own thickness plus the margin: Right `x += w + margin`; Left `x -= w + margin`; Top `y -= h + margin`; Bottom `y += h + margin`.

Exit (`PlayExit`): with animations on: `_exiting = true`, tween docked rect to the off-screen rect over 160 ms with ease-in cubic (`t^3`), root opacity = `1 - eased`; on done: `_exiting = false`; if `_wantVisible` became true meanwhile return; else hide the window, stop the bars, restore root and capsule opacity to 1, and move the (hidden) window back to the docked position so the next show finds the right monitor instead of the off-screen target. With animations off the same finish step runs immediately.

Started hint (`ShowStartedHint`): sets `_startedHintPending`; if the window is visible and not entering or exiting, runs at once; otherwise it runs when the entrance finishes. `RunStartedHint`: clears pending, plays the pulse, opens the tooltip, restarts the 2500 ms timer. When the timer ticks the tooltip closes. The hint is also closed when a drag starts, on hide, and on window close.
- Pulse: only when animations are on. The capsule stack (`CapsuleScale`, render origin 0.5,0.5) animates `ScaleX` and `ScaleY` from 1 to 1.08 over 180 ms, auto-reverse, sine ease-in-out. On exception the scale resets to 1.
- Tooltip: content string `LiveCopilot_StartedMessage`, attached to the logo tile (`IconTile`), placed away from the screen edge: dock Right opens to the Left, Left opens Right, Top opens Bottom, Bottom opens Top. Exceptions are swallowed.

### 2.6 Capsule contents

Order (stack direction follows orientation), spacing 8 DIP, centered:
1. Logo tile, 32x32 DIP, holding a native button (32x32, no border, `OverlayCornerRadius`, fill `ControlFillColorDefaultBrush`) with the 22x22 app icon `Assets/Square44x44Logo.scale-200.png`. Click restores the main window (if minimized, `Restore()`) and activates it (`OpenApp_Click`). Accessible name and tooltip: `LiveCopilot_OpenApp`. AutomationId `BtnLiveCopilotLogoOpenApp`. A press on the logo never starts a drag (the pointer-pressed handler walks `OriginalSource` ancestors up to the capsule host and returns early on `IconTile`).
   - Armed-question badge on the logo tile: 16x16 circle, accent fill, the character `?` in a caption style with text-on-accent color, top-right offset (margin 0,-4,-4,0), visible only when a question is armed, not hit-testable. Accessibility name `LiveCopilot_ArmedBadge`. AutomationId `BadgeLiveCopilotArmed`.
2. Audio bars (section 3.9), bound to `MicLevel` (0..100) and `IsPaused`.
3. Elapsed time text `mm:ss` (minutes unbounded, for example `125:03`), caption style, secondary foreground, min width 40, centered. Tooltip: `LiveCopilot_StatusPaused` when paused, else `LiveCopilot_StatusRecording`. Updates once per second from the recording timer. AutomationId `TxtLiveCopilotElapsed`.
4. Pause/resume button, 36x36, radius 18, command `TogglePause`. Glyph: Segoe MDL2 `U+E769` (pause) while recording, `U+E768` (play) while paused. Accessible name and tooltip: `LiveCopilot_Pause` when recording, `LiveCopilot_Resume` when paused. AutomationId `BtnLiveCopilotPause`.
5. Stop button, 36x36, radius 18, command `ToggleRecording`. Glyph `U+E71A`. Filled with the stop color: dark `#E5484D`, light `#C42B1C`, high contrast `SystemColorHighlightColor`; foreground white (`#FFFFFF`) or `SystemColorHighlightTextColor` in high contrast. Hover opacity 0.85, pressed 0.7 (applied to background and border). Name and tooltip `LiveCopilot_Stop`. AutomationId `BtnLiveCopilotStop`.
6. Chat toggle, 32x32, radius 16, subtle style, glyph `U+E8BD`. Name and tooltip switch with state: `LiveCopilot_Expand` when collapsed, `LiveCopilot_Collapse` when expanded. AutomationId `BtnLiveCopilotChat`.

The capsule host AutomationId is `LiveCopilotCapsule`.

### 2.7 Drag and snap

Pointer handlers sit on the capsule host (not the panel):
- Pressed: ignored if the press originated inside `IconTile`, if a tween is running, or if the left button is not pressed. Otherwise reads the global cursor position (`GetCursorPos`, physical px); if that fails, ignore. Sets `_pressed`, clears `_dragging`, captures the pointer.
- Moved (while `_pressed`): read the global cursor, `dx,dy` = delta from the press cursor. Until dragging starts, ignore moves with `sqrt(dx^2+dy^2) < 4 * scale`. When crossing the threshold, `BeginDrag`. While dragging, `AppWindow.Move(dragOrigin + (dx, dy))`.
- `BeginDrag`: `_dragging = true`, close the started hint tooltip, if the panel is open collapse it instantly (the capsule stays put, so the window becomes the capsule rectangle), then capture `_dragOrigin = AppWindow.Position`.
- Released or capture lost: clear `_pressed`; release pointer capture on release; if a drag was in progress, `EndDrag` then `SnapToNearestEdge`. A press without a drag does nothing, so buttons still receive clicks.
- Global cursor coordinates are used (not pointer coordinates) because the window moves under the cursor while dragging.

`SnapToNearestEdge`: read scale and the work area of the display nearest the dropped window; compute the center `(x + w/2, y + h/2)` with integer division; `edge = NearestEdge(center, area)`; new capsule size from the new orientation; `along = AlongFor(edge, center.x - newW/2, center.y - newH/2, newW, newH, area, marginPx)`; store `_edge`, `_along`; compute the collapsed target rectangle; tween from the current rectangle to the target over 240 ms.
- No orientation flip: ease-out cubic (`1-(1-t)^3`).
- Orientation flip (left/right to top/bottom or back): ease-in-out cubic (`t<0.5 ? 4t^3 : 1-(-2t+2)^3/2`); at eased progress >= 0.5 the layout orientation is switched once, and `CapsuleHost.Opacity = |2*eased - 1|` so the content crossfades through the flip while the window morphs.
- On done: opacity 1, `Dock()`, `ScheduleSave()` (500 ms debounce).
- While the window size changes during a tween, the shape is reapplied each tick as collapsed (`expanded:false`).

Tween engine: 16 ms repeating timer; progress `t = clamp(elapsed / duration, 0, 1)`; `eased = ease(t)`; rectangle components are linearly interpolated and rounded per tick; if the size differs from the current window size, `MoveAndResize` plus `ApplyShape`, else only `Move`. With animations off in Windows, the end state is applied immediately and `onProgress(1)` and `onDone` run synchronously. Starting a tween stops any running one.

### 2.8 Chat panel (expanded state)

`Chat_Click` toggles `SetExpanded(!_isExpanded)` with animation. `SetExpanded(expanded, animate)`: set the state, panel visibility, update the chat button name and tooltip; if the window was never shown and never placed, stop; otherwise `Dock()` (which computes the expanded window per section 2.4). When expanding with animations on: the panel fades 0 to 1 and translates 16 DIP from the docked edge toward its final place over 220 ms, cubic ease-out (Right: X from +16; Left: -16; Top: Y -16; Bottom: Y +16). On exception the panel is shown immediately.

The panel is a vertical grid, padding 12 DIP, row spacing 8, with five rows:

1. Header: title `LiveCopilot_Title` (body strong, ellipsis) and an "open Vozella" subtle button (glyph `U+E8A7`, 16 pt) using `LiveCopilot_OpenApp`, AutomationId `BtnLiveCopilotOpenApp`, same handler as the logo.
2. Detected-question card (visible only while a question is armed): an informational `InfoBar` (not closable) with title `RecordPage_LiveQuestionNotice` and the question body as message, AutomationId `InfoLiveCopilotQuestion`. Under it, right-aligned: an accent "Answer" button (`RecordPage_LiveAnswer`, tooltip `RecordPage_LiveAnswerTooltip`, Ctrl+Enter accelerator scoped to this button, AutomationId `BtnLiveCopilotAnswer`, command `ConfirmLiveAnswer`) and "Dismiss" (`RecordPage_LiveAnswerDismiss`, command `DismissArmedQuestion`, AutomationId `BtnLiveCopilotDismiss`).
3. Answer area (star-sized row): a card (`CardBackgroundFillColorDefaultBrush`, 1 px `CardStrokeColorDefaultBrush`, control corner radius) containing a vertical scroll viewer (padding 12, horizontal scrolling disabled) with, in order:
   - Error `InfoBar` (not closable, severity Error, title `RecordPage_LiveAnswerError`, message = error text, open when an error exists, AutomationId `InfoLiveCopilotError`).
   - A row with a 20x20 progress ring (active and visible only while answering, name `RecordPage_LiveAnswerProgress`, AutomationId `ProgressLiveCopilot`) and a web badge text `LiveCopilot_WebBadge` (caption, secondary color, visible only when the last answer used the web, AutomationId `BadgeLiveCopilotWeb`).
   - Markdown answer text (wrap whole words, transparent background, visible only when there is answer text, AutomationId `MdLiveCopilotAnswer`). Links: only absolute `http` or `https` URIs are launched through the system default handler; every other scheme and any launch failure is silently ignored.
   - Empty hint `LiveCopilot_Empty` (secondary color), visible when there is no answer, not answering and no error.
4. Preset chips, a horizontal row of two buttons. "What did I miss?" (`LiveCopilot_ChipMissed`, sends the string `LiveCopilot_PromptMissed`, AutomationId `BtnLiveCopilotChipMissed`) and "Explain simply" (`LiveCopilot_ChipExplain`, sends `LiveCopilot_PromptExplain`, AutomationId `BtnLiveCopilotChipExplain`). Both run `AskPreset(prompt)`.
5. Typed ask: a single-line text box (`AcceptsReturn=false`, placeholder `RecordPage_LiveAsk.PlaceholderText`, accessible name `RecordPage_LiveAsk.AutomationProperties.Name`, two-way bound to `LiveAskText` on every keystroke, Ctrl+Enter accelerator scoped to the box, AutomationId `TxtLiveCopilotAsk`); a web toggle button (glyph `U+E774`, two-way bound to `ForceWebSearch`, enabled only when `CanUseWebSearch`, tooltip `LiveCopilot_WebTooltipOn` when enabled else `LiveCopilot_WebTooltipOff`, name `LiveCopilot_WebToggle`, AutomationId `ToggleLiveCopilotWeb`); an accent send button (glyph `U+E724`, `LiveCopilot_Send`, command `SubmitTypedAsk`, AutomationId `BtnLiveCopilotSend`).

Ctrl+Enter accelerators have their `ScopeOwner` set after load (to the text box and the Answer button respectively); a null scope owner would make them global. Handler: mark handled and execute the command if `CanExecute`.

String keys and values (en-us / es). Port both locales.

| Key | en-us | es |
|---|---|---|
| LiveCopilot_Title | Live copilot | Copiloto en vivo |
| LiveCopilot_StatusRecording | REC | REC |
| LiveCopilot_StatusPaused | Paused | En pausa |
| LiveCopilot_StartedMessage | Recording started | Grabación iniciada |
| LiveCopilot_ArmedBadge.AutomationProperties.Name | A question was detected | Se detectó una pregunta |
| LiveCopilot_Expand.AutomationProperties.Name and .ToolTipService.ToolTip | Expand live copilot | Expandir el copiloto en vivo |
| LiveCopilot_Collapse.AutomationProperties.Name | Collapse live copilot | Contraer el copiloto en vivo |
| LiveCopilot_Collapse.ToolTipService.ToolTip | Collapse | Contraer |
| LiveCopilot_Pause.AutomationProperties.Name | Pause recording | Pausar la grabación |
| LiveCopilot_Resume.AutomationProperties.Name | Resume recording | Reanudar la grabación |
| LiveCopilot_Stop.AutomationProperties.Name and ToolTip | Stop recording | Detener la grabación |
| LiveCopilot_OpenApp.AutomationProperties.Name and ToolTip | Open Vozella | Abrir Vozella |
| LiveCopilot_Empty.Text | Ask a question below, or answer one Vozella detects. | Escribe una pregunta abajo o responde una que Vozella detecte. |
| LiveCopilot_WebBadge.Text | 🌐 Searched the web | 🌐 Búsqueda en la web |
| LiveCopilot_ChipMissed.Content | What did I miss? | ¿Qué me perdí? |
| LiveCopilot_ChipMissed.AutomationProperties.Name | Ask what you missed in the last few minutes | Preguntar qué te perdiste en los últimos minutos |
| LiveCopilot_PromptMissed | What did I miss? Summarize the last few minutes. | ¿Qué me perdí? Resume los últimos minutos. |
| LiveCopilot_ChipExplain.Content | Explain simply | Explicar fácil |
| LiveCopilot_ChipExplain.AutomationProperties.Name | Ask for the last point in simple terms | Pedir el último punto en términos sencillos |
| LiveCopilot_PromptExplain | Explain the last point in simple terms. | Explica el último punto en términos sencillos. |
| LiveCopilot_Send.AutomationProperties.Name | Ask the question | Hacer la pregunta |
| LiveCopilot_Send.ToolTipService.ToolTip | Ask (Ctrl+Enter) | Preguntar (Ctrl+Enter) |
| LiveCopilot_WebToggle.AutomationProperties.Name and LiveCopilot_WebTooltipOn | Search the web for the answer | Buscar en la web para responder |
| LiveCopilot_WebTooltipOff | No web search with this provider | Sin búsqueda web con este proveedor |
| LiveCopilot_NeedsSetup | Open Vozella to finish provider setup. | Abre Vozella para terminar de configurar el proveedor. |
| RecordPage_LiveQuestionNotice.Title | Question detected | Pregunta detectada |
| RecordPage_LiveQuestionNotice.AutomationProperties.Name | Detected question | Pregunta detectada |
| RecordPage_LiveAnswer.Content | Answer | Responder |
| RecordPage_LiveAnswer.AutomationProperties.Name | Answer the detected question | Responder la pregunta detectada |
| RecordPage_LiveAnswerTooltip | Answer (Ctrl+Enter) | Responder (Ctrl+Enter) |
| RecordPage_LiveAnswerDismiss.Content | Dismiss | Descartar |
| RecordPage_LiveAnswerDismiss.AutomationProperties.Name | Dismiss the detected question | Descartar la pregunta detectada |
| RecordPage_LiveAsk.PlaceholderText | Type a question, then press Ctrl+Enter | Escribe una pregunta y presiona Ctrl+Enter |
| RecordPage_LiveAsk.AutomationProperties.Name | Type a question | Escribir una pregunta |
| RecordPage_LiveAnswerProgress.AutomationProperties.Name | Answering | Respondiendo |
| RecordPage_LiveAnswerError.Title | Could not answer | No se pudo responder |
| RecordPage_LiveAnswerError.AutomationProperties.Name | Live answer error | Error de respuesta en vivo |
| RecordPage_LiveAnswerEmpty | The answer came back empty. | La respuesta llegó vacía. |
| Status_SetupCancelled | Setup cancelled. | Configuración cancelada. |

Unused legacy keys present in the resource files (do not port): `LiveCopilot_Grip.AutomationProperties.Name`, `RecordPage_LiveAnswerHeading`, `RecordPage_LiveAnswerText`, `RecordPage_LiveAskTooltip`, `RecordPage_LiveAsk.Header`, `RecordPage_WebToggle`. The CLI error keys (`Error_CliNotInstalled`, `Error_CliNotSignedIn`, `Error_CliSubscriptionInactive`, `Error_CliTimedOut`, `Error_CliEmptyOutput`, `Error_CliUnknown`) belong to the summary-provider module; they surface here as the answer error text.

### 2.9 Asking: states and errors

State owned by the recording view model (shared with the Record page): `ArmedQuestion` (string, empty = none), `LiveAskText`, `LiveAnswerText`, `LiveAnswerError`, `IsAnswering`, `LiveAnswerUsedWeb`, `ForceWebSearch` (default false), `CanUseWebSearch`.

Commands and enablement:
- `ConfirmLiveAnswer` (Answer button, Ctrl+Enter on that button): enabled when `IsRecording && (LiveAskText non-blank || a question is armed)`.
- `SubmitTypedAsk` (send button, Ctrl+Enter in the text box): enabled when `IsRecording && LiveAskText non-blank`.
- `DismissArmedQuestion`: enabled when a question is armed. Adds the armed body to the dismissed set (ordinal compare), clears the armed question and the web verdict.
- `AskPreset(prompt)`: no-op if the prompt is blank or not recording; else sets `LiveAskText = prompt.Trim()` and asks through the typed path.
- All ask commands allow concurrent execution; a newer ask supersedes an older one through a generation counter and a cancellation token.

`AskLive(typedOnly)` algorithm (`RecordingPageViewModel.cs:536-645`):
1. If not recording, stop.
2. `typed = LiveAskText.Trim()`, `armed = ArmedQuestion`. `question = typed` if non-empty else `armed.Trim()`. If `typedOnly && typed is empty`, stop. If `question` is empty, stop.
3. `confirmPath = !typedOnly`. `clearedArmed = confirmPath && armed non-empty`. `questionIsArmed = typed is empty`. If `confirmPath`, `ArmedQuestion` is cleared immediately.
4. Increment the answer generation, replace the cancellation source (cancelling the previous), set `IsAnswering = true`, clear `LiveAnswerError`, `LiveAnswerText`, `LiveAnswerUsedWeb`.
5. Snapshot the committed transcript and `forceWeb`.
6. Load settings; resolve the summary provider kind. `supportsWeb = kind in {ClaudeCode, Codex}`; `CanUseWebSearch = supportsWeb`.
7. `jevNeedsWeb = supportsWeb && !forceWeb && (questionIsArmed ? armedNeedsWeb : await JudgeNeedsWeb(question))`. The typed-question judgment is skipped (false) when `TypeSafeEnabled` is false, no API key exists, or any non-cancellation error occurs.
8. `useWeb = supportsWeb && (forceWeb || jevNeedsWeb)`.
9. Resolve the provider (may show a model-download or sign-in dialog from the host page). If unresolved (null): publish an error and stop. Error text is `Status_SetupCancelled` if the host has wired the setup resolver for that provider kind (the user cancelled), else `LiveCopilot_NeedsSetup` (the pill was used before the Record page wired the resolvers). If a question had been cleared from the armed slot, it is restored together with its web verdict. Answering ends.
10. Build the prompt (section 3.1) using language `ResolveSummaryLanguage()`, the 90 s transcript window, the session context from `MeetingTitle` and `MeetingBrief`, and `useWeb`.
11. Stream the provider response off the UI thread (section 3.8). An empty or whitespace result shows error `RecordPage_LiveAnswerEmpty`, ends answering, and does not restore the armed question.
12. Success: publish `answer.Trim()`, empty error, `IsAnswering=false`, `LiveAnswerUsedWeb = useWeb`.
13. Cancellation is silent (a newer ask or Stop owns the UI). Any other exception shows `CliFailureUserMessage.Format(ex)`: CLI failures map to localized strings with the provider display name (unknown CLI failures append the CLI detail); other exceptions use `ex.Message`.
14. All UI publishes are marshaled to the UI thread and dropped if the generation is stale.

Stop, discard and starting a new recording cancel in-flight answers and judgments. Starting a recording resets the whole live-answer session: clears the armed question, the dismissed set, the baseline, committed snapshots, typed text, answer, error and the used-web flag, and refreshes `CanUseWebSearch` from the current provider. `ForceWebSearch` is not reset.

### 2.10 Question arming (automatic detection)

Pipeline (`RecordingPageViewModel.cs:373-470`): every live transcript update carries `CommittedText` (finals only; lines joined with `Environment.NewLine`) and `DisplayText`. While recording, if `CommittedText` equals the last seen value the call returns. Otherwise it records the new value and starts a background judgment with a fresh generation and cancellation token, cancelling the previous one:

1. Bail out if cancelled or the generation is stale (checked before and after loading settings).
2. If `TypeSafeEnabled` is false (default true), or there is no credential, or the API key is blank: mark the current transcript as the baseline (so those lines are never judged later) and stop.
3. Call `LiveQuestionJevJudge.JudgeAsync(api, apiKey, baseline, current)`.
4. On the UI thread: drop the result if the generation is stale or recording ended. Set the baseline to the judged transcript. If the armed body is empty or is in the dismissed set, stop. Otherwise set `ArmedQuestion = body` and `armedNeedsWeb`.
5. `TypeSafeException` and any other exception are swallowed (no UI error, recording unaffected). The baseline is not advanced on failure, so the next update re-judges the same new lines plus any added ones.

There is no fallback to the local heuristic detector.

Armed question visible effects: the badge on the logo, the question card in the panel, enablement of the Answer button. A new armed question replaces the previous one silently.

## 3. Domain rules

### 3.1 Prompt (`LiveAnswerPromptBuilder.Build`)

Signature: `Build(question, transcriptWindow, outputLanguage, sessionContext = null, webSearch = false)`. Null `question` or `transcriptWindow` become empty. Language: `"English"` if `outputLanguage?.Trim()` equals `en` ignoring case (ordinal); every other value including null becomes `"Spanish"`.

The prompt text, verbatim. `{language}`, `{contextBlock}`, `{webLine}`, `{question}`, `{transcriptWindow}` are substitutions. Lines are separated by `\n` and there is no trailing newline after the transcript window:

```
You are answering a question that was just asked in a live class or meeting.

Write a short answer in 2 to 5 sentences. Write the answer in {language}.

Use the transcript window as context for the topic and who asked.

If the transcript does not contain the factual answer, answer from knowledge. Do not refuse just because the meeting did not state the fact. Do not say that you only know what was said.

{contextBlock}{webLine}Question:
{question}

Transcript window:
{transcriptWindow}
```

`contextBlock` is the empty string when `sessionContext` is null, empty or whitespace. Otherwise it is exactly the following text followed by a single `\n` (so there is no blank line between this block and `Question:`):

```
Session context:
{sessionContext.Trim()}

The session context is the topic, course, or meeting brief supplied by the user. Use it to interpret the question.
```

`webLine` is empty unless `webSearch` is true, in which case it is exactly `You may use web search for current or external facts (competitors, prices, recent news) and keep the answer short.` followed by `\n\n`.

Tests only check `Contains` on key phrases, so the blank-line detail is not pinned by tests; a port should still reproduce it. With `webSearch` false the prompt must contain no occurrence of the word "web" (case-insensitive); keep that invariant when editing wording.

### 3.2 Web policy (`LiveAnswerWebPolicy`)

- `SupportsWebSearch(kind)`: true only for `SummaryProviderKind.ClaudeCode` and `Codex`. False for `Xai` and `Local`.
- `ShouldUseWeb(providerSupportsWeb, forced, jevNeedsWeb) = providerSupportsWeb && (forced || jevNeedsWeb)`.
- `MaxSessionContextChars = 1500`.
- `BuildSessionContext(title, brief)`: trim both (null becomes empty). Both empty: return null. Title only: `"Meeting: {title}"`. Brief only: the trimmed brief. Both: `"Meeting: {title}\n{brief}"`. If longer than 1500 UTF-16 code units, cut to the first 1500 and `TrimEnd()` (so the result can be shorter than 1500). The cut is by UTF-16 units and may split a surrogate pair.
- The live-answer path builds the Claude Code or Codex CLI provider with provider-side web search on only when `useWeb`; summaries and chat never receive web arguments (`SummaryProviderResolver`, `AppServices.CreateLiveAnswerProvider`). xAI and Local ignore the flag.

### 3.3 Transcript window (`LiveAnswerWindow.TakeRecent`)

Constants: `Default = 90 s`; untimestamped fallback `2500` characters.

Transcript line format (shared with `TranscriptStampFormatter` and `CommittedTranscriptLine`):
- Optional header lines `Recorded yyyy-MM-dd HH:mm` and `Ended yyyy-MM-dd HH:mm` (a line is a header if, after trimming leading whitespace, it starts with `Recorded ` or `Ended `, ordinal).
- Content lines: `[mm:ss.ff-mm:ss.ff] [ Speaker-N ] text`, or `[mm:ss.ff-mm:ss.ff] text` when there is no speaker.
- Elapsed parse: minutes of at least 2 digits (unbounded), `:`, seconds exactly 2 digits and at most 59, `.`, hundredths exactly 2 digits; total length exactly `dot + 3`; digits only (`NumberStyles.None`). Time = minutes + seconds + hundredths*10 ms. The range is `start-end` split at the first `-`; both halves must parse. The `[` must be the first character and the `]` index must be at least 2.
- Line splitting accepts `\r\n`, `\n` and `\r`.
- Body extraction (`ExtractBody`): if the line has a valid stamp, take the text after `]`; if it starts with ` [ Speaker-` followed by one or more digits and ` ]`, strip that tag; trim. If the stamp does not parse, the whole line trimmed is the body.

Algorithm:
1. Null or empty input returns the empty string.
2. Split into lines. For each line compute `hasEnd` (stamp parsed), `end`, `isHeader`. `latest` = maximum `end` over all stamped lines.
3. No stamped lines: return the last 2500 characters of the input (or the whole input if shorter). The cut ignores line boundaries.
4. `cutoff = latest - window` (saturates to `TimeSpan.MaxValue` or `MinValue` on overflow, with a negative window giving MaxValue).
5. A stamped line is "in span" when `cutoff <= end <= latest` (inclusive at both ends). `firstInSpan` and `lastInSpan` are the indexes of the first and last in-span lines. If none, return the empty string.
6. Output, in original order: skip header lines; keep stamped lines that are in span; keep unstamped, non-header lines whose index lies between `firstInSpan` and `lastInSpan` inclusive; drop everything else.
7. Join with `\r\n` if the input contained `\r\n`, else `\n`.

Example (from tests): lines ending at 20 s, 109 s, 110 s, 130 s, 200 s with a 90 s window keep those ending at 110, 130 and 200 (110 is exactly 90 s before 200 and is kept; 109 is dropped).

### 3.4 Question detection by Jev (`LiveQuestionJevJudge.JudgeAsync`)

Constants: `ArmThreshold = 0.7` (inclusive: `>= 0.7` arms), `WebThreshold = 0.6` (inclusive). A "Noul" is the probability that the answer to a yes/no question is yes; it is not a confidence score.

Algorithm:
1. Null `api` throws `ArgumentNullException`.
2. `bodies` = bodies of lines new since `previousCommitted`: empty current text, or current equal to previous (ordinal), gives no bodies; a line is new if it is non-empty, not in the set of previous lines (exact, ordinal, whole-line match), and not a header; its body is `ExtractBody(line)`; blank bodies are skipped. With no bodies, return null without any HTTP call.
3. Check cancellation. Build one request with two questions per body: `line_{i}` (is it a direct question) and `web_{i}` (does it need the web); `i` is the zero-based index in `bodies`.
4. One call `EvaluateAsync(apiKey, state, questions)`.
5. Iterate `i = 0..n-1` in order. A body is armed if the `line_{i}` answer exists, has `type` equal to `noul` (case-insensitive) and `noul >= 0.7`. A missing, wrong-type or low answer does not arm it. For an armed body, `needsWeb` is true when the `web_{i}` answer exists, is `noul`-typed and `>= 0.6`. The result is the last armed body in order (later lines overwrite earlier ones) with its own `needsWeb`; null if none.

State sent to Jev: `{"recent_transcript": TakeRecent(currentCommitted, 90 s), "new_lines": [body, ...]}`. `recent_transcript` contains the full recent window including stamps and speaker tags, so meeting content leaves the device whenever TypeSafe is enabled.

Question texts, verbatim:
- Direct question, `instructions.question`: `Is this line a direct question that expects a factual or explanatory answer from someone in the room right now?`
- Direct `criteria.true`: `Asks for a fact, definition, rule, procedure, or explanation, even if the transcript dropped the question mark. Includes a question asked to the room, not only to one person.`
- Direct `criteria.false`: `A statement, acknowledgment, greeting, or a rhetorical check that people are following, such as "does that make sense", "¿se entiende?", "right?", or "ok?". It does not expect a factual answer.`
- Needs web, `instructions.question`: `Does a good answer to this question need current or external information that is not in the transcript and not stable general knowledge?`
- Web `criteria.true`: `Asks about competitors, prices, recent news, specific products or companies, current events, or live data that changes over time.`
- Web `criteria.false`: `Asks for a definition, a textbook concept, a stable fact such as the Agile Manifesto values, or anything the transcript already answers.`

### 3.5 Typed-question web judgment (`JudgeNeedsWebAsync`)

A blank question returns false with no HTTP. Otherwise trim, send one request with `state = {recent_transcript, new_lines: [body]}` and a single question id `web` (the same web question as above), and return `noul >= 0.6` (false when missing or not `noul`). Cancellation propagates; the caller maps all other errors to false.

### 3.6 TypeSafe wire protocol used by this module

`POST https://api.typesafe.ai/v1/systemone`, headers `Authorization: Bearer <key>` and `User-Agent: MeetingLive`, JSON body (camelCase from web defaults; explicit property names below; the API key never appears in the body):

```json
{
  "state": {
    "recent_transcript": "[02:00.00-02:08.00] What is the rollback plan?",
    "new_lines": ["What is the rollback plan?"]
  },
  "model": "jev-latest",
  "questions": {
    "line_0": {
      "type": "noul",
      "instructions": { "line": "What is the rollback plan?", "question": "Is this line a direct question ..." },
      "criteria": { "true": "Asks for a fact ...", "false": "A statement ..." }
    },
    "web_0": {
      "type": "noul",
      "instructions": { "line": "What is the rollback plan?", "question": "Does a good answer ..." },
      "criteria": { "true": "Asks about competitors ...", "false": "Asks for a definition ..." }
    }
  }
}
```

Response:

```json
{ "model": "jev-1.13.0", "answers": { "line_0": { "type": "noul", "noul": 0.91 }, "web_0": { "type": "noul", "noul": 0.2 } } }
```

Client behavior (owned by the TypeSafe module but observable here): up to 3 attempts, retrying only HTTP 429 and 529, with the delay from `Retry-After` (seconds or date) else `200 ms * 2^attempt`; 401 maps to an unauthorized error, 429 to rate limited, 529 to overloaded, any other failure to a generic failure; response bodies are never surfaced; an empty `answers` map is an error ("TypeSafe did not return any answers."); malformed JSON is a generic failure. A blank API key throws unauthorized before any request.

### 3.7 Local heuristic detector (`LiveQuestionDetector`), not used by the app

`TryDetectNew(previous, current)` returns the body of the last new line for which `IsDirectQuestion` holds, or null. New-line selection is the same as in section 3.4 step 2 (blank bodies pass to the predicate and fail it). `IsDirectQuestion(body)`:
1. Blank body: false.
2. A question signal is required on the trimmed body: it contains `¿`, or ends with `?`, or starts with an interrogative.
3. `Normalize(body)` must be at least 12 characters. `Normalize` = trim, trim the edge punctuation set, trim, lowercase invariant, collapse any run of whitespace into one space.
4. The normalized body must not equal (whole-body, ordinal) any rhetorical phrase.

Edge punctuation set: `¿ ? ! ¡ . , ; : " ' “ ” ‘ ’ ( ) [ ] { } … — – - « »`.
Interrogative words (the first word of the normalized body after trimming edge punctuation): `qué cómo como cuál cual cuáles cuales cuándo cuando dónde donde quién quien quiénes quienes what how why when where who which`. Plus the phrase `por qué` at the start, followed by end of text, whitespace or an edge punctuation character.
Rhetorical bodies: `se entiende, ok, okay, verdad, no, claro, me explico, me seguis, me seguís, me siguen, right, does that make sense, make sense, got it, entendido, si, sí, dale, todo bien, listo, estan, están`.
A body that merely contains a rhetorical word (for example "¿no es ese el tercer principio del manifiesto ágil?") still counts. "Porque ..." is not an interrogative.

### 3.8 Streaming answers

`StreamLiveAnswer` runs off the UI thread and iterates `provider.StreamPromptAsync(prompt)` chunks, appending to a buffer. Nothing is shown until the buffer has received at least one non-whitespace chunk. The first visible update is pushed at once; later updates are pushed at most every 80 ms (`LiveAnswerFlushInterval`) with `TrimStart()`-ed text and `answering = true`. It returns the full raw buffer; the final published text is trimmed on both ends.

### 3.9 Audio bars (`AudioBarsControl`) and the level meter

Five rounded bars (width 3 DIP, spacing 3, panel height 24, vertically centered, filled with the primary text color). Inputs: `Level` 0..100, `IsPaused`, `IsRunning`. `LevelFraction = IsPaused ? 0 : clamp(isFinite(Level) ? Level/100 : 0, 0, 1)`. `TargetHeight(i, phase) = 3 + (24-3) * clamp(LevelFraction * Profile[i] * phase, 0, 1)`; `Profile = [0.55, 0.8, 1.0, 0.8, 0.55]`.
- Running and animations on: a 33 ms timer; each tick `t = seconds since start`, `phase_i = 0.75 + 0.25 * sin(PhaseStep[i] + t * PhaseSpeed[i])` with `PhaseStep = [0, 1.3, 2.6, 3.9, 5.2]` and `PhaseSpeed = [7.0, 9.5, 8.0, 10.5, 7.5]`; each height moves toward the target by factor `0.55` when rising (attack) and `0.14` when falling (decay).
- Not running or animations off: bars jump to `TargetHeight(i, phase = 1.0)` immediately on input change; no timer.
- Paused: level fraction 0, so the bars settle to 3 DIP dots.
- Heights are rounded to 0.1 DIP. The control is not hit-testable and hidden from accessibility.
- `MicLevel = ToMeterValue(amplitude) * 100` where `ToMeterValue = clamp((20*log10(max(amplitude, 1e-6)) + 60) / 60, 0, 1)` (NaN gives 0). The amplitude comes either from the idle level meter or from the RMS of each recorded PCM frame (`sqrt(mean(sample^2))`, empty frames ignored). `MicLevel` is set to 0 when the mic preview stops.

## 4. Persistence and wire formats

### 4.1 Dock position (settings file)

Stored in the app settings JSON (camelCase, indented, `JsonSerializerDefaults.Web`):

```json
{ "liveCopilotPillEdge": "Right", "liveCopilotPillAlong": 0.5 }
```

- `liveCopilotPillEdge`: string, the `DockEdge` enum name; null or absent means Right. Resolved with `ParseEdge` (section 2.4).
- `liveCopilotPillAlong`: number or null; resolved as `clamp(value, 0, 1)` if finite, else 0.5.
- Legacy `liveCopilotPillX` and `liveCopilotPillY` (ints) still exist in the model and are round-tripped by tests, but the pill no longer reads or writes them.
- Read once per process lifetime on first show (`RestoreDockAsync`); written on a 500 ms debounce after each snap, and immediately (awaited) when the pill hides. `SavePositionAsync` loads the full settings, returns without writing if the edge string is equal and the saved along is within 0.0005 of the current value, else sets both fields and saves the whole settings object. All errors are swallowed.
- Not persisted: the monitor, the panel open/closed state, `ForceWebSearch`, the typed text.

### 4.2 Other inputs consumed

- `TypeSafeEnabled` (default true) and the TypeSafe API key from the credential store.
- Summary provider kind, summary language (`ResolveSummaryLanguage()`; `en` means English, anything else Spanish) and provider model settings.
- `MeetingTitle` and `MeetingBrief` from the recording page view model for the session context.
- Transcript formats: section 3.3.

## 5. Native and OS dependencies

| Dependency | What it does | Class |
|---|---|---|
| WinUI 3 `Window`, `AppWindow`, `OverlappedPresenter` | Window, always-on-top, no border or title, hidden from switchers, show without activating | Windows-only. Electron: `BrowserWindow` with `frame:false`, `alwaysOnTop`, `skipTaskbar`, `resizable:false`, `showInactive()` |
| `GetWindowLongW`, `SetWindowLongW`, `SetWindowPos` | Strip `WS_CAPTION` and `WS_THICKFRAME`, refresh the frame | Windows-only; not needed with `frame:false` |
| `GetClientRect`, `GetDpiForWindow` | Client versus outer verification, DPI | Windows-only. Electron: `screen` display `scaleFactor` (portable) |
| `GetCursorPos` | Global cursor during drag | Windows-only. Electron: `screen.getCursorScreenPoint()` (portable) |
| `CreateRoundRectRgn`, `SetWindowRgn`, `DeleteObject` | Capsule silhouette | Windows-only. Electron: transparent window with CSS `border-radius`, or `setShape`; decide click-through behavior of transparent corners explicitly |
| `DwmSetWindowAttribute` (corner preference, border color) | Suppress DWM rounding and border | Windows 11 only; not needed with a transparent frameless window |
| `DisplayArea` work areas, `GetFromRect(Nearest)` | Work area excluding the taskbar | Portable via `screen.getDisplayNearestPoint(...).workArea` (Electron mixes DIP and physical pixels; convert deliberately) |
| `UISettings.AnimationsEnabled` | Reduced-motion switch | Portable via `prefers-reduced-motion`; on Windows also `systemPreferences.getAnimationSettings()` |
| `AppWindow.Changed` | Detect system move or resize (monitor removal, DPI) | Portable via `screen` events `display-removed` and `display-metrics-changed` |
| Segoe MDL2 glyphs `E769 E768 E71A E8BD E8A7 E774 E724` | Icons | Windows font; use bundled SVG icons in Electron |
| `Windows.System.Launcher.LaunchUriAsync` | Open http(s) links | Portable via `shell.openExternal` after the same scheme check |
| Dispatcher timers and Storyboards | Tweens, pulse, panel fade | Portable (CSS or JS timing) |
| `MarkdownTextBlock` (CommunityToolkit) | Render answer markdown | Portable; use a sanitizing markdown renderer, never raw HTML |
| Main-window minimize, restore, activate | Handoff and "open app" | Portable (`win.minimize()`, `restore()`, `focus()`); active/deactivated comes from `focus` and `blur` events |
| HTTPS to `api.typesafe.ai` | Question judgment | Portable |
| Summary providers (Claude Code CLI, Codex CLI, xAI, local LLM) with CLI web-search flag | Answer generation | Cross-module; process spawning is portable, CLI availability on macOS is unverified |

Click-through and focus notes for the port: the Windows pill is not click-through, so do not add `setIgnoreMouseEvents`. The pill must not take focus when it appears, but must accept focus on click so the typing box works.

## 6. Existing test coverage (MeetingLive.Core.Tests/Services)

- `LiveAnswerPromptBuilderTests`: Spanish prompt contains the question, the window, "If the transcript does not contain the factual answer, answer from knowledge.", "Do not refuse just because the meeting did not state the fact.", "Do not say that you only know what was said.", "Spanish", "2 to 5 sentences", "live class or meeting", "who asked"; English asks for English and omits "Spanish"; null and `fr` fall back to Spanish and never mention English or French; session context adds "Session context:", the text and "interpret the question"; null, empty and whitespace context omit the block (3 theory rows); web search true adds "web search", "competitors, prices, recent news" and "keep the answer short"; web false contains no "web" case-insensitively; context plus web keeps the question and window sections.
- `LiveAnswerWebPolicyTests`: `SupportsWebSearch` (ClaudeCode and Codex true, Xai and Local false); `ShouldUseWeb` full 8-row truth table; `BuildSessionContext` blank inputs (3 rows) return null, title-only is `Meeting: ...`, brief-only is trimmed, both joined with `\n`, long brief capped at 1500.
- `LiveAnswerWindowTests`: default is 90 s; inclusive 90 s boundary (keeps 110/130/200, drops 20/109); unstamped lines inside the span kept, headers and decoy header-like lines dropped, unstamped lines outside the span dropped; no timestamps returns the last 2500 characters; shorter than 2500 returns the whole text; null returns empty and garbage input is returned unchanged without throwing.
- `LiveCopilotPillDockTests` (about 40 rows): `IsVertical`; defaults (Right, 0.5); `NearestEdge` four edges, screen center snaps to an edge, tie order Right/Left/Bottom, non-zero origin; `PositionFor` for each edge (test margin 12), non-zero origin, out-of-range and NaN `along` (-3, 7, NaN) staying inside, capsule that does not fit pinned to the start; `AlongFor` round trips (Right 0/0.5/1, Left 0.25, Top 0/0.75, Bottom 1/0.4), clamping past the ends, no travel returns 0.5; `ExpandedBounds` Right/Left/Top/Bottom with 380x500 panel and gap 8, near-end shift back inside, panel larger than the area shrinks to the area; `ParseEdge` (`Left`, `right`, `TOP`, `Bottom`, null, empty, `diagonal`, `7` default to Right). The file comment says capsule 64x184 and margin 12; the app uses 64x240 and 16. The math is size-agnostic, so carry over the cases but not the stale comment.
- `LiveCopilotPillPlacementTests`: inside unchanged; clamping rows for a 240x48 window in a 1920x1040 area ((-50,100) gives (0,100); (100,-30) gives (100,0); (5000,100) gives (1680,100); (100,5000) gives (100,992); (5000,5000) gives (1680,992)); non-zero origin; window larger than the area pinned to the origin; exact fit returns the origin.
- `LiveCopilotRecordingHandoffTests` (9): start transition minimizes and shows the hint; already recording, stopping and idle do not; `ShouldShowPill` true on handoff while the main window is still active, false when recording with the main window active, true when recording with the main window inactive, false when not recording; hint duration is 2.5 s.
- `LiveQuestionDetectorTests`: Spanish question returns the body; same question already committed returns null; English question; rhetorical checks (`¿se entiende?`, `¿ok?`, `right?`, `does that make sense?`) return null; normalized body shorter than 12 returns null; speaker tag stripped; Recorded and Ended headers ignored; several questions returns the last; rhetorical word only part of the body returns the body; interrogative start without punctuation (English `what ...`, Spanish `por qué ...`); "Porque ..." returns null; null, empty, unchanged and no-stamp garbage return null.
- `LiveQuestionJevJudgeTests` (about 24): one request, POST to `/v1/systemone`, model `jev-latest`, two questions per new line, only new bodies in `new_lines`, `recent_transcript` contains the new line, API key not in the body, previous lines and headers excluded; high Noul returns the stripped body; Noul exactly 0.7 arms; low returns null; null or empty transcripts, unchanged text and header-only changes make no HTTP call; several new lines returns the last at or above threshold; a low last line falls back to an earlier armed line; a rhetorical line still sends Noul; a missing later answer does not arm; web Noul requested for each line in the same request; web threshold theory (0.9 true, 0.6 true, 0.59 false, 0.1 false); missing web answer is false; the web verdict comes from the armed line only; `JudgeNeedsWebAsync` high is true with exactly one request, low is false, missing is false, a blank question makes no HTTP call.

Not covered, and the port should add: everything in `LiveCopilotWindow` (no UI or window tests exist: drag, snap, flip crossfade, DPI, multi-monitor, panel anchoring, shape fallback, `SetVisibleAsync` races); the `AskLive` state machine (generation staleness, armed restore, typed versus armed priority, web decision, setup-cancel versus needs-setup message, empty answer); streaming flush cadence; the dismissed set; `TakeRecent` with mixed `\r\n` and `\n`; the `BuildSessionContext` surrogate cut; `AudioBarsControl` math; settings round trip for edge and along.

## 7. Bugs, races and uncovered cases

Confirmed (verified by reading the code):

1. Stale typed text shadows armed questions. `AskLive` never clears `LiveAskText` after an ask; only `AskPreset` and `ResetLiveAnswerSession` write it (`RecordingPageViewModel.cs:515`, `:789`). Because `question = typed.Length > 0 ? typed : armed.Trim()` (`:543-544`), after one typed question every later click on the detected-question "Answer" button re-asks the old typed text instead of the detected question until the user clears the box.
2. Confirming with typed text present discards the armed question. On the confirm path `ArmedQuestion` is cleared unconditionally (`:556-557`) even though the typed text was answered, and it is restored only on provider-setup failure (`:598-606`).
3. The armed question is lost on non-setup failures. An empty answer (`:621-626`) and thrown errors (`:635-641`) do not pass `restoreArmed`, so a confirmed detected question disappears and must be retyped.
4. `LiveQuestionDetector` is dead code in production; its only reference is a comment (`RecordingPageViewModel.cs:391`). It also lacks `por que` without the accent and the `cuánto` family (`LiveQuestionDetector.cs:385-389`, `:463`).
5. `ParseEdge` accepts numeric strings `"0"` to `"3"` and comma-separated names (`LiveCopilotPillDock.cs:318-321`), so a corrupt value can silently select an edge. Benign, but a stricter port changes behavior for hand-edited settings.
6. The monitor is not persisted. The first show always uses the primary display work area (`LiveCopilotWindow.xaml.cs:391-392`); after a restart a capsule last used on a secondary monitor reappears on the primary one.
7. The `Light` theme resource dictionary in the XAML is unreachable because the root forces `RequestedTheme="Dark"` (`LiveCopilotWindow.xaml:11`, `:20-23`); only the Dark and HighContrast colors apply.
8. Legacy settings fields `LiveCopilotPillX` and `LiveCopilotPillY` are kept but unread (`AppSettings.cs:160-167`); no migration from them to edge and along exists.

Suspected (plausible from the code, not reproduced):

9. The baseline stalls on judgment errors. `_questionJudgeBaseline` advances only on success or when judging is skipped (`:449-465`). During a TypeSafe outage the set of "new lines" grows with every update, so each retry sends more lines (two questions each), and a later success can arm only the last qualifying line.
10. Only the last qualifying new line is armed per judgment batch (`LiveQuestionJevJudge.cs:83-94`); an earlier question in the same batch is dropped and, because the baseline advances, never revisited.
11. The off-screen slide target can land on an adjacent monitor. `OffscreenRect` shifts by width plus margin only (`:666-677`), so with a monitor to the right of a Right-docked capsule it slides across that monitor.
12. Settings read-modify-write race. `SavePositionAsync` loads the whole settings object and saves it back (`:338-359`); a concurrent settings change between load and save can be overwritten.
13. `SetVisibleAsync` is fire-and-forget from `UpdateLiveCopilotPill` (`App.xaml.cs:399`), so exceptions in the async path are unobserved. `RestoreDockAsync` is cached after the first attempt, so a transient settings read failure leaves the default dock for the whole process (`:283`, `:324-336`).
14. If the main window's presenter is not an `OverlappedPresenter`, the handoff does not minimize (`App.xaml.cs:358-360`) but `handingOff` still shows the pill; nothing re-evaluates visibility afterwards, so the pill can stay visible over an active main window until the next activation change.
15. `CanUseWebSearch` is refreshed only on recording start and at ask time (`:1236`, `:576`); the toggle can show a stale state if the provider changes mid-recording. `ForceWebSearch` is not reset between recordings.
16. `TakeRecent` drops any unstamped line that begins with `Recorded ` or `Ended ` (the header test applies to every line), and its 2500-character fallback and the 1500-character session-context cut can split surrogate pairs (`LiveAnswerWindow.cs:148`, `:186-192`; `LiveAnswerWebPolicy.cs:94`).
17. Cross-platform newlines. `CommittedText` is joined with `Environment.NewLine` (`StreamingTranscriptAccumulator.cs:80`). New-line detection splits on any newline kind and compares whole lines, so it is safe, but the `TakeRecent` output newline depends on whether the input contained `\r\n`. A port should normalize to one newline kind.
18. Drag is blocked while a tween runs (`:918`), so a press during the 300 ms entrance or the 240 ms snap does nothing (buttons still work).
19. `ApplyShape` recreates the HRGN on every size change during a snap tween (`:646`), producing many short-lived GDI regions per second; each is replaced, so not a leak, but wasteful.
20. Privacy. When `TypeSafeEnabled` (default true) and a key exist, every committed transcript change sends up to 90 s of transcript to `api.typesafe.ai`. This is intended behavior but is not communicated in the pill UI.

## 8. Parity checklist

Visibility and lifecycle
1. Pill is created lazily on first need and reused; hiding does not destroy it.
2. Pill closes when the main window closes.
3. Show rule is `isRecording && (!mainWindowActive || handingOff)`; recording includes the paused state.
4. `mainWindowActive` starts true; any activation state other than Deactivated sets it true.
5. Pill visibility is re-evaluated on every main-window activation change and every `IsRecording` change.
6. Handoff fires only on the false-to-true recording transition, not on pause, resume, import, discard or stop.
7. Handoff dismisses the "meeting detected" popup.
8. Handoff minimizes the main window and then forces `mainWindowActive = false`.
9. Handoff shows the pill immediately without waiting for deactivation, then calls the started hint.
10. The main window is never auto-restored.
11. Stop or discard hides the pill and collapses an open panel.
12. Bringing the main window forward hides the pill without collapsing the panel; the panel state persists across hide and show.
13. `SetVisibleAsync` show and hide races are resolved by the latest requested visibility.
14. Showing while already visible and not exiting is a no-op.
15. Showing during an exit animation cancels the exit and re-enters from the docked rectangle.

Window behavior
16. Always on top.
17. No border and no title bar; native caption and thick-frame styles stripped and the frame refreshed.
18. DWM border suppressed; DWM rounding disabled when the custom shape is applied and enabled as the fallback.
19. Not resizable, not maximizable, not minimizable.
20. Hidden from the taskbar and Alt+Tab.
21. Shown without activation; keyboard focus stays in the previously focused app.
22. Clicking the pill activates it so typing works; no click-through anywhere.
23. Window shape is a capsule (radius half the short side) when collapsed and a 28 DIP rounded rectangle when expanded.
24. Shape uses the window pixel size verified against the client size, with the region right and bottom `+1`.
25. Shape falls back to DWM round corners when the region cannot be applied; stale regions are cleared on failure.
26. Exactly one outline when collapsed (1 stroke inset by 1 physical pixel); expanded adds a capsule surface border of 1.
27. Dark theme always; high-contrast colors honored for the stop button.
28. Window title is `LiveCopilot_Title`.

Sizes and layout
29. Capsule is 64 DIP on the short side, 240 DIP long when vertical, 272 DIP long when horizontal.
30. Pixel sizes use `round(dip * scale)` with a fresh DPI each time.
31. Edge margin is 16 DIP.
32. Panel is 380x500 DIP with an 8 DIP gap from the capsule.
33. Vertical layout on Left and Right edges; horizontal on Top and Bottom.
34. Capsule content order: logo tile, audio bars, elapsed time, pause, stop, chat; spacing 8 DIP.
35. Panel padding 12 DIP, row spacing 8 DIP, five rows as specified.

Docking math
36. Default dock is the right edge at along 0.5.
37. `NearestEdge` uses strict comparisons with tie order Right, Left, Bottom, Top.
38. `PositionFor` clamps along to 0..1 and maps NaN or infinity to 0.5.
39. `TravelRange = max(0, areaLen - capsuleLen - 2*margin)`; a capsule longer than the edge is pinned to the start.
40. `PositionFor` rounds the travel offset with banker's rounding (decide whether to replicate).
41. `AlongFor` returns 0.5 when there is no travel and clamps to 0..1 otherwise.
42. `ExpandedBounds` vertical: width = min(cap+gap+panel, area), height = min(max(cap, panel), area); horizontal is the analog.
43. `ExpandedBounds` centers on the capsule using truncating integer division (`Math.trunc` in JS).
44. `ExpandedBounds` result is clamped inside the work area.
45. `Clamp` pins an oversize window to the area origin.
46. `ParseEdge` is case-insensitive and falls back to Right for unknown values (decide the numeric-string behavior explicitly).
47. First placement uses the primary display work area; later placements use the display nearest the window.
48. On first placement the window is moved to the work-area origin before DPI is read.
49. DPI and work area are re-read on every `Dock()` and every snap.
50. Capsule host margin inside the window equals `(capsule - window) / scale`.
51. Panel position and size inside the window follow the per-edge formulas (Left and Top offset by capsule thickness plus gap).
52. The OS may refuse the requested size; the actual size is read back and used for the shape and the expected rectangle.
53. Re-dock when the system moves or resizes the window by more than 2 px from the expected rectangle, deferred once to the dispatcher and ignored during drag, press, tween or a queued re-dock.

Show and hide animation
54. Entrance: start from the off-screen rectangle, 300 ms ease-out quint, opacity follows eased progress.
55. Exit: 160 ms ease-in cubic, opacity `1 - eased`, then hide, reset opacities, move back to the docked position.
56. The off-screen rectangle shifts the docked rectangle past its edge by its own thickness plus the margin.
57. With animations disabled in the OS, show and hide are immediate and no pulse or panel animation plays.
58. Tween timer is 16 ms; rectangle lerp is rounded per component; size changes reapply the shape.
59. Audio bars start on show and stop on hide.
60. The position is saved (awaited) before the exit animation starts.

Started hint
61. The hint is requested on the recording start handoff only.
62. If the pill is not yet visible or is entering, the hint waits for the entrance to finish.
63. The pulse scales the capsule content 1 to 1.08 and back in 2 x 180 ms with sine ease-in-out.
64. Tooltip text `LiveCopilot_StartedMessage` opens on the logo tile for 2500 ms, placed away from the docked edge.
65. The hint is cancelled on hide, on drag start and on window close.
66. The hint tooltip is separate from the logo button's own "Open Vozella" tooltip.

Drag and snap
67. A left-button press on the capsule (not on the logo tile) captures the pointer.
68. Presses are ignored while a tween runs.
69. Drag starts after the cursor moves 4 DIP (Euclidean, in physical px) from the press point, using global cursor coordinates.
70. Starting a drag closes the hint and instantly collapses an open panel.
71. While dragging, the window follows the cursor delta from the origin captured at drag start.
72. Release or capture loss ends the drag; a press without a drag does nothing.
73. A drop snaps to the nearest edge based on the window center and the nearest display work area.
74. The new `along` is computed from the center using the new orientation size.
75. Snap tween is 240 ms: ease-out cubic without a flip, ease-in-out cubic with a flip.
76. On a flip the orientation switches at eased progress >= 0.5 and host opacity is `|2*eased - 1|`.
77. After the snap completes: opacity 1, instant `Dock()`, debounced save (500 ms).

Chat panel
78. The chat button toggles the panel; its name and tooltip switch between the Expand and Collapse strings.
79. Opening grows the window from the capsule toward the screen center, keeping the capsule position.
80. Opening animates panel opacity 0 to 1 and a 16 DIP slide from the docked edge over 220 ms with cubic ease-out.
81. Closing is instant when initiated by a drag or by `collapse`.
82. The panel closes on stop or discard.
83. The header shows `LiveCopilot_Title` and an "Open Vozella" button.
84. The logo button and the header button both restore the main window if minimized and activate it.

Question card and answer
85. The detected-question card is visible only while a question is armed.
86. The card shows the info bar (title plus body), an accent Answer button and a Dismiss button.
87. The armed badge `?` shows on the logo tile only while armed and is not hit-testable.
88. The Answer button tooltip is `RecordPage_LiveAnswerTooltip`; Ctrl+Enter is scoped to it.
89. Text box Ctrl+Enter is scoped to the box; neither accelerator is global.
90. The answer area shows the error bar, progress ring, web badge, markdown text and empty hint with the stated visibility rules.
91. The empty hint shows only when there is no answer, not answering and no error.
92. The progress ring is active only while answering.
93. The web badge shows only if the last answer used the web.
94. Markdown links open only for absolute http or https; other schemes and failures are ignored.
95. Two preset chips with localized labels and prompts.
96. The web toggle is enabled only when the provider supports web; its tooltip changes accordingly.
97. The send button is disabled unless recording with non-blank typed text.
98. The Answer button is disabled unless recording and (typed non-blank or armed).
99. Dismiss adds the body to the dismissed set and clears the armed question and its web verdict.

Asking logic
100. Typed text takes priority over the armed question for the question text.
101. Typed-only commands (send, presets) ignore the armed question and do not clear it.
102. The confirm path clears the armed question immediately and restores it only on provider-setup failure.
103. Starting an ask supersedes any previous ask by generation and cancellation.
104. UI updates from a stale generation are dropped.
105. Stop, discard and a new recording cancel in-flight answers and judgments.
106. A new recording resets armed question, dismissed set, baseline, snapshots, typed text, answer, error and the web-used flag, and refreshes web capability; `ForceWebSearch` persists.
107. Web decision is `supportsWeb && (forced || judged)`; Jev is consulted only when supported and not forced.
108. Armed questions use the stored web verdict; typed questions get a fresh Jev web judgment; any failure, disabled TypeSafe or missing key means no web.
109. The provider setup gate (model download, CLI availability, xAI sign-in) runs through host resolvers; unresolved yields `Status_SetupCancelled` or `LiveCopilot_NeedsSetup`.
110. An empty or whitespace answer shows `RecordPage_LiveAnswerEmpty`.
111. Other failures show a localized CLI failure message or the exception message.
112. Streaming shows nothing until non-whitespace text arrives, publishes the first chunk at once, then at most every 80 ms with leading whitespace trimmed.
113. The final answer is trimmed and flagged with whether the web was used.
114. Cancellations are silent.

Prompt
115. The prompt text is reproduced verbatim including line breaks.
116. Language is English only for `en` (case-insensitive, trimmed); everything else is Spanish.
117. The session context block appears only when non-blank and is trimmed.
118. The web line appears only when `webSearch` is true; otherwise no "web" word appears.
119. Session context is `Meeting: {title}\n{brief}` with either part optional, null when both are blank, capped at 1500 and right-trimmed.
120. Provider web support is limited to Claude Code and Codex.

Transcript window
121. Default window is 90 s; fallback is 2500 characters when no stamps parse.
122. Stamp grammar is `[mm:ss.ff-mm:ss.ff]` with at least 2-digit minutes, 2-digit seconds <= 59 and 2-digit hundredths.
123. `latest` is the maximum end time; the span is inclusive on both ends.
124. Headers (`Recorded `, `Ended `) are always dropped from the window.
125. Unstamped lines are kept only between the first and last in-span lines.
126. Output newline is `\r\n` if the input had any `\r\n`, else `\n`; line splitting accepts `\r\n`, `\n` and `\r`.
127. Body extraction strips the stamp and a ` [ Speaker-N ]` tag.

Question detection (Jev)
128. Judgment runs off the UI thread on every committed-text change, one in flight (a new one cancels the old).
129. TypeSafe disabled or a missing key advances the baseline without judging.
130. New lines are determined by whole-line set difference against the baseline, excluding headers and blank bodies.
131. One request carries two noul questions per new line with ids `line_{i}` and `web_{i}`.
132. Arm threshold 0.7 inclusive; web threshold 0.6 inclusive; missing or non-noul answers never arm and never request web.
133. The last armed line wins and carries its own web verdict.
134. Request body shape, model `jev-latest`, endpoint, headers and retry policy as in section 3.6.
135. Question, true and false texts are reproduced verbatim.
136. Failures never surface in the UI and never stop the recording.
137. Dismissed bodies are never re-armed in the same recording; the baseline advances only on success or skip.
138. A result is dropped if the generation is stale or recording ended.
139. A new armed question replaces any existing one.

Audio bars and meter
140. Five bars, 3 DIP wide, 3 DIP gap, 24 DIP max height, resting dot 3 DIP.
141. Profile, phase step and phase speed arrays as specified.
142. Attack 0.55 and decay 0.14 at 33 ms ticks when running with animations on; direct snap otherwise.
143. Paused forces level fraction 0.
144. The meter maps amplitude with the -60 dBFS floor and 1e-6 minimum amplitude to 0..100.
145. Elapsed text is `mm:ss` with unbounded minutes, updated each second, with a status tooltip (`REC` or `Paused`).

Persistence
146. Edge and along are stored as `liveCopilotPillEdge` and `liveCopilotPillAlong` in the settings JSON.
147. Loaded once per process on first show; failure keeps the defaults.
148. Saved 500 ms after each snap and immediately on hide; the write is skipped if unchanged within 0.0005.
149. Save errors are swallowed.
150. Legacy X and Y fields are tolerated on load and unused.

Accessibility and localization
151. All AutomationIds in sections 2.6 and 2.8 are preserved (or mapped to equivalent test ids).
152. Accessible names exist for pause and resume, stop, expand and collapse, open-app, armed badge, web toggle, send, ask box and chips.
153. All strings in section 2.8 exist in en-us and es with identical keys.

Cross-module dependencies and optional items
154. `LiveCopilotPillPlacement.Clamp` is reused by the meeting-detected popup placement.
155. Optional (not wired in the app): port `LiveQuestionDetector` only if a local fallback is wanted; if ported, carry over its tests.
