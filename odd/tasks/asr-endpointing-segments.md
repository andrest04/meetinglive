# ASR endpointing segments

## Objective

Split the transcript into short timestamped lines with speaker labels instead of one growing block.

## Problem / why

`NemoSpeechNativeLibrary.CreateRecognizer` leaves `nemo_speech_asr_recognizer_config.endpointing` NULL, so native endpointing is off. NeMo-Speech docs (`share/doc/nemo-speech/docs/asr/configuration.md` 193-207): off by default, the server emits one final only when the stream is closed; the app never closes it (`FinishAndDrain` aborts CUDA), so no final ever arrives. Interim results never carry word timings or speaker tags (`api.md:82`, `asr/customization.md`). `StreamingTranscriptAccumulator.FormatWindows` takes the `Words.Count == 0` path → one line, no `[ Speaker-N ]`, no 30 s / pause / speaker splits.

Probe evidence (scratchpad asrprobe, 22:47 Chrome football WAV, CUDA RTX 3070, diarization on):
- Endpointing NULL: 728 results, 0 finals, all words=0 → single `[00:00.00-01:15.00]` line (matches user screenshot).
- `endpointing.enable=1`, `stop_history_eou_ms=800`: 8 finals in 52 s, all with words and `spk=1`. 500 ms: 9 finals. Offline profile + 800 ms: finals with words/tags.
- Per-request `StopHistoryEouMs` alone: no effect.

Header (`include/nemo_speech/asr.h` 103-108, 176): `nemo_speech_asr_endpointing_config` x64 = 16 bytes: `size` (size_t) @0, `enable` (bool, 1 byte) @8, `vad_based` (bool, 1 byte) @9, `stop_history_eou_ms` (int32) @12.

## Scope

- T1 Native/Core: allocate and pass the endpointing config (enable=1, vad_based=0, stop_history_eou_ms=800) for every recognizer (live and offline); free it. Accumulator safety net: when a result has no word timings and spans more than the window (30 s), split by elapsed time so neither interim nor committed text becomes a single huge line.

## Out of scope

- `stream_force_endpoint` periodic cap (cuts mid-word, empty finals). VAD-based endpointing (needs Silero model).
- Unfinalized WAV headers (separate issue, see Next step).

## Constraints

- `dotnet-pinvoke`: blittable explicit-layout struct, Marshal alloc/free in `finally`, match header layout exactly.
- Never call `FinishAndDrain`.
- Strict TDD for accumulator logic; native struct verified by `Marshal.SizeOf`/offset tests.

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Endpointing config + accumulator no-words time split; tests. Route: delegated (sonnet writer; native interop).

## Acceptance criteria

- Endpointing struct is 16 bytes with fields at 0/8/9/12; recognizer config points at it.
- A no-words result spanning 75 s yields multiple lines each ≤ 30 s (interim display and committed).
- Results with words keep current splitting (30 s / speaker / 500 ms pause) and speaker tags.
- Manual (user): a live recording shows multiple short lines; with speaker labels on, lines carry `[ Speaker-N ]`.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`
- Optional: re-run scratchpad probe `--mode public` against the new Core build.

## Delivery

Work-unit commit straight to main, Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01 after probe diagnosis.
- T1 done: commit 665fb68. Core tests 766 passed; App x64 build 0 errors. Probe `--mode public --diar --seconds 75`: 10 finals with words and `[ Speaker-1 ]`. Manual live check pending (user).

## Next step

T1. Separately: 22:36 and 22:47 WAVs have RIFF/data size 0 (likely the app was force-killed during restarts while recording); offline `AudioFileReader` throws "No fmt chunk found" on them.
