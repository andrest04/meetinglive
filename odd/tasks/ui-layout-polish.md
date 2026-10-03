# UI layout polish

## Objective
Make the Record, Summary, and Library pages use the window well: reachable content, readable widths, and less chrome.

## Problem
- Record: the idle column was clipped on short windows (no scroll) and capped at 720 px.
- Summary: four rows of controls left the summary about a third of the window.
- Library: list snippets leak summary headings ("What this was") and raw transcript stamps; rows repeat the date, the overflow button is loud, and the folder pane shows a stray background strip.

## Scope
- XAML layout and presentation in `RecordingPage`, `SummaryPage`, `HistoryPage`.
- `MeetingSnippet` text cleanup (Core) with tests.
- New/removed strings in both `Resources.resw` files.

## Constraints
- C#12 classic `[ObservableProperty]`; no behavior changes to commands.
- Build per csproj with `-p:Platform=x64`; tests via `MeetingLive.Core.Tests`.

## Tasks
- [x] T1 Record page scroll + Summary single toolbar and reading width — route: inline (2 XAML files, mechanical). Checks: app build 0 errors, launched.
- [x] T2 `MeetingSnippet`: skip heading lines when body text exists; transcript fallback drops `Recorded`/`Ended` headers, stamps, and speaker tags — route: inline (1 file + tests). Checks: RED/GREEN `MeetingSnippetTests`.
- [x] T3 Library visual polish (row hierarchy, subtle overflow, date on the right, pane background, New folder icon) — route: inline (1 XAML + strings). Checks: app build, launch.

## Acceptance criteria
- Library snippets start with summary body text, never with a heading or a `[mm:ss.ff-…]` stamp.
- Library rows show title, snippet, and one date; overflow button is subtle.

## Progress
- T1 1165c2a. T2 f136bb8: RED 4 failing, GREEN 802 tests (one unrelated flaky timeout in CliProcessRunnerTests under full-suite load; passes alone, also on base). T3: app build 0 errors, screenshot verified Library rows, pane, and alignment. Review consent declined for T1 candidate by the user.

## Next step
Done. Optional: merge Transcript/Summary tabs on the meeting page (product decision).
