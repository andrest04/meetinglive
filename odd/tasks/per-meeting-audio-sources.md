# Per-meeting audio sources

## Objective

When starting a recording, choose the microphone for that meeting (none, the usual Settings device, or another) and where the other side's audio comes from (all system audio, or one app). Do not persist the per-meeting override into Settings.

## Problem

`AudioCaptureService.Start` always opens a microphone and `WasapiLoopbackCapture`, which mixes every app playing through the default render device. Settings can pick a microphone globally, but there is no "no microphone" option and no way to exclude other windows for one meeting.

## Why

A meeting should be recordable without a mic, with a different mic than Settings, or without capturing YouTube, notifications, and other apps.

## Scope

- Core capture request: optional microphone, system loopback or one process tree. Not both output sources at once.
- Process loopback via `ActivateAudioInterfaceAsync` and `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, include target process tree.
- Recording page controls, bound before record, hidden or disabled while recording.
- English and Spanish resource strings, matching the existing `es` register.
- Unit tests for the request rules and the activation-params layout. No live WASAPI test.

## Out of scope

- Persisting the per-meeting choice into `AppSettings.SelectedMicrophoneDeviceId`.
- True per-window or per-tab audio. Windows exposes process trees, not HWNDs. Browsers include every tab of that process.
- Silently falling back to system loopback if process activation fails.
- Changing Settings microphone persistence.

## Constraints

- C# 12. Classic `[ObservableProperty]` private fields. Do not use C# 13/14 partial properties.
- Build and test each csproj. Do not build or test `MeetingLive.sln` (`MSB4126`).
- Core TFM is `net10.0-windows10.0.19041.0`. NAudio 2.2.1 is already referenced.
- App targets x86, x64, and ARM64. P/Invoke must be correct on x86 (stdcall / CsWin32).
- Official sample facts, not a copied implementation: device path `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, activation type process loopback, mode include target process tree, `PROPVARIANT` `VT_BLOB` of `AUDIOCLIENT_ACTIVATION_PARAMS`, wait until `ActivateCompleted` before the blob is unpinned, then `IAudioClient.Initialize` shared mode with `AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`.
- Docs list minimum client build 20348; the sample targets Windows 10 2004. Do not refuse by OS build. If activation fails, throw a clear exception and leave the existing start-failure path to show it.
- `AUDCLNT_BUFFERFLAGS_SILENT` buffers must not be mixed as uninitialized bytes.
- Empty microphone id still means OS default. "None" is `CaptureMicrophone = false`, never an empty id.
- At least the output source is always on. Microphone may be off.
- Process scope with process id 0 is invalid.
- Do not also open system loopback when capturing a process.
- UI copy must say "this app", not "this window only", and mention that browsers include every tab.
- Exclude MeetingLive's own process from the app list.
- Preselect the Settings microphone. Preselect all-system audio. Choices apply only to this recording.
- If "one app" is selected and no app is chosen, do not start.
- Mic level preview follows the per-meeting microphone and stays off when microphone is none.
- Generated artifacts and comments in English. UI strings in `en-us` and `es` resource files. No hardcoded new UI strings.

## TDD

- Mode: off
- Source: Engram search for `sdd-init` / `strict_tdd` returned nothing. Do not invent strict RED/GREEN.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- Ordinary tests ship with the behavior they verify.

## Delivery

- Strategy: `ask-on-risk`. Chain strategy: `stacked-to-main` (user chose this before the first commit).
- Slice 1: `2ad05e4` plus `5f340db` (capture pipeline and the failure surface). About 1060 authored lines. Would need `size:exception` if opened as one PR; the process-loopback capture is one behavior and was not split further.
- Slice 2: `0e3ae15` (recording page pickers). About 619 authored lines. Same exception note.
- Forecast: about 700 authored lines across both tasks (process-loopback interop is the bulk). Not a reason to shrink tests or comments.

## Route

- T1: delegated writer. Trigger: 2+ non-trivial files, native interop, tests.
- T2: delegated writer. Trigger: XAML plus view-model plus resources.

## Tasks

- [x] T1 — Capture sources in the pipeline. Add `RecordingCaptureSources` and `AudioCaptureService.Start(path, sources)` while keeping `Start(path, microphoneDeviceId)` as mic-plus-system-loopback. Skip the microphone when asked. Capture either system loopback or one process tree. Process capture implements `IWaveIn` so the existing mixer, pause, and stop path can own it. Tests for validation and activation-params size/offsets (12 bytes: type at 0, process id at 4, mode at 8, include-tree mode 0). No hardware required.
- [x] T2 — Recording page source pickers. After the title/destination grid in the pre-recording stack: microphone combo (None plus enumerated devices, preselected from Settings) and output choice (all system audio, or one app). App list is visible windows grouped by process, excluding this app, refreshed when the list opens. Pass the choice into `Start`. Preview meter uses that microphone. Status text reflects the choice. Strings in `en-us` and `es`.

## Acceptance

- A recording can start with no microphone and still capture system or app audio.
- A recording can use a microphone other than the Settings choice without changing Settings.
- Choosing one app does not include other processes' audio, and a failed activation does not silently record the whole system.
- Existing Settings microphone selection still starts a mic-plus-system recording when the page is left on the defaults.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` passes for the new tests, and the app project builds with `-p:Platform=x64`.

## Checks

- T1 tests: passed. Parent re-ran `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~RecordingCapture"` — 7 passed, then 11 passed after the failure-surface tests.
- App build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` — 0 errors. Existing `MVVMTK0045` warnings only (C# 12 private-field `[ObservableProperty]`; do not migrate).
- Runtime UI harness: N/A. No `winapp` session was launched.
- RDD: receipt-driven development is on. Review of `2ad05e4` was granted, then stopped with `captured_artifacts_unverifiable` after the correction commit changed the candidate. Not approved. Reviews were not disabled.
- Engram mirror: pending. `mem_save` failed with multiple active runtime sessions. Do not invent a session id.

## Progress

Branch `feat/per-meeting-audio-sources`.

- `2ad05e4` feat(capture): record one app or skip the microphone
- `5f340db` fix(capture): surface process-loopback failures instead of silence
- `0e3ae15` feat(recording): choose mic and app audio per meeting

`CaptureMicrophone: false` is no microphone. Null device id with capture on is the OS default. `ProcessTree` does not also open system loopback. A failed activation does not fall back to system audio. If the chosen app's capture dies after start, the pump stops and the recording page shows `Error_OutputCaptureFailed`.

## Next step

Not pushed. Open stacked PRs only if the user asks. The capture slice review did not approve.
