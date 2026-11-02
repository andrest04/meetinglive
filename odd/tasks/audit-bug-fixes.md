# Audit bug fixes

## Objective
Fix the 20 remaining confirmed findings from the Sonnet bug audit (workflow run `wf_c9b42c79-018`), so recordings are not lost, duplicated, or stuck, and failures are reported honestly.

## Problem and rationale
The audit confirmed 21 defects by reading code. The high finding (stale notes overwrite) is fixed in `8f31586`. Several medium findings share one root: no clear state ownership across record, stop, and process. Fix that root as one unit instead of patching each symptom.

## Scope and constraints
- Authorized scope: only the findings listed below, with their tests and resource strings. No unrelated cleanup, dependency changes, or areas the audit did not cover.
- Findings source: `result.confirmed` in `C:\Users\andres\AppData\Local\Temp\claude\C--Code-meetinglive\f8861502-1911-4fee-98c7-d104be6bc70b\tasks\w8m27or3w.output`. Findings were not reproduced at runtime; re-check each against the code before fixing.
- Branch: `fix/audit-bug-fixes`, based on `fix/summary-notes-overwrite`, in a worktree. The main checkout holds uncommitted pill work and must stay untouched.
- Keep C# 12 and private-field `[ObservableProperty]`. New UI strings go in both `Strings/en-us/Resources.resw` and `Strings/es/Resources.resw`.
- Receipt-driven development: off, decided by global preference; no native review lifecycle.
- Delivery strategy: ask-on-risk. Forecast: 800-1200 authored changed lines, above the budget. The user asked to finish without stopping, and no pull request is created here, so the chain choice is deferred to delivery. Each task stays one or more separable work-unit commits. Push, pull request, and merge remain user decisions.
- Engram mirror: topic `odd/audit-bug-fixes/tasks`.

## Product defaults chosen
- Closing during a recording asks for confirmation: stop and save, or keep recording. No option discards the take.
- A lost microphone or loopback source warns the user and the recording continues with the remaining source.
- A failed transcription still saves a meeting that keeps its audio and can be retranscribed, and the status shows the real cause.
- Local summaries over the model context are chunked and merged, never silently truncated.

## Tasks

### T1 Recording pipeline ownership (route: delegated; multiple non-trivial files)
All seven findings were real when re-read against the code. Boxes below mean built and unit-checked where Core logic exists; no scenario was run in the app.
- [x] F7 Swallowed transcription failure drops the recording (`RecordingPipelineOrchestrator.cs:77`). A take is saved with its audio before the offline pass, a re-run over the same audio skips that save, and the status carries the real cause. `cbce619`.
- [x] F8 In-flight summary overwrites the next recording's notes, title, and calendar link (`RecordingPageViewModel.cs:1579`). Each `PipelineRun` holds its request and notes, and touches the page only while it owns the session. `cbce619`.
- [x] F9 Persistence error leaves the app stuck in Processing (`RecordingPageViewModel.cs:1284`). Saves in the orchestrator's catch blocks are guarded, and every run has a terminal step queued behind its callbacks. `cbce619`.
- [x] F10 `StopRecordingAsync` can run twice (`RecordingPageViewModel.cs:1823`). Stop and Discard pass through `RecordingSessionGate`; a second caller waits for the stop already running. `cbce619`.
- [x] F11 Deleting a meeting during its pipeline crashes or resurrects it (`HistoryPageViewModel.cs:212`). A busy meeting is refused with a message, and a failed delete no longer crashes (`a90533c`). The repository now deletes audio before Markdown, so a locked WAV leaves the meeting intact and the delete can be retried (`e176f3c`).
- [x] F6 Closing the app during a recording abandons it (`App.xaml.cs:115`). Window close is fixed in `4592e39`. "Restart now" passes the same gate in `a8075e8`.
- [x] L10 Import stays enabled while a recording starts (`RecordingPageViewModel.cs:1360`). Start and Import share the gate's Preparing phase. `cbce619`.

T1 evidence:
- Route: delegated direct, one writer. Trigger: several non-trivial files.
- RED then GREEN for `RecordingSessionGate` and `RecordingPipelineRules`: 21 of 30 new tests failed against stubs, then all 30 passed.
- App exception: `RecordingPipelineOrchestrator`, the view models, `HistoryPage`, and `App` cannot be hosted by the test project, so they rely on the build and the runtime scenarios below.
- RED then GREEN for the locked WAV delete: with `FileShare.None` on the WAV, the Markdown was gone before the fix (`Assert.True` failed) and stays after it. Existing missing-WAV and already-gone tests still pass. `HistoryPageViewModel.DeleteAsync` is the only caller of the repository delete, and it already catches the `IOException`.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`: Passed 987, Failed 0, Skipped 0.
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`: succeeded, 0 errors, 196 warnings. Run at the tip only, not per commit.
- `git diff --check`: clean.

T1 decisions:
- The background summary stays: processing still hands off when summarization starts, so Record is available during a summary. Keeping `IsProcessing` true until the end was the audit's alternative.
- Notes stay live until hand-off, then freeze. Freezing them at Stop would lose notes typed during transcription, because the notes box stays editable while processing.
- Closing waits for every take's first save, then cancels unfinished transcription and summary and allows them up to 30 seconds to wind down. A long pipeline would otherwise hold the app open for minutes. The dialog says unfinished work can be re-run from the meeting.
- Closing while only processing or a background summary runs shows progress with no prompt, because no audio is being captured.
- `OnSavedWithoutTranscript` is a default interface method, so `MeetingRetranscriptionRunner` keeps its behavior without an edit.
- Replacing the old `LastMeeting` check also lets a second recording in one app session appear on the Record page. The old check dropped its saves.

- "Restart now" reuses the close confirmation. Choosing Keep recording cancels the restart, and the new language applies on the next launch.

T1 known gaps:
- A meeting with two distinct audio files (its recorded path and a sibling WAV) can lose the first if the second is locked. The Markdown survives and the delete can be retried.
- A closed process during Preparing can leave a partial import or a zero-length WAV. No meeting exists yet at that point.

T1 runtime scenarios, all pending:
- [ ] Close while recording, including minimized to the pill: Stop and save produces a meeting and the app closes.
- [ ] Close while recording, then Keep recording: capture continues without a gap.
- [ ] Close while another dialog is open: the app stays open and nothing is lost.
- [ ] Make transcription fail with live transcription off: the meeting is saved with audio, the status shows the cause, and Retranscribe works.
- [ ] Start a second recording during the first one's summary: the first keeps its notes, the second keeps its title and calendar link.
- [ ] Lose the output device mid-recording and press Stop at once: one meeting, processed once.
- [ ] Delete a meeting during transcription: refused with the message, and it works once processing ends.
- [ ] Change the language while recording, then Restart now: the close confirmation appears, Stop and save produces a meeting and restarts, and Keep recording cancels the restart.
- [ ] Import stays disabled during the model load, and Record stays disabled during an import.

### T2 Audio capture (route: delegated; depends on T1 for UI wiring)
All four findings were real when re-read against the code. Boxes below mean unit-checked against fake devices, with a real pump and a real WAV file; no scenario was run in the app or on a real device.
- [x] F2 Faulted pump leaves `StopAsync` throwing and `IsRecording` stuck (`AudioCaptureService.cs:136`). Every teardown step runs, the error still reaches the caller, and a header the disk refused is repaired. `CaptureFaulted` reports the fault while recording, and the page stops through `StopRecordingAsync`. `f4a41d4`.
- [x] F4 Dead microphone or loopback ignored mid-recording (`AudioCaptureService.cs:77`). `CaptureSourceLost` carries the source and how many are left. The page warns and recording continues, with a separate warning when none are left. `f4a41d4`.
- [x] L2 Concurrent `StopAsync` calls race (`AudioCaptureService.cs:123`). Stop is single flight, and later callers get the same task. `f4a41d4`.
- [x] L4 `MicrophoneLevelMeterService` leaks `WasapiCapture` on failed start (`MicrophoneLevelMeterService.cs:25`). A capture that fails to start is released. `9d4250c`.

T2 evidence:
- Route: delegated direct, one writer. Trigger: several non-trivial files.
- RED then GREEN: with seams and stubs only, 15 of 25 new tests failed. All 25 passed after the fix, and three repeated runs also passed. The 10 that passed in RED pin behavior that must not change, such as process-tree failures still stopping the recording.
- Removing the header repair makes `PumpFault_StopRethrowsCleansUpAndLeavesReadableAudio` fail, so that test does prove a readable WAV after a simulated full disk.
- App exception: the view model changes cannot be hosted by the test project, so they rely on the build and the runtime scenarios below.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`: Passed 1012, Failed 0, Skipped 0.
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`: succeeded, 0 errors, 196 warnings.
- `git diff --check`: clean.

T2 decisions:
- A process-tree failure still stops the recording, as it did. Only the microphone and system loopback warn and continue.
- With no source left, the recording keeps running and says so, and the user decides when to stop. It writes silence until then.
- A pump fault stops the take, because nothing more can reach the file.
- The failure reason now stays in the pipeline's status lines, for `Error_OutputCaptureFailed` too. The next status would otherwise replace it at once. Source warnings are worded for the present, so they show only while recording.
- `ShouldSurfaceOutputFailure` keeps its meaning and tests: whether a failure ends the recording. System loopback errors now go through `IsSourceLost`.
- The new events are default interface members, so the test fake in `LiveTranscriptionServiceTests` needs no edit.
- The new event types live in `IAudioCaptureService.cs`, because this task's edit surface had no room for new Core files.

T2 known gaps:
- Warnings show in the Record page status only. The edge-docked pill does not show them, so a user minimized to the pill sees nothing until they return. The pill was outside this task's surface.
- A warning covers a source that stops with an error. A source that goes silent with no error is not detected.
- Whether NAudio and Windows raise these errors on a real unplug, or survive it, cannot be proven here. Tests raise the event by hand.

T2 runtime scenarios, all pending:
- [ ] Unplug the microphone while recording: the warning appears, the app does not crash, the meeting audio keeps recording, and Stop produces a meeting.
- [ ] Disable or unplug the output device with system loopback: the warning appears and the microphone keeps recording.
- [ ] Lose both sources, or the only one: the "nothing is being captured" status appears, and Stop still saves what was recorded.
- [ ] Pause, lose a source, and resume: the warning comes back after resuming.
- [ ] Fill the disk during a recording, or record to a removable drive and pull it: the take stops, the reason stays visible, the WAV plays up to the failure, and a new recording can start.
- [ ] Open Settings with the microphone held in exclusive mode by another app: no crash, and the meter works once the device is free.

### T3 Transcription engine and local summary (route: delegated)
- [ ] F3 Deleting the engine with its DLL loaded half-deletes it (`NemoSpeechRuntimeManager.cs:71`).
- [ ] F5 Local summary has no chunking for its 4096-token context (`LocalLlmSummaryProvider.cs:36`).
- [ ] L1 `Lazy` caches a failed native load for the process (`NemoSpeechNativeLibrary.cs:72`).
- [ ] L3 Partial runtime copy is accepted as installed (`NemoSpeechRuntimeManager.cs:123`).

### T4 Data and integrations (route: delegated)
- [ ] L5 Section parser truncates content at a header-like line (`MeetingMarkdownFormatter.cs:259`).
- [ ] L6 CLI stdin write sits outside the timeout and misclassifies a broken pipe (`CliProcessRunner.cs:71`).
- [ ] L7 Any failed OAuth refresh reports "not signed in" (`XaiOAuthClient.cs:143`).
- [ ] L8 Sign-out during refresh saves credentials back (`XaiAuthSession.cs:61`).
- [ ] L9 Re-running a failed migration overwrites later edits (`MeetingsMigrationService.cs:38`).

## Acceptance and checks
- Each finding is fixed, or recorded here as not reproducible from the code with the reason.
- Core behavior changes follow RED then GREEN in `MeetingLive.Core.Tests`. App view models cannot be hosted by a test project, so App-only changes record that exception and rely on build and runtime checks.
- Tests: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.
- Build: `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`.
- `git diff --check` passes.
- Runtime scenarios that cannot run here are listed as pending, never claimed as passed.

## Progress
- Baseline branch created at `8f31586`.
- T1 implemented in `cbce619`, `a90533c`, `4592e39`, `e176f3c`, and `a8075e8`. Runtime scenarios are pending.
- T2 implemented in `9d4250c` and `f4a41d4`. Runtime scenarios are pending.

## Next step
T3.
