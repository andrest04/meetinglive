# Ask this meeting (Jev)

## Objective

New session tab: the user asks a natural-language question; Jev points at transcript lines. It does not generate an answer paragraph.

## Problem

Action-item "Verified" captions are invisible when they all pass. Library has no semantic search. TypeSafe's semantic-find cookbook is the fit.

## Scope

In: Core line index + fan-out `where` Choice + `exists` Noul; two-pass when >255 lines; Ask tab UI; tests.
Out: Generating prose answers; calling Jev on every keystroke; changing the existing Recheck captions.

## Constraints

C#12 classic `[ObservableProperty]` fields. English `Resources.resw`. No secrets in logs. Requires saved TypeSafe API key. `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`. App x64 build.

## Acceptance

- Session tab **Ask** with TypeSafe icon
- Query box + Ask; InfoBar: answered / partially addressed / not in this meeting
- Ranked transcript lines with scores; no invented quotes
- Empty states: no transcript, no API key
- Long transcripts (>255 lines) still return hits via two-pass windows

## Tasks

- [x] T1 `TranscriptLineIndex` + `MeetingJevAsk` (one-pass and two-pass) + tests
- [x] T2 Workspace `TabAsk` + SessionPage SelectorBar + navigation
- [x] T3 `AskPage` + ViewModel + strings
- [x] T4 Core tests + App x64 build

## Progress

2026-09-21: Implemented. 435 tests passed. App x64 0 errors.

## Next

Smoke the Ask tab with a TypeSafe key.
