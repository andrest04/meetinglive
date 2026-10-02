# Recording crash safety

## Objective

A recording survives an abrupt app exit (crash, force-kill, power loss): the WAV stays readable and at most a few seconds of audio are lost.

## Problem / why

`AudioCaptureService` writes the meeting WAV with NAudio `WaveFileWriter`, which writes the RIFF and `data` chunk sizes only on Dispose. If the process dies mid-recording the header keeps RIFF size 0 and data size 0. Observed 2026-10-01: the 22:36 and 22:47 recordings have RIFF/data size 0 (the app was force-killed during restarts while recording). NAudio `AudioFileReader` then throws "No fmt chunk found", so the offline Nemotron pass (`TranscriptionService`) and any re-read fail, and the audio looks lost although the PCM bytes are on disk.

## Scope

- T1 Prevent: during recording, periodically make the on-disk header valid (e.g. `WaveFileWriter.Flush()` every ~5 s from the capture pump, if NAudio's Flush updates the header — verify in the NAudio 2.2.1 source/assembly; otherwise patch the size fields explicitly with the stream position). Must not block or stall the pump's realtime pacing; must not corrupt the file if it races with Stop/Dispose. Pause/Resume keeps working.
- T2 Recover: a Core `WavHeaderRepair` that detects a canonical PCM WAV whose RIFF/data sizes are 0 or inconsistent with the file length, and rewrites only those size fields from the real length (data size = file length − data offset, rounded down to a whole block-align frame). Called before every WAV read that matters (offline `TranscriptionService` pass, audio import if it reads app WAVs, playback/reload if any). Writes only when broken; never touches a valid file; never truncates audio.

## Out of scope

- Re-transcribing existing broken meetings automatically (see Next step).
- Non-PCM or non-canonical WAV layouts beyond what the app itself writes (16 kHz mono PCM via NAudio): detect and skip them safely.

## Constraints

- Capture pump is realtime-paced (see AGENTS.md AudioCaptureService note); no blocking I/O storms; keep flush cheap and infrequent.
- Repair modifies a user file in place: verify `RIFF`/`WAVE`/`fmt `/`data` chunk structure first, only patch the two size fields, flush and close. Unit-test with temp files.
- Strict TDD.

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Prevent: periodic header update during recording; tests. Route: delegated (sonnet writer). Commit b9f2b83.
- [x] T2 Recover: WavHeaderRepair + call sites; tests. Route: delegated (same writer). Commit 585159a.

## Acceptance criteria

- A WAV being recorded is readable by `AudioFileReader` at any moment after the first flush interval (test: write frames through the same writer path, do not dispose, open a copy → readable, duration ≈ written).
- A WAV with RIFF/data = 0 and N bytes of PCM is repaired to the right sizes and reads back N bytes; a valid WAV is left byte-identical; a non-WAV or truncated header is left untouched and reported.
- Offline pass on a broken WAV succeeds after repair.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Work-unit commits straight to main, Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01.
- T1 done (b9f2b83): NAudio 2.2.1 `WaveFileWriter.Flush()` = save position, `UpdateHeader`, restore position (verified in IL). Pump flushes every ~5 s of written audio (`WavHeaderFlushCadence`). 9 tests.
- T2 done (585159a): `WavHeaderRepair` + call in `TranscriptionService.TranscribeWav`; 14 tests (13 repair + 1 service). Copies of the 22:36 and 22:47 recordings repaired and read back (17.6 s and 15:06). Full suite 789 passed; App x64 build 0 errors.
- Only other `AudioFileReader` caller is `WavFileDuration` on a freshly imported WAV (valid), so no call added. No re-transcribe feature exists in the app.
## Next step

T1, then T2. Afterwards: decide whether the 22:36 / 22:47 meetings should be re-transcribed from their repaired WAVs (needs a way to re-run the offline pass on an existing meeting — check whether the app already has one).
