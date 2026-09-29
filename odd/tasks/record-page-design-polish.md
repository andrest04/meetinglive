# Record Page — Full Design Polish

## Objective

Raise the visual and interaction quality of the main tab (RecordingPage) and its shell, guided by winui-design, design critique, accessibility review and UI Skills (baseline-ui, fixing-accessibility).

## Problem / why

User (2026-09-28): "mejores la app… sobre todo la pestaña principal". The app has few tabs (Record, History, Session, Settings), so depth on Record matters more than breadth. Recent work already decluttered it (audio sources card, compact recording bar); this pass targets hierarchy, spacing, typography, states and polish.

## Scope (in)

- T1 — Multi-lens critique of Record (idle, recording, processing/result), a11y/theming/responsive, and a light pass over History/Session/Settings/MainPage shell. Read-only.
- T2 — Synthesized, prioritized design plan (Record first).
- T3.. — Implementation tasks defined after T2 (one writer, work-unit commits on main).

## Scope (out)

- New features, ViewModel behavior changes, audio/transcription logic.
- Agent screenshots of the desktop app (standing preference: user launches and checks).

## Constraints

- C#12, classic `[ObservableProperty]`. Keep every AutomationId and accelerator.
- ThemeResource brushes only; no color literals; High Contrast readable.
- New strings in BOTH `Strings/en-us/Resources.resw` and `Strings/es/Resources.resw`.
- Build the `.csproj` with `-p:Platform=x64`, never the `.sln`.
- Artifacts in English. ~400 changed lines per task is a planning heuristic only.

## Route declaration

- T1, T2: delegated direct via Workflow (broad read-only research, ultracode opted in).
- U1–U4: sequential, one delegated writer per unit (the plan file is the spec; HTML entities in it are escaping artifacts) at a time (2+ non-trivial files).

## Skills to load before work

- `.agents/skills/winui-design/SKILL.md`, `.agents/skills/winui-dev-workflow/SKILL.md`, `.agents/skills/winui-code-review/SKILL.md`

## Verification / TDD

Strict TDD enabled; runner `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`. XAML-only changes have no RED/GREEN seam; checks are a clean `dotnet build MeetingLive.App/MeetingLive.App.csproj -c Debug -p:Platform=x64` and `winui-code-review` before each commit. Any new C# logic goes to Core with tests first.

## Tasks

- [x] T1 — Multi-lens critique (read-only, 4 lenses)
- [x] T2 — Prioritized design plan: `odd/tasks/record-page-design-polish.plan.md`
- [x] U1 — Session states and feedback (CardSurface style, processing bar, promoted result card)
- [x] U2 — Idle hero and form polish (SettingsCards, Expander, hero button, Coming up)
- [ ] U3 — Recording bar and transcript as protagonist
- [ ] U4 — Cross-page consistency (secondary)

## Progress log

- 2026-09-28 — Doc created after exploring RecordingPage.xaml (842 lines) and prior recording-compact-layout task.

- 2026-09-28 — Critique workflow done (5 agents). Engram mirror pending (mem_save failed: multiple active sessions). Starting U1.

- 2026-09-28 — U1 done, commit e8c7620. IsStatusError can fire while recording/processing, so the error InfoBar was kept in the session view (SessionErrorVisibility) and a second one added to the idle column.

- 2026-09-28 — U2 done, commit edf76c6. Audio sources are SettingsCards in an Expander (collapses when a transcript exists); AutomationIds stay on the inner ComboBox/RadioButtons. Setup panel lost its outer card, headline string shortened (also used by the setup dialog). Status glyphs skipped (no VM booleans).
