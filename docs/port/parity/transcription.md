# Parity ledger: transcription

Spec: `docs/port/specs/transcription.md`. Section 8 has 116 items; every one is below. This is the domain and integration half: the engine install, the ASR worker, the live and offline passes, the accumulator and text rules, re-transcription and the main-process channels. The user interface half (setup dialog, Settings section, live pane, Session page re-transcription) is built on those channels and described under User interface.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped` (reason given), `pending-real-validation` (what is needed). Three more mark work that belongs elsewhere and has its data ready: `open-ui` (the user interface half draws or wires it), `open-recording` (the recording module calls it) and `open-other` (the summary or local-inference module owns it).

## Where things are

| Concern                                                                 | Code                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Result and engine types, latency profiles, Sortformer geometry          | `packages/core/src/transcription/asr-types.ts`                                            |
| Pinned downloads (runtime v0.3.0, both GGUF files with SHA-256)         | `transcription/engine-catalog.ts`                                                         |
| Streaming accumulator (windows, speakers, pauses, interim)              | `transcription/accumulator.ts`                                                            |
| Stamp format, headers, `EnsureEndedHeader`                              | `transcription/stamp-format.ts`                                                           |
| Highlights, line index, committed-line parser, progress                 | `highlights.ts`, `line-index.ts`, `committed-line.ts`, `progress.ts`                      |
| Recognizer factory and backend choice, backend status and live drops    | `recognizer-factory.ts`, `backend-status.ts`                                              |
| Live service (bounded queue, drop accounting) and offline service       | `live-service.ts`, `offline-service.ts`                                                   |
| Engine installer (plan, stages, expected backend, delete)               | `engine-installer.ts`, `install-labels.ts`                                                |
| Re-transcription rules and runner, pipeline stage rule                  | `retranscription.ts`, `pipeline-rules.ts`                                                 |
| Polish prompt, chunking, output guard                                   | `polish.ts`                                                                               |
| Ports and the doubles used by tests                                     | `ports.ts`, `test-kit.ts`                                                                 |
| Runtime manager (marker, promote, probe, delete), model store           | `packages/platform/src/transcription/runtime-manager.ts`, `model-store.ts`                |
| Resumable, checksummed, stall-safe downloader                           | `packages/platform/src/settings/download-to-file.ts`                                      |
| Zip extraction, WAV frame reader, runtime composition                   | `platform/src/transcription/zip-extractor.ts`, `wav-frame-reader.ts`, `transcription-runtime.ts` |
| Fake speech engine for the fake native build                            | `packages/platform/src/fakes/fake-asr-engine.ts`                                          |
| Worker protocol and page channels                                       | `packages/contracts/src/workers.ts`, `transcription.ts`                                   |
| koffi binding of the C ABI                                              | `apps/desktop/src/workers/asr/nemo-library.ts`                                            |
| ASR worker (handle ownership), entry                                    | `workers/asr/asr-worker-core.ts`, `index.ts`                                              |
| Main-side host (the engine as core sees it)                             | `apps/desktop/src/main/workers/asr-worker-host.ts`, `in-process-asr-worker.ts`            |
| Controller (status, downloads, settings, live, offline, re-transcribe)  | `apps/desktop/src/main/transcription/transcription-controller.ts`                         |
| Handlers                                                                | `apps/desktop/src/main/ipc/transcription-handlers.ts`                                     |
| Real engine proofs                                                      | `main/transcription/real-engine.integration.test.ts`, `apps/desktop/e2e/transcription-real.spec.ts` |

## Decisions

1. **The engine is v0.3.0, pinned with checksums.** The runtime zips are `nemo-speech-0.3.0-windows-x86_64-{cpu,cuda}.zip`. Their SHA-256 values were computed from the files the spike downloaded and match the `digest` field that GitHub reports for the release assets (`4ed9740e...5b05` for CPU, `d0d32ae1...ed42` for CUDA). The Nemotron GGUF is pinned to Hugging Face commit `ea30d66d...` and its SHA-256 (`3fc991d3...70b1`) equals the LFS hash the model API reports for it. Sortformer keeps its commit and hash (`0679cfeb...998a`); the observed size is 147075776 bytes.
2. **koffi lives in the ASR worker only.** `core` sees `AsrEngine`, `AsrRecognizer` and `AsrStream`. The worker owns every native handle: a recognizer owns its streams, a stream closes before its recognizer is destroyed, each dispose runs once, and a library is loaded once per folder and never released. `stream_finish` and `recognize_f32` are not bound at all (B9).
3. **Text is `\n` inside the app.** The accumulator takes a `newline` option (default `\n`). Readers accept CRLF, LF and CR. If the library writer wants CRLF in meeting files for byte parity, it converts at the persistence boundary (spec 5.2).
4. **Times are integer milliseconds** and the recording time is `number | null` (null is the C# `default`). Stamps are formatted from milliseconds, hundredths truncated.
5. **No `ClockSkew` (B1).** Dropped from the accumulator, the live service and the offline pass, together with the unused `pausedDuration`. Stamps are elapsed WAV time, as before.
6. **Failures are values on the channels.** `ensureEngine`, `setSpeakerLabels`, `downloadSpeakerModel` and `deleteSpeakerModel` answer `{status:'failed', message}` with the raw message (spec 2.2); cancelling answers `cancelled`. Nothing leaks a stack.
7. **Speaker labels never claim what they cannot do (B7).** Turning them on without the model downloads it first; a failed or cancelled download leaves the setting off. Deleting the model turns the setting off. A recognizer that is asked for diarization without the file is created without it, as before, but the backend usage now says `diarization: 'model-missing'` so the page can show `Ui_SpeakerModelMissing`.
8. **Download behavior (B5, B17).** The downloader keeps its `.part` file after a transport failure and continues it with a `Range` request next time (a server that ignores the range starts again). A cancel, an HTTP error or a checksum mismatch removes it, so nothing that looks finished is ever at the final path. A stalled connection ends after 60 s. Two callers for the same file or backend share one transfer.
9. **The runtime zip is extracted with `System32\tar.exe`** (bsdtar, present on Windows 10 and 11), called by full path so Git's GNU `tar` cannot take its place.
10. **Re-transcription ends as `TranscriptOnly` until the summary module plugs in.** The controller runs the part of the pipeline this module owns: the offline pass, the `Ended` header, the old stars (B8) and the save. The saved transcript stays untouched until the pass has text. The summary regeneration needs the summary providers, which do not exist yet; `RetranscriptionPipeline` is the port the recording module replaces.
11. **Live frames come from the audio worker.** `startLive` subscribes to the `recording-frame` pushes (PCM16, 16 kHz mono, 200 ms), converts them to float32 and queues them; the capture pump never waits for the engine. The recording module calls `startLive` after the capture has started and `stopLive` at Stop.
12. **Fake native build.** The fake build uses `FakeSpeechEngine` (a scripted phrase every 3 s, with word times and alternating speaker tags when diarization is on) and in-memory stores, so the pages and e2e can drive downloads without network.

## Parity items

### Engine gate and setup dialog

| #   | Status  | Note                                                                                                                                                      |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | done    | `TranscriptionEngineInstaller.isReady`; the speaker model is not part of it. `status().ready` carries it                                                  |
| 2 | done | `EngineSetupDialog` (`features/transcription`). Record asks `getStatus` first; the dialog opens only when the engine is not ready, and Record starts only after `ready`. Cancel, Escape and the close button cancel the transfer and leave the page as it was, with "Setup cancelled." |
| 3 | improved | All `EngineSetup*` strings used. The hint is the dialog description. The failure bar keeps its title (`EngineSetup_Failed.Title`) and the raw message; the separate "Download failed." status line is not drawn while the bar is open, since it said the same |
| 4 | done | The dialog calls `ensureEngine` when it opens, once per opening. A late answer of an older run cannot close a dialog opened afterwards (test) |
| 5 | improved | One overall bar (`stepIndex` and `stepCount` spread the stages, B21) with the percent in mono, the stage words from `INSTALL_STAGE_LABEL_KEYS` and "Step 1 of 2". The two-space join is not kept: HTML collapses it and the percent has its own place |
| 6   | done    | After the download the controller re-checks `isReady` and answers `failed` with `Error_EngineNotReady` in the app language. Test in the controller suite |
| 7   | done    | `cancelInstall` cancels the token; the outcome is `cancelled`, no message                                                                                 |
| 8   | done    | Any other error is `failed` with the raw message. The "Download failed." status line is the page's                                                        |

### Live transcription

| #   | Status         | Note                                                                                                                                                  |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | done           | `startLive` returns `{active:false}` when `liveTranscriptionEnabled` is off; the recording module calls it                                            |
| 10 | improved | `RecordingTakes` calls `startLive` after the capture starts and `stopLive` at Stop. If the live pass cannot start the capture is stopped and the take fails with `Error_StartRecording`. The page shows "Loading transcription model..." while it starts. The draft is kept in `lastLiveDraft` for the recording module (nothing saves it yet) |
| 11  | done           | `pcm16ToFloat32` of the recording frames, 16 kHz                                                                                                      |
| 12  | done           | Queue of 8, drop-oldest, `pushFrame` returns at once. Test with a blocked push. Real run: 0 ms dropped in 13.1 s                                      |
| 13  | done           | Totals and drops per session, reset by `start`                                                                                                        |
| 14  | done           | A failing push or pull is reported to `onError` and the loop goes on                                                                                  |
| 15  | improved       | B4. A throwing listener is caught and reported                                                                                                        |
| 16  | done           | `start` stops a running session first; a failed stream disposes the recognizer and rethrows                                                           |
| 17  | done           | Stop drains the queue, commits the interim, disposes stream then recognizer, never finishes the stream                                                |
| 18  | done           | Returns committed text, `''` when idle; the drop summary is published once per stopped session (`onLiveDropsChanged` fires once)                      |
| 19  | done           | `stopLive` returns the text on screen (blank is null) when the service throws                                                                         |
| 20  | dropped        | B1. `SetClockSkew` is removed. It never changed a stamp                                                                                               |
| 21  | done           | `displayText` and `committedText` are separate, broadcast as `transcription.liveUpdate`                                                               |

### Accumulator and format

| #     | Status   | Note                                                                                                                                            |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 22    | done     | All 22 accumulator cases of section 6 are ported (`accumulator.test.ts`)                                                                        |
| 23-25 | done     | Header once, display with the header, `commitRemainingInterim`                                                                                  |
| 26-30 | done     | Timing from words, untimed fallback, `_lastEnd` on finals only, fast path, window rules                                                         |
| 31    | improved | B10. Text without spaces (Japanese, Chinese) uses the engine word texts joined with nothing, so the splitting rules still apply. Extra tokens are still appended to the last window |
| 32-33 | done     | Single-space join, untimed windows with proportional time and no speaker tags                                                                   |
| 34-36 | done     | Line format, total minutes, hundredths truncated, clamps                                                                                        |
| 37    | improved | B20. A transcript that starts with `Ended` and has no `Recorded` line gets one Recorded line before it, not a second pair. CRLF/LF kept and idempotent |
| 38    | improved | Decision 3. Internal text is `\n`; the parser reads CRLF, LF and CR. CRLF on disk is a persistence-boundary choice for the library writer         |

### Language

| #   | Status | Note                                                                                                                                       |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 39  | done   | Catalog built by settings-i18n (`TRANSCRIPTION_LANGUAGES`, names for en and es); reused                                                    |
| 40  | done   | `SUMMARY_LANGUAGES`, same module                                                                                                           |
| 41  | done   | `resolveTranscriptionLanguage` (unset gives `es`). The status carries it and every pass uses it                                            |
| 42  | done   | `engineLocaleFor`; tests assert `es-US`, `pt-BR`, `en-US`, `auto` at the stream                                                            |

### Offline pass

| #   | Status         | Note                                                                                                                                              |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 43  | done           | Offline latency (13 frames) and Meeting geometry; asserted on the recognizer settings                                                             |
| 44  | done           | `WavFrameReader.open` runs `repairWavFile` first. Test with sizes zeroed in the header                                                            |
| 45  | done           | 1600 samples per channel, channels averaged, the file's real rate sent, empty frames skipped. Also reads an 18-byte `fmt` chunk (SAPI) and float32 |
| 46  | done           | Cancel is checked per frame and throws `TranscriptionCancelledError`; stream, recognizer and file are always closed                               |
| 47  | improved       | B13. `distinctPercent` reports each value once, 101 at most                                                                                       |
| 48  | done           | Leftover interim committed, 100 reported, committed text returned                                                                                 |
| 49  | open-recording | `resolveTranscriptionStage` is ported and tested; the pipeline that uses it, `Ended` header and highlights is the recording module's              |
| 50  | open-recording | Re-transcription implements it (`Error_EngineNotReady`); the post-Stop pipeline is the recording module's                                         |
| 51  | done           | The four strings exist in en and es (checked by the catalog tests); `retranscribe` uses `Error_TranscriptionFailedAudioKept` and `Error_NoTranscript` |

### Re-transcription

| #   | Status   | Note                                                                                                                                               |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 52  | done     | `evaluateRetranscription`, order NoAudio (blank path, missing file) then Busy then Available                                                       |
| 53  | improved | B8. `highlightsMs` carries the starred lines of the old transcript. `liveDraft` null, paused 0, `endedAt` stays null when unknown                  |
| 54  | done     | `AlreadyRunning` when a run is going                                                                                                               |
| 55  | done     | Starts at "Transcribing audio...", then "Transcribing audio... N%" from the pass                                                                   |
| 56  | done     | `onMeetingSaved` calls `workspace.notifyMeetingChanged`                                                                                            |
| 57  | done     | Precedence tested with all flags set                                                                                                               |
| 58  | done     | The saved transcript is replaced only after the pass has text; failure, empty text and cancel leave it. Controller tests                           |
| 59  | done     | Idle state is restored before `finished` is raised                                                                                                 |
| 60 | improved | `RetranscribeControl` on the Session page: availability, confirmation naming the meeting, status with percent and Cancel, notices for the five outcomes. Added: a quiet reason next to the disabled button (no audio, busy, engine missing). The Session page is still the library hand-off placeholder, so the control sits under its title |

### Backend selection and status

| #     | Status   | Note                                                                                                                                  |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 61-65 | done     | All factory cases of section 6, with the exact messages                                                                               |
| 66    | improved | B7. `usage.diarization` is `off`, `on` or `model-missing`; the page shows `Ui_SpeakerModelMissing` for the last                       |
| 67    | done     | `AsrBackendStatus`: null until reported, `Changed` and `LiveDropsChanged` events. Pushed to the page as `transcription.statusChanged` |
| 68    | done     | `droppedPercent`                                                                                                                      |

### Settings UI

| #   | Status   | Note                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 69  | done     | `setLiveEnabled`; no-op when unchanged                                                                                                                       |
| 70  | improved | B7. Download first; a failed or cancelled download leaves the labels off                                                                                     |
| 71 | done | Speaker model row with Download and Delete; progress from the `speaker-model` stage; a failure stays visible as "Download failed: ... Speaker labels stay off." until the next action |
| 72  | improved | B22. A locked file is a `failed` value with the message. A deleted model turns the setting off                                                               |
| 73 | done | Settings Download uses `ensureEngine` with the stage progress; a failure replaces the acceleration caption with "Download failed: {0}" |
| 74  | done     | `deleteEngine` answers `Deleted`, `RuntimeInUse` or `Incomplete`; the status is published afterwards. Strings `Error_EngineDeleteInUse` and `...Incomplete` exist |
| 75 | done | The four captions, from `status.expectedBackend` and `status.usage.backend` (unit tests for all four) |
| 76 | done | Warning bar with the raw reason (unit test). Not observed with a real CUDA failure |
| 77 | done | Caption up to 5 percent, warning above it, nothing before a live session has stopped; the number follows the app language (unit tests) |
| 78  | improved | The main process pushes `statusChanged` when the backend or the drops change, so the page needs no polling or subscription management                         |
| 79  | improved | B6. `deleteEngine` also removes the speaker model                                                                                                            |

### Runtime install and delete

| #   | Status   | Note                                                                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 80  | improved | v0.3.0 pins (decision 1). SHA compared case-insensitively; the mismatch message is exact. Real v0.3.0 CPU zip verified against the pin, extracted and promoted in 165 ms          |
| 81  | done     | `<folder>.zip`, `<folder>.extracting`, `<folder>`; temp and zip removed in every outcome                                                                                        |
| 82  | done     | 8 tries with 150 ms x (n+1) backoff (asserted: 150 to 1200), then copy; the marker covers it                                                                                    |
| 83  | done     | Marker present, or no library under the folder (direct `bin`, nested `bin`, any subfolder)                                                                                      |
| 84  | done     | A failed promote or a folder without the library removes the destination and keeps the marker; an older install without a marker stays ready                                    |
| 85  | done     | Probe all files first, then marker, delete, unmarker per backend, then the root. Partial failure and retry tested                                                               |
| 86  | done     | Observed with the real library: in the integration test and in the Electron e2e, `deleteEngine` answers `RuntimeInUse` after a transcription and removes nothing                 |
| 87  | improved | B25, B21. Stages are keys (`Ui_EngineStage*`) and each progress event has `stepIndex` and `stepCount`, so one overall bar is possible                                           |
| 88  | done     | `expectedBackend`                                                                                                                                                               |
| 89  | done     | `ensure` never downloads Sortformer (test)                                                                                                                                      |

### Model and downloader

| #   | Status   | Note                                                                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 90  | improved | Both GGUF URLs are pinned to a commit. Directories come from `AppPaths` (`TranscriptionModels`, `NemoSpeech`)                                                               |
| 91  | improved | Decision 8. HTTP errors, cancel and checksum failures remove the part file; a broken transfer keeps it for resume. The final path never holds a partial file                 |
| 92  | done     | Whole-number percent 0 to 100, only when the length is known. The chunk size is the network stack's, not 80 KiB                                                              |
| 93  | done     | `isModelDownloaded` is existence; a `.part` file does not count; delete tolerates a missing file                                                                            |
| 94  | improved | B5. Range resume, 60 s stall timeout, SHA-256 of both GGUF files. A real Sortformer download (147 MB, redirected host) passed the checksum                                    |
| 95  | improved | B17. One shared transfer per backend and per file (tests)                                                                                                                   |

### Native binding

| #   | Status   | Note                                                                                                                                                                                                  |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 96  | done     | Chunk 0.16, padding 1.92/1.92, right context 3 or 13, endpointing on, energy based, 800 ms, offsets and punctuation on, max alternatives 1. Used against the real engine                              |
| 97  | done     | Meeting 340/40/-1/40/188/300 and Streaming zeros with left -1, in `asr-types.ts`; both ran with the real Sortformer                                                                                    |
| 98  | done     | `readResult` copies the transcript, flags, seconds and words, then destroys the handle in a `finally`                                                                                                  |
| 99  | done     | Errors read `<function> failed: <last_error>`; a null handle after a good status is also an error                                                                                                     |
| 100 | improved | Cached per folder (case-insensitive) in the worker, a failed load caches nothing, never unloaded, `SetDllDirectoryW` before load. Loads are serialized by the worker's single message loop. CUDA then CPU in one process worked |
| 101 | done     | A test with real koffi asserts backend 16, model 24, streaming 24, endpointing 16, diar 40, recognizer 88 (v0.3.0 added `salm`), options 72                                                            |
| 102 | done     | `stream_finish` is not bound; the library is never released                                                                                                                                            |

### Transcript helpers

| #   | Status   | Note                                                                                                                                  |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 103 | done     | All six highlight cases of section 6; minutes use a double so ten-digit minutes do not throw (B19)                                    |
| 104 | done     | The regex runs after the `* ` is stripped                                                                                             |
| 105 | done     | `L000`, tagged document, `MAX_CHOICE_OPTIONS`, `truncateToCompleteLines`                                                              |
| 106 | improved | B14. A starred line is read like the line under the star. The library snippet now uses this parser instead of its own copy            |

### Polish

| #       | Status     | Note                                                                                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 107     | done       | Prompt text identical to 3.14 for a known language                                                                                                                        |
| 108     | improved   | B3. Blank is Spanish; `auto` and unknown codes ask to keep the spoken language instead of translating to Spanish                                                          |
| 109     | done       | `splitTimestampedChunks`; chunks join with `\n`                                                                                                                           |
| 110-113 | open-other | Providers (local model, Claude Code, Codex, xAI) and their selection need the CLI runner, the xAI client and the local model. They implement `TranscriptPolisher`, the port here |
| 114     | improved   | `polishOrKeep` returns the raw transcript on any failure or when lines or stamps were lost (B16). Nothing in the app calls it yet (B2): the pipeline owner wires it            |

### Catalogs

| #   | Status | Note                                                                            |
| --- | ------ | ------------------------------------------------------------------------------- |
| 115 | done   | `InferenceCatalog` equivalents live in settings-i18n (`inference-options.ts`)   |
| 116 | done   | The keys of section 2 exist in both locales; the catalog tests check them       |

## User interface

Code: `apps/desktop/src/renderer/features/transcription` (containers and hooks; the kit in `ui/` is reused as is). Screens: `docs/port/screens/transcription/` (light and dark). Tests: unit (`*.test.tsx`) and `e2e/transcription-ui.spec.ts` on the fake native build; screenshots with `VOZELLA_SCREENSHOTS=1 pnpm --filter @vozella/desktop exec playwright test transcription-screens`.

| Piece | What it does |
| --- | --- |
| `EngineSetupDialog` | Record gate (spec 2.1, 2.2): starts the download, overall bar, stage words, raw failure, Try again (added; the WinUI dialog had none), Cancel |
| `TranscriptionSection` | Settings block (2.6): engine state, Download, Delete, processor caption, CUDA fallback warning, live drops, live switch, speaker labels switch, speaker model Download and Delete. The language rows stay in the meeting language block (settings-i18n) |
| `LiveTranscript` | Record pane (2.3): committed lines in ink, interim suffix muted, timestamp column in mono, speaker as S1 to S4, follows the bottom unless the reader scrolled up, keyboard scrollable. A line says the preview is off when the setting is off |
| `RetranscribeControl` | Session page (2.5): confirm, progress, cancel, outcome notice |
| `useEngineStatus`, `useEngineInstall`, `useRetranscription` | Status read once and replaced by pushes; one install at a time with a generation counter so an older run never moves the state |

## UI decisions

13. **The Record gate lives in the Record page** (a few lines: `getStatus`, dialog, then `begin`). The recording module keeps it when it takes the page over. If `getStatus` itself fails the dialog opens and shows the failure.
14. **A recording starts the live pass from the main process.** `RecordingTakes` takes a `live` port that the composition root fills with the transcription controller. The recording module replaces it with the full pipeline; until then the draft is only kept in memory (`lastLiveDraft`).
15. **A new download after a cancel waits for the cancelled one, then starts again** (controller fix, test `a download asked for right after a cancel starts again...`). Before, a second `ensureEngine` inside the cancel window joined the dying transfer and got `cancelled`. Found by the screenshot run.
16. **Fake native build knobs** for e2e: `VOZELLA_FAKE_ENGINE_STEP_MS` (visible download steps, cancellable), `VOZELLA_FAKE_ENGINE_FAIL` (message of every failure) and `VOZELLA_FAKE_ENGINE_INSTALLED=1`. Default is the old instant behavior.
17. **Settings buttons carry the row name** ("Delete Nemotron 3.5 ASR Streaming 0.6B") so three Delete buttons are not three identical names for a screen reader.
18. **Copy.** Fourteen new `Ui_*` strings in en and es (installed state, On and Off, step, live waiting and off, three re-transcription reasons, status name, speaker model, speaker labels stay off). Everything else reuses existing keys.

## Bugs fixed (section 7)

Each has a regression test. A mutation check reverted the fix and ran the suite: B3, B6, B8, B10, B13, B14, B18 and B20 each turned one test red.

| Bug  | Fix                                                                                                          | Test                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| B1   | `ClockSkew` and the paused-time argument removed                                                             | `has no clock skew: stamps are elapsed time only (B1)`                     |
| B3   | `auto` and unknown languages no longer polish into Spanish                                                   | `language names: blank is Spanish, auto and unknown ask to keep ... (B3)`  |
| B4   | A throwing listener is caught; the engine is still closed                                                    | `B4: a throwing subscriber does not leave the engine open`                 |
| B5   | Range resume, stall timeout, SHA-256 of the GGUF files                                                       | `downloader additions (B5)` (5 tests)                                      |
| B6   | `deleteEngine` removes the speaker model                                                                     | `removes the runtime and both models (B6)`                                 |
| B7   | Labels off after a failed download or a deleted model; `model-missing` is visible                            | controller `B7` tests; factory test `... and says so (B7)`                 |
| B8   | The old stars are re-applied to the new transcript                                                           | `B8: the starred lines of the old transcript come back as highlights`, `B8: the old stars survive the new transcript` |
| B10  | Text without spaces uses the engine word texts                                                               | `B10: text without spaces (Japanese, Chinese)`                             |
| B12  | Start and Stop are serialized                                                                                | `B12: a Start and a Stop issued together never see a half started session` |
| B13  | Each percent value is reported once                                                                          | `B13: reports each distinct percent once`                                  |
| B14  | Starred lines parse like unstarred ones; the library snippet uses the same parser                            | `B14: a starred line reads like the line under the star`                   |
| B16  | `</transcript>` in the text is escaped, code fences are stripped, damaged output is dropped                  | `B16: ...`, `B2/B16: polishOrKeep returns the raw transcript ...`          |
| B17  | One transfer per file and per backend                                                                        | `B17: two callers for the same file share one transfer` (and the runtime one) |
| B18  | A bare interim is stamped when committed                                                                     | `B18: committing a bare interim`                                           |
| B19  | Minutes parse as a double (no overflow)                                                                      | `keeps CRLF and survives huge minute counts (B19)`                         |
| B20  | `Ended` without `Recorded` gets one Recorded line                                                            | `B20: a transcript that starts with Ended ...`                             |
| B21  | Each stage reports `stepIndex` and `stepCount`                                                               | `downloads the CUDA runtime, then the CPU fallback, then the model ...`    |
| B22  | A locked speaker model is a message                                                                          | `B22: a locked speaker model is a message, not a crash`                    |
| B25  | Stage names are catalog keys, not English literals                                                           | catalog tests (`INSTALL_STAGE_LABEL_KEYS`)                                 |
| B9   | `Recognize` and `RecognizeF32` not ported (dead code); `FinishAndDrain` not bound                            | n/a                                                                        |
| B11  | Moot with B1                                                                                                 | n/a                                                                        |
| B24  | Doc comments only                                                                                            | n/a                                                                        |

Not changed: B2 (see Left for other modules), B15 (local polisher), B23 (GPU choice belongs to the hardware probe; the settings module already takes the adapter with the most video memory, so a hybrid laptop reports the discrete card).

## Left for other modules

- **Recording module.** `startLive` and `stopLive` are already called by `RecordingTakes`; take `lastLiveDraft` as the draft. Call `transcribeFile` after Stop and after import, with the progress and a `CancelSource`. Use `resolveTranscriptionStage` and `ensureEndedHeader` for the saved transcript and `applyHighlights` with the marks of the take. The Record gate and the setup dialog are built (decision 13).
- **Summary module.** Plug into `RetranscriptionPipeline` so a re-transcription also regenerates the summary (today it ends as `TranscriptOnly` and the summary is kept). Provide the note template text through `templateInstructions` and the failure text through `formatFailure` (`CliFailureUserMessage`).
- **Polish (B2, B15).** The four providers, their selection, the call from the pipeline, and the local model chunk budget. `TranscriptPolisher`, `buildPolishPrompt`, `splitTimestampedChunks` and `polishOrKeep` are ready.
- **Session page.** The transcript and summary tabs belong to the session module. When it lands, mount `RetranscribeControl` in its header and reload the meeting from `onFinished`.
- **Library.** CRLF in the meeting file if byte parity of transcripts matters; the accumulator now produces `\n`.
- **Packaging.** koffi is already external and unpacked in `electron-builder.config.mjs`. A packaged build running the ASR worker was not tried.

## What the UI half gets

Requests: `transcription.getStatus`, `ensureEngine`, `cancelInstall`, `deleteEngine`, `setLiveEnabled`, `setSpeakerLabels`, `downloadSpeakerModel`, `deleteSpeakerModel`, `retranscription.availability`, `start`, `cancel`, `getState`. Events: `transcription.statusChanged`, `installProgress`, `liveUpdate`, `retranscription.stateChanged`, `finished`. Catalog keys: `INSTALL_STAGE_LABEL_KEYS` (`Ui_EngineStage*`, `Status_DownloadingSpeakerModel`) and `SPEAKER_MODEL_MISSING_KEY`. The status object has everything for items 75 to 77.

## Observed with the real engine

Machine: Windows 11, RTX 3070 Laptop GPU, NeMo-Speech.cpp v0.3.0, Nemotron 3.5 q8_0, Sortformer 4spk v2 q8_0. Input: a 13.1 s Spanish WAV made by the Windows synthesizer (voice Microsoft Sabina Desktop), 16 kHz mono PCM16. Run with `VOZELLA_REAL_ASR=1 VOZELLA_REAL_ASR_NET=1 pnpm --filter @vozella/desktop exec vitest run real-engine` and `VOZELLA_REAL_ASR=1 pnpm --filter @vozella/desktop exec playwright test transcription-real`.

Offline pass on CUDA, 770 to 910 ms for the 13.1 s file, no fallback reason:

```
Recorded 2026-11-02 09:05
[00:00.24-00:01.28] Buenos días a todos
[00:01.28-00:12.25] Hoy vamos a revisar el presupuesto del tercer trimestre y acordar las fechas de entrega del proyecto. Por favor, Ana, comparte los resultados de ventas de este mes
```

Offline pass on CPU, 1.6 to 1.7 s, same two lines (CUDA first and CPU second in one process worked). Live pass on CPU, real-time frames, 39 updates, 0 ms dropped, committed text:

```
[00:00.32-00:01.28] Buenos días a todos
[00:02.32-00:07.28] Hoy vamos a revisar el presupuesto del tercer trimestre y acordar las fechas de entrega del proyecto
[00:08.64-00:08.80] Por favor,
[00:09.52-00:12.32] Ana, comparte los resultados de ventas de este mes.
```

The offline pass leaves the last sentence without its period; the live pass keeps it.

**Sortformer.** The pinned model downloaded with its checksum (101 progress steps) and loaded on v0.3.0 on both passes. Input: the first voice, then Microsoft Zira (an English voice reading Spanish, so the words are poor), then the first voice again, with one second of silence between turns. Offline, Meeting geometry:

```
[00:00.16-00:04.16] [ Speaker-1 ] Buenos días, vamos a empezar la reunión de hoy con el informe de ventas
[00:08.08-00:12.08] [ Speaker-2 ] Primero Quiero Abler del Presupusto wide a los plazos del proyecto
[00:12.08-00:17.85] Buenos días, vamos a empezar la reunión de hoy con el informe de
```

Live, Streaming geometry, gave the same shape (Speaker-1, Speaker-2, then an untagged third line, 0 ms dropped). So labels work, two voices are told apart, and the return of the first voice after the second came back untagged on both passes in this one synthetic clip. Whether that is the model, the synthetic voices or the short gaps was not investigated: `pending-real-validation` with a real two-person recording.

Electron: the ASR utility process (`vozella-asr`) loaded the library through koffi, re-transcribed a saved meeting, replaced its transcript, kept its summary, reported `usage.backend: cpu`, and `deleteEngine` then answered `RuntimeInUse`.

## Not verified

- **UI half.** Observed in the real Electron window on the fake native build only: the engine and the downloads are doubles, the live text is the fake script. The CUDA fallback warning and the live drops warning are covered by unit tests with scripted status, not by a real engine. Forced-colors rendering, a screen reader and a high-DPI window were not tried (axe: no serious or critical violations on the dialog open and failed, the live pane and the Settings page, light and dark).
- **Red first.** The pure helpers (`live-lines`) and the components were written together with their tests; red was observed for the live hook in `RecordingTakes` and for the cancel-then-download controller fix.
- **settings-ui flake.** The flaky test `meeting language and summary language are saved on their own` failed 1 in 3 runs of its file also with the new Settings block hidden, so it predates this half; it passes alone.

- **Windows 10.** Not available.
- **The 509 MB CUDA zip end to end.** Its checksum is the one GitHub reports and the file in the spikes folder matches it. The download, extraction and promote of the real CPU zip was run (from the spike copy, through the production manager); the CUDA zip was not pushed through the same path, and neither zip was downloaded from GitHub in this run.
- **A CUDA creation failure with fallback in the real engine.** The fallback is tested with a double; no real CUDA failure could be provoked here.
- **Hours-long sessions, and a crash of the ASR process during a take.** The host fails calls in flight and the worker restarts (tested with a double); a native abort on a long CUDA stream was not provoked.
- **A packaged build** running the ASR worker.
- **TDD note.** The ported cases and the regression tests were written together with the code. The mutation check above shows the regression tests fail on the old behavior; a separate red run before each fix was not recorded.
- **A flaky neighbour.** In one full Playwright run `settings-ui` "meeting language and summary language are saved on their own" timed out waiting for a menu option; it passed alone. It does not touch this module.

## Audit follow-up

Fixed, with tests: item 10 (the live pass now starts before the capture, as in C#; a capture failure stops the live pass; item 10 row above is superseded); item 19 blank-draft test; parity 24, 25 and 27 tests; item 45 empty-frame test; B17 install sharing is keyed by kind (a speaker model download no longer answers an engine request, and the reverse); B7 deleting the engine turns speaker labels off; B22 a failed speaker model delete has its own message and no download bar; item 71 the bar is only drawn for downloads and uses `Status_DownloadingSpeakerModel`; parity 60 the confirmation no longer promises a summary (new key `Ui_RetranscribeConfirm`, en and es); parity 55 the runner starts with an empty status so the localized `Status_Transcribing` shows; Stop keeps the update subscription while it drains.

Rejected or deferred, with reason: items 49 and 50 (recording pipeline orchestrator, out of scope per spec section 1; the recording module wires `resolveTranscriptionStage`); items 110 to 114 and B2/B15 (polish providers belong to the summaries and local-inference modules, which do not exist yet; a chunking wrapper has no caller, so it was not added); items 96, 98, 99 (native config value assertions need the real DLL, covered by the gated real-engine run); item 78 and 73 text format and the cache-key, pin-hash, B10 fallback and polishKeepsStructure notes (low risk, no behavior change made, left as recorded); `pnpm build` EPERM in the napi rename is an environment lock, the renderer was rebuilt with electron-vite for e2e; the em dashes are legacy reused keys.
