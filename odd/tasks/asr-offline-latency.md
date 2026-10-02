# ASR offline latency

## Objective

Run the post-Stop Nemotron pass with the highest-accuracy streaming latency (1.12 s right context) while live stays at 320 ms.

## Problem / why

`NemoSpeechNativeLibrary.CreateRecognizer` hardcodes `RnntRightContext = 3` (320 ms) for every recognizer.
The offline WAV pass (`TranscriptionService`) has no realtime constraint, yet it uses the same 320 ms as live.
NVIDIA model card (https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), Spanish with LangID:
80 ms 4.87, 160 ms 4.64, 320 ms 4.39, 560 ms 4.26, 1.12 s 4.11 WER. Supported att_context_size right frames: 0, 1, 3, 6, 13 (80 ms frames).

## Scope

- Make the streaming right context a parameter of recognizer creation, with an explicit latency profile (live = 3, offline = 13).
- Live (`LiveTranscriptionService`) keeps 320 ms. Offline (`TranscriptionService`) uses 1.12 s.
- Keep `ChunkSize`, CTC padding, and the diarization geometry unchanged.

## Out of scope

- A user-facing latency setting.
- Dropped-frame metrics (#3), locale (#4).

## Constraints

- Native C ABI change goes through `dotnet-pinvoke`; struct layout unchanged (only field values).
- Never call `FinishAndDrain`.
- Strict TDD: RED observed before implementation.

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Core: latency profile plumbed factory → engine → native config; offline = 13, live = 3; tests. Route: delegated (sonnet writer; native + 4+ files).

## Acceptance criteria

- Offline recognizer is created with right context 13; live with 3 (asserted through test fakes).
- Only the five model-supported right-context values can be expressed.
- Existing tests stay green; App x64 build succeeds.
- Manual (user): a post-Stop transcription completes without a native crash.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Work-unit commit straight to main, Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01.
- T1 done (354092d): `AsrLatencyProfile` enum (Live=3, Offline=13 frames) threaded factory -> engine -> native config; `TranscriptionService` uses Offline, live keeps Live. RED: test project failed to compile (type missing); GREEN: 657 passed, 0 failed; App x64 build 0 errors.

## Next step

Manual check by the user: a post-Stop transcription completes without a native crash.
