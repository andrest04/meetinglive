# ASR live dropped frames

## Objective

Measure how much audio the live Nemotron stream drops under realtime pressure and show it next to the ASR backend status in Settings.

## Problem / why

`LiveTranscriptionService` queues PCM frames in a bounded channel (`MaxQueuedFrames = 8`, `BoundedChannelFullMode.DropOldest`). When ASR falls behind (typically on CPU), frames are dropped silently. The offline pass recovers the text afterwards, but nobody can tell whether live dropped 0% or 30%, which hides a slow backend.

Note: skipping the offline pass when nothing dropped was considered and rejected — since asr-offline-latency the offline pass runs at 1.12 s right context and is more accurate than live (Spanish WER 4.11 vs 4.39).

## Scope

- Core: count frames written vs dropped per live session (samples or duration), exposed as a session summary (dropped duration, total duration, percent) on Stop, and published to the existing backend status source (`IAsrBackendStatus`, from asr-backend-visibility) or a sibling status.
- App: Settings ASR section shows the last live session's dropped percentage; a Warning when it exceeds a threshold (5%).
- Strings en-us + es.

## Out of scope

- Changing queue size or the drop policy. Skipping the offline pass.

## Constraints

- `OnPcmFrame` must stay non-blocking (capture pump writes the WAV on that thread). Counting must be lock-free/cheap (Interlocked).
- `BoundedChannelOptions` DropOldest does not report drops by itself; use the channel's `itemDropped` callback overload (`Channel.CreateBounded<T>(options, Action<T> itemDropped)`) if available in the target framework, otherwise detect drops explicitly. Verify, don't assume.
- C# 12 classic `[ObservableProperty]`. Strings via resw. Never call `FinishAndDrain`.
- Strict TDD.

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Core: dropped-frame counting + session summary published to status; tests. Route: delegated (sonnet writer).
- [x] T2 App: Settings shows last live session dropped %, warning above 5%; resw en+es. Route: delegated (same writer).

## Acceptance criteria

- A session with no drops reports 0%. A forced-drop test (slow fake stream) reports a non-zero dropped duration matching the dropped frames.
- Status updates at live Stop; Settings reflects it on the UI thread.
- Above 5% shows a Warning; below shows a plain caption; before any session shows nothing.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Work-unit commits straight to main, Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01.
- T1 done (7ff44f7): `LiveDropSummary` + `IAsrBackendStatus.LastLiveDrops`/`LiveDropsChanged`/`ReportLiveDrops`; drops counted via `Channel.CreateBounded(options, itemDropped)` (Interlocked ticks). 4 new tests; Core tests 762 passed, 0 failed.
- T2 done (cfb1df2): Settings caption + Warning InfoBar above 5% in `TranscriptionEngineSectionViewModel`/`SettingsPage.xaml`; resw en-us + es. App build x64: 0 errors.

## Next step

Push is the user's call.
