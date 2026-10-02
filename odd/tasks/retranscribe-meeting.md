# Re-transcribe a meeting

## Objective

Let the user re-run transcription for an existing meeting from its saved audio, so recordings whose pipeline failed (e.g. 2026-10-01 22:36 and 22:47, whose WAV headers were left open by a force-kill and are now repairable) get a transcript and summary.

## Problem / why

`TranscribeAsync` is only called from `RecordingPipelineOrchestrator` right after a recording or import. A meeting whose offline pass failed keeps its draft (or nothing) forever. `WavHeaderRepair` (recording-crash-safety) now makes those WAVs readable, but nothing re-processes them.

## Scope

- A "Re-transcribe" action on the meeting (session) view, available only when the meeting's audio file exists and no recording/transcription is running for it.
- Confirmation dialog first: it replaces the current transcript and regenerates the summary (summary edits are lost).
- Runs the same offline pipeline as after Stop: `WavHeaderRepair` (already inside `TranscriptionService`), Nemotron offline pass (Offline latency profile, endpointing, speaker labels per Settings), save transcript, then summary with the selected provider, reusing `RecordingPipelineOrchestrator` steps rather than duplicating them.
- Progress + cancel in the UI, errors shown as an InfoBar; transcript is saved before summary so a summary failure keeps the new transcript.
- Strings en-us + es.

## Out of scope

- Bulk re-transcribe, automatic re-transcribe on startup, choosing a different engine.

## Constraints

- Reuse orchestrator/pipeline code; no second copy of transcribe→save→summarize.
- AppSettings load-mutate-save if touched. C# 12 classic `[ObservableProperty]`. Strings via resw. Theme-aware, keyboard accessible.
- Strict TDD for Core/pipeline logic; UI verified by build + user.

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Re-transcribe pipeline entry + session UI action with confirm, progress, cancel, errors; tests. Route: delegated (sonnet writer). Commit: e38e232 `feat(session): re-transcribe a meeting from its saved audio`.

## Acceptance criteria

- Action hidden/disabled when the audio file is missing or the meeting is being recorded/processed.
- After confirm: transcript replaced by the offline pass result; summary regenerated; meeting saved; UI refreshes.
- Broken-header WAV (RIFF/data = 0) is repaired and transcribed.
- Summary failure keeps the new transcript and shows an error; cancel leaves the old transcript untouched.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Work-unit commit straight to main, Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01. Defaults chosen by orchestrator: confirm dialog, replace transcript, regenerate summary.

- T1 done 2026-10-01. Button in the SessionPage header (next to Copy/Open location), visible when the audio file exists, enabled when idle. Reuses `RecordingPipelineOrchestrator.RunAsync` via the app-lifetime `MeetingRetranscriptionRunner` (request has no live draft, so the old transcript stays until the offline pass succeeds). Core: `MeetingRetranscription` (eligibility + request mapping), `RecordingPipelineRequest` moved to Core. RED: 10 failed / 0 passed; GREEN: 799 passed (full suite); App build 0 errors.
- Known limits: orchestrator lives in App so cancel / summary-failure paths are inherited from `RunAsync`, not unit-tested in Core.Tests; paused duration and highlights are not persisted so the new transcript has no highlight markers; notes edited mid-run are overwritten by the snapshot taken at start. No Library context menu exists, so none added.

## Next step

T1, then restart the app for the user.
