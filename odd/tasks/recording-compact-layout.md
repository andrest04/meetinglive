# Recording Page — Compact Recording Mode & Responsive Layout

## Objective

While a recording is in progress, make the live transcript the protagonist of RecordingPage: compact controls, no idle-home clutter, and a layout that adapts to window size instead of clipping.

## Problem / why

User report (2026-09-25, screenshot at ~1190x880): during recording the page still shows the full start screen (title, destination, 96px hero with record button, pause/discard row, timer, mic level bar, status text) and the transcript card is clipped by the "En vivo" chat bar below. Root cause verified in `RecordingPage.xaml`: row 0 is `Auto` and contains a `ScrollViewer`, which is measured with infinite height, so it never scrolls and always claims its full content height (~330px). The transcript lives in the `*` row with `MinHeight=160`, so it only gets leftovers; when the window is short the grid overflows and the bottom is clipped.

## Scope (in)

- T1 — RecordingPage.xaml(+.cs, +ViewModel bindings if needed): two states. Idle keeps today's start screen. While `IsRecording`, replace the header/hero block with one compact control bar (recording indicator + elapsed, thin mic level, Pause, Discard, Stop, Highlight, Copy), a read-only title/destination chip, and hide coming-up, brief, setup, import, status text. Transcript takes the whole remaining `*` row. Fix the `Auto` + `ScrollViewer` root cause.
- T2 — Live ask row ("Responder con" + "Preguntar") collapsed into one compact row docked under the transcript; answer card must not push the transcript. Responsive: `VisualStateManager` + `AdaptiveTrigger` (~900px) puts session notes beside the transcript when wide, stacked when narrow; control bar wraps instead of clipping.
- T3 — Verify: build clean, app launches.

## Scope (out)

- Idle/start screen redesign, MainPage chat composer, SummaryPage, Settings.
- New features or new strings beyond what compact layout strictly needs (reuse existing `x:Uid` resources; any new string goes in BOTH `Strings/en-us/Resources.resw` and `Strings/es/Resources.resw`).
- Visual screenshot verification by the agent (user launches and checks the app themselves; standing preference).

## Constraints

- C#12, classic `[ObservableProperty]` private-field syntax. No partial properties.
- Keep every existing `AutomationProperties.AutomationId`; keep keyboard accelerators (Ctrl+R, Ctrl+P, Ctrl+Shift+D, Ctrl+Enter).
- Theme-aware brushes only (`{ThemeResource ...}`), no color literals, no `Opacity` dimming for text. High Contrast must stay readable.
- `x:Bind` explicit `Mode=OneWay`; static function binds (`BoolToVisibility` etc.) over converters.
- Artifacts (code, comments, resource strings) in English; Spanish goes in the `es` resw only.
- No `dotnet build` on the `.sln`; build the `.csproj` with `-p:Platform=x64`.

## Route declaration

- T1, T2: delegated direct, one writer per task (2+ non-trivial files: XAML, code-behind, resw). Trigger: writer + preparation.
- T3: inline (build + launch, bounded actions).

## Delivery

Strategy `single-pr` semantics, but repo convention (memory: direct push, work-unit commits): commit per task straight on `main`, no PR. Forecast ~300–450 authored lines across T1+T2.

## Verification / TDD

Strict TDD is enabled project-wide. Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` (App project has no unit-test seam for WinUI layout). Changes are declarative XAML/visual-state; no RED/GREEN cycle applies. If a task adds testable C# logic, it moves to `MeetingLive.Core` with tests first. Functional checks: `dotnet build MeetingLive.App/MeetingLive.App.csproj -c Debug -p:Platform=x64` 0 errors, app launches via `winapp run`.

## Tasks

- [x] T1 — Compact recording control bar, chip header, transcript fills `*` row (root-cause fix) — 51c6b45
- [x] T2 — Compact live-ask row + adaptive two-column/stacked layout — 2712257
- [x] T3 — Build clean + relaunch app (0 errors, process alive and responding after 6s); user visual confirmation pending

## Acceptance criteria

- While recording at 1190x880 the transcript card is fully visible above the bottom chat bar, and takes the majority of the vertical space.
- Idle screen unchanged.
- At narrow width (< ~900px) nothing is clipped; controls wrap; notes stack under transcript.
- All AutomationIds and accelerators preserved; es + en strings in sync.

## Progress log

- 2026-09-25 — Doc created. Root cause verified from `RecordingPage.xaml` (Auto row + ScrollViewer).

- 2026-09-25 — T1 done (delegated writer, commit 51c6b45, +152/-74 in RecordingPage.xaml/.cs). Parent re-verified: `dotnet build` 0 errors; writer reported `dotnet test` 644 passed (baseline moved from 645 after the pulled commits deleted ActionItemVerdictDisplayTests). Route: delegated. Review assessment: not run (RDD off by default; no assess requested).
  - Notes for follow-up: `tk:WrapPanel` comes from the v7 `CommunityToolkit.WinUI.UI.Controls.Markdown` transitive dependency (Toolkit v8 controls namespace has no WrapPanel) — compiles, fragile if Markdown package is dropped. Duplicate AutomationIds/Ctrl+R accelerator exist in idle + recording subtrees (one always collapsed): user must confirm Ctrl+R toggles once while recording.

- 2026-09-25 — T2 done (delegated writer, commit 2712257, +258/-181 in RecordingPage.xaml/.cs). Parent re-verified: `dotnet test` 644 passed; build 0 errors via `winapp run`.
  - Deviation from the doc: AdaptiveTrigger breakpoint is 1100, not ~900. The trigger measures the window, not the page, and the nav pane takes 280px, so 900 would leave the transcript ~324px next to the notes column. One value to change in `RecordingPage.xaml` if 900 is preferred.
  - Provider ComboBox and question TextBox dropped `x:Uid` (its Header forced a second line); name/placeholder/tooltip now come from the same resw keys via static helpers. The "Ask" header is gone; placeholder and accessible name remain.
- 2026-09-25 — T3: app relaunched (PID 2236, responding). Not verified by the agent (no screenshots by standing preference): VSM row/column swaps, wide/narrow transition, short-height fit, Ctrl+R firing once while recording, duplicate AutomationIds.

## Delivery

Two work-unit commits on `main` (51c6b45, 2712257): +410/-255 authored lines combined (~665 changed, above the ~400 planning heuristic because the page's XAML was restructured, not code-golfed). Not pushed yet.

## Next step

User checks the recording screen visually: recording at ~1190x880 (transcript unclipped), narrow window (<1100 stacks), Ctrl+R toggles once. Then push.
