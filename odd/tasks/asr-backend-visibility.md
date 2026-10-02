# ASR backend visibility

## Objective

Show the Nemotron backend that is really running (CUDA or CPU), and say why CUDA fell back to CPU.

## Problem / why

`NemoSpeechRecognizerFactory.Create` catches every CUDA create failure with an empty `catch` and silently uses CPU.
`TranscriptionEngineInstaller.AccelerationCaption` reports "GPU acceleration (CUDA)" when the CUDA runtime is on disk, not when it loaded.
A user with an NVIDIA GPU can run on CPU (slow live transcript, slow post-Stop pass) while the UI says GPU. This is the same failure class that made the old Whisper pass look slow.

## Scope

- Core: the factory records the backend it actually created and the CUDA failure reason (exception message) when it fell back.
- Core: a small observable source of truth (last used backend + fallback reason) that live and offline transcription both update.
- App: the acceleration caption shows the actual backend after a recognizer was created; a fallback shows a visible, non-blocking warning with the reason.

## Out of scope

- Latency tuning (#2), dropped-frame metrics (#3), language locale (#4).
- Retrying CUDA or changing the fallback policy.

## Constraints

- C# 12, classic `[ObservableProperty]` private-field syntax.
- UI strings in `Strings/en-us/Resources.resw` (+ `Strings/es/Resources.resw`), never hardcoded.
- Never call `FinishAndDrain`.
- Strict TDD: RED observed before implementation.

## TDD

- Mode: strict, enabled. Source: user global config ("Strict TDD Mode: enabled").
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Core: factory reports actual backend + CUDA fallback reason; shared backend status; tests. Route: delegated (sonnet writer; 4+ files to understand).
- [ ] T2 App: caption and fallback warning bound to the actual backend status; strings en+es. Route: delegated (sonnet writer; XAML + VM + resw).

## Acceptance criteria

- CUDA create failure → CPU recognizer is returned, status says Cpu with the failure reason.
- CUDA success → status says Cuda, no reason.
- No NVIDIA GPU → status says Cpu, no fallback reason (not a failure).
- UI never claims CUDA unless the last recognizer was created on CUDA (before any run it may say what will be tried).

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Work-unit commits straight to main (repo convention), Conventional Commits, no AI attribution.

## Progress

- Created 2026-10-01.
- T1 done: factory reports the actual backend + CUDA fallback reason to `IAsrBackendStatus` (`AppServices.AsrBackend`); 647 Core tests green.

## Next step

T2.
