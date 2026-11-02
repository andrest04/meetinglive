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
- [ ] F7 Swallowed transcription failure drops the recording (`RecordingPipelineOrchestrator.cs:77`).
- [ ] F8 In-flight summary overwrites the next recording's notes, title, and calendar link (`RecordingPageViewModel.cs:1579`).
- [ ] F9 Persistence error leaves the app stuck in Processing (`RecordingPageViewModel.cs:1284`).
- [ ] F10 `StopRecordingAsync` can run twice (`RecordingPageViewModel.cs:1823`).
- [ ] F11 Deleting a meeting during its pipeline crashes or resurrects it (`HistoryPageViewModel.cs:212`).
- [ ] F6 Closing the app during a recording abandons it (`App.xaml.cs:115`).
- [ ] L10 Import stays enabled while a recording starts (`RecordingPageViewModel.cs:1360`).

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

## Next step
T1.
