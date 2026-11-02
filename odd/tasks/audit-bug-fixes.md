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
- [x] F11 Deleting a meeting during its pipeline crashes or resurrects it (`HistoryPageViewModel.cs:212`). A busy meeting is refused with a message, and a failed delete no longer crashes. `a90533c`.
- [ ] F6 Closing the app during a recording abandons it (`App.xaml.cs:115`). Window close is fixed in `4592e39`. Reopened for one path: "Restart now" at `SettingsPage.xaml.cs:76` calls `AppInstance.Restart` with no guard, and that file is outside T1's authorized edit surface.
- [x] L10 Import stays enabled while a recording starts (`RecordingPageViewModel.cs:1360`). Start and Import share the gate's Preparing phase. `cbce619`.

T1 evidence:
- Route: delegated direct, one writer. Trigger: several non-trivial files.
- RED then GREEN for `RecordingSessionGate` and `RecordingPipelineRules`: 21 of 30 new tests failed against stubs, then all 30 passed.
- App exception: `RecordingPipelineOrchestrator`, the view models, `HistoryPage`, and `App` cannot be hosted by the test project, so they rely on the build and the runtime scenarios below.
- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`: Passed 986, Failed 0, Skipped 0.
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`: succeeded, 0 errors, 196 warnings. Run at the tip only, not per commit.
- `git diff --check`: clean.

T1 decisions:
- The background summary stays: processing still hands off when summarization starts, so Record is available during a summary. Keeping `IsProcessing` true until the end was the audit's alternative.
- Notes stay live until hand-off, then freeze. Freezing them at Stop would lose notes typed during transcription, because the notes box stays editable while processing.
- Closing waits for every take's first save, then cancels unfinished transcription and summary and allows them up to 30 seconds to wind down. A long pipeline would otherwise hold the app open for minutes. The dialog says unfinished work can be re-run from the meeting.
- Closing while only processing or a background summary runs shows progress with no prompt, because no audio is being captured.
- `OnSavedWithoutTranscript` is a default interface method, so `MeetingRetranscriptionRunner` keeps its behavior without an edit.
- Replacing the old `LastMeeting` check also lets a second recording in one app session appear on the Record page. The old check dropped its saves.

T1 known gaps:
- `MarkdownMeetingRepository.DeleteAsync` removes the Markdown before the WAV, so a WAV held by another program still leaves the meeting half-deleted. The app now reports it. The file is outside T1's edit surface.
- A closed process during Preparing can leave a partial import or a zero-length WAV. No meeting exists yet at that point.

T1 runtime scenarios, all pending:
- [ ] Close while recording, including minimized to the pill: Stop and save produces a meeting and the app closes.
- [ ] Close while recording, then Keep recording: capture continues without a gap.
- [ ] Close while another dialog is open: the app stays open and nothing is lost.
- [ ] Make transcription fail with live transcription off: the meeting is saved with audio, the status shows the cause, and Retranscribe works.
- [ ] Start a second recording during the first one's summary: the first keeps its notes, the second keeps its title and calendar link.
- [ ] Lose the output device mid-recording and press Stop at once: one meeting, processed once.
- [ ] Delete a meeting during transcription: refused with the message, and it works once processing ends.
- [ ] Import stays disabled during the model load, and Record stays disabled during an import.

### T2 Audio capture (route: delegated; depends on T1 for UI wiring)
- [ ] F2 Faulted pump leaves `StopAsync` throwing and `IsRecording` stuck (`AudioCaptureService.cs:136`).
- [ ] F4 Dead microphone or loopback ignored mid-recording (`AudioCaptureService.cs:77`).
- [ ] L2 Concurrent `StopAsync` calls race (`AudioCaptureService.cs:123`).
- [ ] L4 `MicrophoneLevelMeterService` leaks `WasapiCapture` on failed start (`MicrophoneLevelMeterService.cs:25`).

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
- T1 implemented in `cbce619`, `a90533c`, and `4592e39`. One open item: the language-restart path of F6. Runtime scenarios are pending.

## Next step
Decide on the F6 restart guard in `MeetingLive.App/SettingsPage.xaml.cs`, then T2.
