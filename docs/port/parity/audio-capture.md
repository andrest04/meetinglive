# Parity ledger: audio-capture

Spec: `docs/port/specs/audio-capture.md`. Section 8 has 165 items; every one is below. The first part of the ledger covers the domain and integration half: capture, mixing, WAV files, devices, levels, app sessions, import, and the main-process handlers. The user interface half (Record page Sources block, Settings microphone section, status line) closed the `open-ui` items and is described under User interface half below.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped` (reason given), `pending-real-validation` (what is needed). Two more mark work that belongs to another half and has its data ready: `open-ui` (the user interface half draws or wires it) and `open-recording` (the recording module calls it).

## Where things are

| Concern                                                              | Code                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capture request, validation, failure predicates                      | `packages/core/src/audio-capture/capture-sources.ts`                                                      |
| Recording service (start, pause, stop, pump, failures)               | `audio-capture/recording-service.ts`                                                                      |
| Mixer and 5 s source buffers                                         | `audio-capture/mixer.ts`                                                                                  |
| WAV header, flush cadence, repair analysis, duration                 | `audio-capture/wav-format.ts`                                                                             |
| Level curve, RMS, normalizer                                         | `audio-capture/level-meter.ts`                                                                            |
| Active app discovery                                                 | `audio-capture/active-audio-apps.ts`                                                                      |
| Picker merge, still-running check, suggestion, remembered choices    | `audio-capture/source-picker.ts`                                                                          |
| Microphone options and the picker model (cards, selection, fallback) | `audio-capture/record-sources.ts`                                                                         |
| Idle microphone preview                                              | `audio-capture/microphone-preview.ts`                                                                     |
| Import                                                               | `audio-capture/import-service.ts`                                                                         |
| Device ports, Windows build gate                                     | `audio-capture/ports.ts`                                                                                  |
| Test doubles for the recording service                               | `audio-capture/recording-test-kit.ts`                                                                     |
| Native: capture thread, stop reporting, app exit, silent packets     | `native/vozella-native/src/audio/capture.rs`, `binding.rs`                                                |
| Native: microphones and render sessions                              | `src/audio/devices.rs`                                                                                    |
| Native: process details, version info, Windows build                 | `src/audio/process.rs`                                                                                    |
| Native: Media Foundation decode                                      | `src/audio/decode.rs`                                                                                     |
| Adapters, WAV file writer, repair, startup recovery, runtime wiring  | `packages/platform/src/native/native-adapters.ts`, `src/audio/`                                           |
| Fakes                                                                | `packages/platform/src/fakes/fake-audio-capture.ts`, `fake-audio-devices.ts`, `audio/wav-file-decoder.ts` |
| Worker messages and page channels                                    | `packages/contracts/src/workers.ts`, `audio.ts`                                                           |
| Audio worker (rpc, pushes)                                           | `apps/desktop/src/workers/audio/audio-worker-core.ts`                                                     |
| Main-side worker host (calls, pushes, restart notice)                | `apps/desktop/src/main/workers/audio-worker-host.ts`                                                      |
| Controller (picker polling, microphone list, recording, import)      | `apps/desktop/src/main/audio/audio-controller.ts`                                                         |
| Handlers                                                             | `apps/desktop/src/main/ipc/audio-handlers.ts`                                                             |
| Real-device proof                                                    | `packages/platform/src/audio/real-device.integration.test.ts`                                             |

## Decisions

1. **Mixing happens in the audio worker, resampling in Rust.** The addon already delivers one source as 20 ms frames of 16 kHz mono PCM16 (48 kHz f32 stereo in, windowed-sinc low-pass, channel average, silence synthesized from the clock). The worker keeps one 5 s buffer per source, sums them without attenuation, clamps and scales by 32767, and writes 200 ms chunks paced by the wall clock. The file and the live frames are the same bytes.
2. **The WAV header is the app's own 46-byte layout** (18-byte fmt chunk), so a folder stays byte-compatible. Sizes are rewritten in place by position, so there is no write position to restore.
3. **C4 (level bar shows the mix).** Decided: the bar shows the microphone alone, 100 ms peak of RMS, through the curve times 100, and never moves when the microphone is None. It matches the label "Microphone level" and the idle bar. The mix is still available as frames.
4. **C7 (no capability check).** Decided: a process capture is refused with a plain message when the Windows build is below 20348, the build Microsoft documents. The gate is a preflight in the service, before any file or device. An unknown build passes through. Builds 19041 to 20347 may work; that is `pending-real-validation` and the constant is one line.
5. **S1 (target exit not noticed).** Decided: the capture thread checks every 250 ms that the target process still exists. It ends with the error "the captured application exited", which the service treats like any process capture failure (stop, keep the audio).
6. **S3 (error-free unexpected stop).** Kept as in the spec: nothing in the native code stops a capture without an error, so the case cannot occur. No code for it.
7. **S8 (culture ordering).** Names are compared with an `en` collator, case-insensitive, accents distinct, on every machine.
8. **Settings writes use `SettingsStore.update(patch)`** (read, modify, write under one lock) instead of load, mutate, save. The remember helpers return patches. Failures are ignored, as in the spec.
9. **The renderer never names a file to write.** There is no channel that starts a recording. The recording module calls `AudioController.startRecording(path, microphoneChoice)` with a path it allocated. The pages get the picker, the microphone list, the idle preview, the import file picker, and events.
10. **Main owns the picker state.** `RecordSourcePicker` lives in the controller; the page gets the whole state on `audio.sources.changed` and sends `select`, `dismissSuggestion`, `closeFallback`. The remembered app is restored before the first publish, so a suggestion does not flash and vanish (item 139).
11. **Process names that the OS hides.** The main process pid is passed to the worker as `VOZELLA_MAIN_PID`; helpers of the same image roll up into it and are excluded (item 165).
12. **Media Foundation decodes imports.** The source reader is asked for float at 48 kHz with the source channel count (stereo as fallback); the Rust downsampler averages every channel and resamples to 16 kHz. A TypeScript WAV reader backs the fake native build and tests only.
13. **Import yields to the event loop between buffers**, so a cancel message is read while a long file converts.

## Parity items

### Capture request and validation

| #   | Status | Note                                                                             |
| --- | ------ | -------------------------------------------------------------------------------- |
| 1   | done   | `RecordingCaptureSources`, `capture-sources.test.ts`                             |
| 2   | done   | Two factories and `assertValidCaptureSources`                                    |
| 3   | done   | Exact message, `CaptureSourcesError` with `param` and `kind`                     |
| 4   | done   | Out-of-range error before any device; service test checks no session opened      |
| 5   | done   | Exact message                                                                    |
| 6   | done   | `effectiveMicrophoneId`; the service test opens no mic when it is off            |
| 7   | done   | `legacyCaptureSources`. TypeScript has no overloads, so there is only the helper |
| 8   | done   | Validation is the first line of `start`                                          |
| 9   | done   | Also during a stop; test covers both                                             |

### Mixing and file output

| #   | Status   | Note                                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | done     | Float mix at 16 kHz mono, PCM16 file                                                                                                                                                              |
| 11  | done     | Mic optional, exactly one output                                                                                                                                                                  |
| 12  | done     | `MixerInput`: drop on overflow, zeros on underrun, tested at the 5 s limit                                                                                                                        |
| 13  | done     | Done in Rust (`Downsampler48to16` averages channels). Rust test `averages_any_channel_count_to_mono`                                                                                              |
| 14  | done     | Own 63-tap Blackman windowed-sinc low-pass and 3:1 decimation replaces the WDL resampler. Spike measured tone level and alias rejection                                                           |
| 15  | improved | C3. The WASAPI client is asked for stereo with auto conversion, then every channel is averaged. No more-than-2-channel microphone was available here: `pending-real-validation` for such a device |
| 16  | done     | Sum, clamp, scale by 32767, rounded (not truncated). One LSB at most from the NAudio path                                                                                                         |
| 17  | done     | 6400-byte chunks                                                                                                                                                                                  |
| 18  | done     | Pacing test with a manual clock; real-device run: 3 s of recording gave a 2.6 to 3.6 s file                                                                                                       |
| 19  | done     | Silence on an empty buffer, tested                                                                                                                                                                |
| 20  | done     | No sleep when behind, but a turn of the event loop between chunks so arrived audio reaches the buffers first (tested both ways)                                                                   |
| 21  | done     | Every 160000 bytes, counted from the last flush; IO error ignored                                                                                                                                 |
| 22  | done     | Counts written bytes; tested across a pause                                                                                                                                                       |
| 23  | done     | `WavFileWriter` creates the file at start and closes it at stop                                                                                                                                   |

### Live frames

| #   | Status   | Note                                                                                                                                                                                                                                      |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24  | done     | `PcmFrame` float32 (int16 / 32768), 16000 Hz, 3200 samples                                                                                                                                                                                |
| 25  | done     | Only with a listener and at least 2 bytes                                                                                                                                                                                                 |
| 26  | done     | After the write                                                                                                                                                                                                                           |
| 27  | done     | A throwing listener becomes a pump fault, kept for stop                                                                                                                                                                                   |
| 28  | improved | C4 decision above. The percent is computed in the worker and clamped in main; empty frames are ignored. The Record page mounts the bar in `RecordingStatusLine`; e2e watches it move with the fake microphone tone (`audio-take.spec.ts`) |

### Pause and resume

| #   | Status   | Note                                                                                                                                                                                                                                                |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29  | done     | No-op when not recording                                                                                                                                                                                                                            |
| 30  | done     | Drain, 50 ms sleep, nothing written, no frame, no flush                                                                                                                                                                                             |
| 31  | done     | Real-time test: 0.5 s, 1 s pause, 0.5 s gave under 1.6 s                                                                                                                                                                                            |
| 32  | done     |                                                                                                                                                                                                                                                     |
| 33  | done     | `recordingStatus`, `RecordingStatusLine`: paused text, and a warning wins. Mounted on the Record page while a take runs (`RecordRoute.test.tsx`, e2e)                                                                                               |
| 34  | improved | Main keeps the paused time of the take (`RecordingTakes`, `recording-take.test.ts`) and `audio.recording.stop` returns `pausedSeconds`. Applying it as the live ASR clock skew is the transcription module's, because no live transcript exists yet |

### Start failure handling

| #   | Status   | Note                                                                                                                                                                                                                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 35  | done     | Every step guarded, original error rethrown                                                                                                                                                                                                                              |
| 36  | done     | The cancel source exists before any device starts                                                                                                                                                                                                                        |
| 37  | done     | Listeners are set before `start`; events during start are delivered; `isRecording` is true only when `start` resolves                                                                                                                                                    |
| 38  | improved | C1. The abort removes the file. Tests in core, runtime and worker                                                                                                                                                                                                        |
| 39  | done     | `startFailureMessage` gives `Error_StartRecording`, or the plain message for `process-loopback-unsupported`. Shown by the Record page (`use-take.test.tsx`, `RecordRoute.test.tsx`); the preview restarts by itself when the page is idle again (`useMicrophonePreview`) |

### Stop

| #   | Status | Note                                                                                                                                                                                                       |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40  | done   | One task shared by all callers, same outcome                                                                                                                                                               |
| 41  | done   |                                                                                                                                                                                                            |
| 42  | done   | Order as in the spec                                                                                                                                                                                       |
| 43  | done   | First error kept                                                                                                                                                                                           |
| 44  | done   | `repairWav` runs when flush or close failed                                                                                                                                                                |
| 45  | done   | Pump failure, else output failure, else teardown error; all cleared                                                                                                                                        |
| 46  | done   |                                                                                                                                                                                                            |
| 47  | done   | No synchronous stop exists. The worker's shutdown stops the recording and swallows errors                                                                                                                  |
| 48  | done   |                                                                                                                                                                                                            |
| 49  | done   | `useTake.stop` shows `Error_StopRecording` unless a capture failure is already on screen. There are no capture handlers on the page to detach: it listens through one subscription that ends with the take |

### Failure classification

| #   | Status | Note                                                                                                                                                                               |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50  | done   | `isSourceLost`                                                                                                                                                                     |
| 51  | done   | `shouldSurfaceOutputFailure`                                                                                                                                                       |
| 52  | done   |                                                                                                                                                                                    |
| 53  | done   |                                                                                                                                                                                    |
| 54  | done   | Never below zero                                                                                                                                                                   |
| 55  | done   |                                                                                                                                                                                    |
| 56  | done   | The service does not stop itself                                                                                                                                                   |
| 57  | done   | `useTake` handles only the first `output-failed` or `faulted` notice, shows its message and stops the take; a lost source stays a warning in the status line (`use-take.test.tsx`) |
| 58  | done   | `noticeMessage`, with tests for every key                                                                                                                                          |
| 59  | done   | `chooseWarning`, tested with a milder warning arriving late                                                                                                                        |
| 60  | done   | `RecordingStatusLine` keeps the warning across pause and resume (`RecordingStatusLine.test.tsx`, and through the page in `RecordRoute.test.tsx`)                                   |
| 61  | done   | The five message keys exist in both catalogs already. This half adds no string                                                                                                     |

### Process-tree loopback

Activation, the 12-byte blob, the property variant and the wait are inside the `wasapi` 0.26 crate (`AudioClient::new_application_loopback_client`), which builds the same structures. Isolation of one process from another was proved in the real-device run.

| #   | Status   | Note                                                                                                                                                                                                                                                                  |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 62  | done     | Pid 0 is rejected by the capture request before any native call                                                                                                                                                                                                       |
| 63  | done     | The crate fills `AUDIOCLIENT_ACTIVATION_PARAMS` with type process loopback, the pid and include-tree. Behavior shown by the real run: tone A captured at over 0.05 amplitude, tone B under a tenth of it                                                              |
| 64  | done     | The crate keeps the blob and the variant alive until the wait ends                                                                                                                                                                                                    |
| 65  | done     | `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` with `IAudioClient`                                                                                                                                                                                                           |
| 66  | improved | The crate waits without a limit. The start now waits 12 s on the capture thread, then fails with "Process loopback activation did not finish within 12 seconds." and tells the thread to stop. Rust test with a short timeout. The 10 s inner timeout is not separate |
| 67  | improved | A failed process activation reads `Process loopback activation failed: 0x{hr:08X}. {message}` (`activation_failure`, Rust test). An error without a Windows code reads as 0x80004005. Not observed with a real failing activation                                     |
| 68  | dropped  | The crate owns the completion handler; a late result after our timeout is released with the thread when it ends. Cannot be forced from a test                                                                                                                         |
| 69  | improved | The stream asks for 48 kHz 32-bit float stereo with auto conversion (what the spike proved), not 16-bit                                                                                                                                                               |
| 70  | done     | Shared mode, event callback, auto convert, loopback, zero buffer duration                                                                                                                                                                                             |
| 71  | improved | Waits 20 ms for the buffer event and drains all packets, so frames stay 20 ms                                                                                                                                                                                         |
| 72  | improved | The crate copies a silent-flagged packet as it is. The capture now zeroes it (Rust test). Counted in stats                                                                                                                                                            |
| 73  | done     | The crate releases the buffer after copying                                                                                                                                                                                                                           |
| 74  | done     | A throwing JavaScript callback is on the Node side, not on the capture thread (non-blocking call)                                                                                                                                                                     |
| 75  | done     | `onStopped(error)`                                                                                                                                                                                                                                                    |
| 76  | improved | The 12 s start wait above replaces the separate 5 s start wait; a failed start returns the Windows error                                                                                                                                                              |
| 77  | done     | Flag, join, COM left by thread exit. No 5 s join limit                                                                                                                                                                                                                |
| 78  | done     | The stop callback is a one-shot; a second `stop()` returns empty stats                                                                                                                                                                                                |
| 79  | done     | The service opens exactly one output                                                                                                                                                                                                                                  |
| 80  | done     | `initialize_mta` result ignored                                                                                                                                                                                                                                       |
| 81  | improved | S1 above. Real run: a captured process was killed and `onOutputCaptureFailed` fired with "the captured application exited", then stop kept a readable file                                                                                                            |

### Microphone list and resolution

| #   | Status | Note                                                                        |
| --- | ------ | --------------------------------------------------------------------------- |
| 82  | done   | `listMicrophones`: active endpoints with id and friendly name               |
| 83  | done   | `resolve_microphone`                                                        |
| 84  | done   | Recording and preview both go through `startCapture` with the same resolver |
| 85  | done   | A stale id falls back to the default; only "no default" fails               |

### Microphone preview

| #   | Status   | Note                                                                                                                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 86  | done     |                                                                                                                                                                                                                             |
| 87  | done     | Never throws; later start works                                                                                                                                                                                             |
| 88  | done     |                                                                                                                                                                                                                             |
| 89  | done     | Level 0 on a device that stops itself                                                                                                                                                                                       |
| 90  | improved | The native capture delivers PCM16 only, so the live path is int16 / 32768. `computeBufferRms` still reads float32 and int32 and returns 0 for other depths, with tests, for the contract. Clamped to [0, 1]                 |
| 91  | improved | Worker throttles to ten per second, main clamps to 0..100. The page marshals. Decision 12: the idle level uses the same meter curve as the recording level, not the raw RMS times 100 of spec 2.5                           |
| 92  | done     | `useMicrophonePreview(deviceId, enabled)`: runs only while enabled and stops on the way out. Settings enables it once loaded; Record while the page is active and the microphone is not None (`SourcesPanel.test.tsx`, e2e) |
| 93  | done     | The hook stops with the page. Main also stops the preview in `startRecording` and `importAudio`. The recording module flips `active` for the failed-start restart                                                           |

### Settings microphone picker

| #   | Status | Note                                                                                                                                             |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 94  | done   | `MicrophoneSection`: System default (empty id), then the devices (`MicrophoneSection.test.tsx`, e2e)                                             |
| 95  | done   | The saved id picks its item, an unplugged one reads as System default; loading never saves                                                       |
| 96  | done   | `settings.update({ selectedMicrophoneDeviceId })`, null for System default; the hook restarts the level on the new device; re-picking is ignored |
| 97  | done   | The select stays empty until the saved id has loaded, so nothing can be picked or saved before                                                   |
| 98  | done   | The hook unsubscribes and sends `audio.preview.stop` when the page unmounts (unit test, e2e)                                                     |

### Record page microphone choice

| #   | Status | Note                                                                                                                                           |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 99  | done   | Options in order; labels are the page's                                                                                                        |
| 100 | done   | `useMicrophones.reload` on show and on dropdown open (`Select.onOpenChange`); an identical list keeps the same array (`SourcesPanel.test.tsx`) |
| 101 | done   |                                                                                                                                                |
| 102 | done   | Generation counter drops a stale answer; a failed load leaves None and System default (unit test)                                              |
| 103 | done   | `buildCaptureSources`                                                                                                                          |
| 104 | done   | `sourcesSummaryArgs` and `RecordPage_SourcesSummary`, refreshed on every change (unit test, e2e)                                               |

### Remembered choices

| #   | Status   | Note                                                          |
| --- | -------- | ------------------------------------------------------------- |
| 105 | done     |                                                               |
| 106 | done     |                                                               |
| 107 | done     |                                                               |
| 108 | done     |                                                               |
| 109 | done     |                                                               |
| 110 | done     | Exact comparison                                              |
| 111 | done     | Path comparison ignores case; live pid returned               |
| 112 | done     |                                                               |
| 113 | done     | Once per start of the poller, only if the user has not picked |
| 114 | improved | Decision 8                                                    |

### Active app discovery

| #   | Status   | Note                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 115 | done     | `SessionMonitor.enumerate` resolves the default render endpoint every call                                                  |
| 116 | done     | Any error gives an empty list                                                                                               |
| 117 | done     | System sounds by session identifier, and pid 0                                                                              |
| 118 | done     | Strictly greater than 0.001                                                                                                 |
| 119 | done     |                                                                                                                             |
| 120 | done     | Checked on the process and on its root                                                                                      |
| 121 | done     |                                                                                                                             |
| 122 | done     |                                                                                                                             |
| 123 | done     |                                                                                                                             |
| 124 | done     |                                                                                                                             |
| 125 | done     |                                                                                                                             |
| 126 | done     |                                                                                                                             |
| 127 | improved | S8, decision 7                                                                                                              |
| 128 | done     |                                                                                                                             |
| 129 | done     | Controller loop; stale generations dropped; errors end it. Runs only while the page asks for it, and not during a recording |

### Picker cards

| #   | Status   | Note                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 130 | done     | `SourcesPanel`: the system card is first, selected by default, with no meter (unit test, e2e)                                                                                                                                                                                                                                                                                                       |
| 131 | improved | Name, live meter, tags and the unavailable look are drawn. The executable icon comes from Electron `app.getFileIcon` in main (`audio.apps.icon`, `app-icon.ts`): absolute `.exe` paths only, cached per path including failures, the generic glyph while it loads or when there is none (`SourcesPanel.test.tsx`, `app-icon.test.ts`, e2e). The earlier note that it needed a native call was wrong |
| 132 | done     | State; unavailable card keeps its place and reads 0                                                                                                                                                                                                                                                                                                                                                 |
| 133 | done     | Cards are keyed by process id, so the selection and focus survive refreshes (e2e keyboard test)                                                                                                                                                                                                                                                                                                     |
| 134 | done     | `noAppsPlaying`                                                                                                                                                                                                                                                                                                                                                                                     |
| 135 | done     | `select` remembers and clears the fallback; programmatic restore does not remember                                                                                                                                                                                                                                                                                                                  |
| 136 | done     | Checked against the current process image through the worker                                                                                                                                                                                                                                                                                                                                        |
| 137 | done     |                                                                                                                                                                                                                                                                                                                                                                                                     |
| 138 | done     |                                                                                                                                                                                                                                                                                                                                                                                                     |
| 139 | done     | Decision 10                                                                                                                                                                                                                                                                                                                                                                                         |

### Import

| #   | Status   | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 140 | done     | `IMPORT_EXTENSIONS` and the dialog filter                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 141 | done     | `importRecordedAt`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 142 | done     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 143 | done     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 144 | improved | C2. Real run: 44.1 kHz stereo gave 16 kHz mono PCM16, duration within 50 ms, 440 Hz tone intact                                                                                                                                                                                                                                                                                                                                                                              |
| 145 | done     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 146 | done     | Checked after each buffer, with a yield, so a message can arrive                                                                                                                                                                                                                                                                                                                                                                                                             |
| 147 | done     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 148 | improved | The Import audio button on the Record page: `audio.import.pickFile`, then `audio.import.run`. Main keeps the picked path, so the page never names a file. Shows `Status_Importing`, then `Ui_TakeSaved`, or `Error_ImportAudio`; the partial file is deleted and the preview restarts when the page is idle again (`recording-take.test.ts`, `use-take.test.tsx`, `RecordRoute.test.tsx`, e2e). The meeting record and the pipeline after the WAV are the recording module's |
| 149 | done     | `endedAtMs` = `recordedAtMs` + the converted WAV length (`recording-take.test.ts`). The recording module reads it when it builds the meeting                                                                                                                                                                                                                                                                                                                                 |

### WAV utilities

| #   | Status   | Note                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 150 | done     | `readWavFileInfo`, `readWavDurationSeconds`. Blank path throws; zero sizes throw                                                                             |
| 151 | done     |                                                                                                                                                              |
| 152 | done     | 16 and 18 byte fmt, extra chunks, word alignment                                                                                                             |
| 153 | done     |                                                                                                                                                              |
| 154 | done     |                                                                                                                                                              |
| 155 | done     |                                                                                                                                                              |
| 156 | done     | Bytes and last-write time unchanged                                                                                                                          |
| 157 | done     | The length check is in place and 4 GiB is tested in the analysis. The length-changed race has no test: it cannot be forced without a second writer           |
| 158 | improved | C5. `recoverCrashedRecordings` runs at startup in the background over the meetings folder. The call before transcription belongs to the transcription module |

### Level helpers

| #   | Status | Note                                                   |
| --- | ------ | ------------------------------------------------------ |
| 159 | done   |                                                        |
| 160 | done   | Constants and rules kept and tested, not wired in (C6) |
| 161 | done   | Nothing calls it                                       |

### Platform

| #   | Status   | Note                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 162 | done     | `AudioCapturePort`, `MicrophoneDeviceSource`, `AudioSessionSource`, `ProcessInfoProvider`, `OsBuildProbe`, decoder |
| 163 | done     | Only `native/` and the adapters know Windows                                                                       |
| 164 | improved | C7, decision 4                                                                                                     |
| 165 | done     | Decision 11                                                                                                        |

## Tests

| Spec section 6 group                                                                 | Where                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AudioCaptureServiceTests` (all 18 cases)                                            | `recording-service.test.ts` plus pause, mixing, flush and catch-up cases the spec lists as uncovered                                                                                                   |
| `RecordingCaptureSourcesTests`                                                       | `capture-sources.test.ts`. The activation blob and property variant tests are inside the crate, shown by the real-device isolation test                                                                |
| `ActiveAudioAppServiceTests`                                                         | `active-audio-apps.test.ts`                                                                                                                                                                            |
| `ActiveAppEntriesTests`, `MeetingAppSuggestionTests`, `RecordAudioSourceMemoryTests` | `record-sources.test.ts`. The JSON round trip of the settings is covered by the library settings tests                                                                                                 |
| `AudioLevelMeterTests`, `PcmLevelNormalizerTests`                                    | `level-meter.test.ts`                                                                                                                                                                                  |
| `WavHeaderRepairTests`, `WavHeaderFlushCadenceTests`                                 | `wav-format.test.ts` (pure) and `packages/platform/src/audio/wav-files.test.ts` (files). A file locked by a writer is not reproducible: Node opens files with shared access, so that case is `dropped` |
| `MicrophoneLevelMeterServiceTests`                                                   | `microphone-import.test.ts`                                                                                                                                                                            |
| `AudioImportServiceTests`                                                            | `microphone-import.test.ts`, `audio-runtime.test.ts`                                                                                                                                                   |
| `WindowsProcessInfoProviderTests`                                                    | Real-device run (`getProcessDetails` of itself, its parent, pid 0, version info) was checked by hand; the provider has no unit test because it needs Windows                                           |
| Worker, host, controller, handlers, contracts                                        | `audio-worker-rpc.test.ts`, `audio-worker-host-rpc.test.ts`, `audio-controller.test.ts`, `audio-handlers.test.ts`, `audio.test.ts`                                                                     |
| Native                                                                               | `cargo test`: silent packets, start timeout, channel average                                                                                                                                           |

**Real devices.** `VOZELLA_REAL_AUDIO=1 pnpm --filter @vozella/platform exec vitest run real-device` plays two generated tones (440 and 1000 Hz) from two PowerShell processes through the default speaker. Run on this machine (Windows build 26300): all 7 passed. Seen: build number and microphone list read; the playing process listed with a peak above zero; process capture of tone A heard 440 Hz and not 1000 Hz, 3.6 to 4.6 s for 4 s; system loopback with the real microphone on gave 14 or more frames of 3200 samples and the same duration rule, no source lost; killing the captured process raised the exit failure and stop kept a readable file; the idle preview opened and stopped; a 3 s 44.1 kHz stereo WAV imported through Media Foundation within 50 ms; junk bytes were refused with no file left. Not seen: a Windows 10 machine, a call app (Teams, Zoom, a browser), a headset hot swap, a long session, a microphone with more than two channels, an mp3 or m4a file (no encoder on this machine; Media Foundation read the WAV path only).

## Bugs fixed (section 7)

| Bug                                                                                                                      | Fix                                                                                      | Regression test                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1 failed start leaves a header-only file                                                                                | The abort path removes the file                                                          | `recording-service.test.ts` (C1), `audio-runtime.test.ts` (C1), `audio-worker-rpc.test.ts`   |
| C2 import does not downmix more than 2 channels                                                                          | Every channel is averaged                                                                | `wav-files.test.ts`, `audio-runtime.test.ts` (C2), Rust `averages_any_channel_count_to_mono` |
| C3 microphone with more than 2 channels fails                                                                            | Engine converts to stereo, then every channel is averaged. The mixer takes only mono     | Rust test above. Real >2 channel device not tried                                            |
| C4 level bar shows the mix                                                                                               | Microphone alone, silent with None or paused                                             | `recording-service.test.ts` (C4)                                                             |
| C5 no recovery of crashed recordings                                                                                     | Startup scan and repair                                                                  | `recover-recordings.test.ts`                                                                 |
| C7 no capability check                                                                                                   | Preflight with a clear error and a code                                                  | `recording-service.test.ts` (C7), `audio-runtime.test.ts` (C7), `audio-worker-rpc.test.ts`   |
| S1 exit of the captured app not noticed                                                                                  | Liveness poll in the capture thread                                                      | Real-device run. Stop reporting is in `native-audio-adapters.test.ts`                        |
| S4 overlapping preview starts leak a capture                                                                             | A generation counter stops the loser                                                     | `microphone-import.test.ts` (S4)                                                             |
| S8 culture-dependent ordering                                                                                            | Fixed collator                                                                           | `active-audio-apps.test.ts` (order)                                                          |
| S9 apps on a non-default output not listed                                                                               | Not fixed: same default-endpoint rule as the spec; recorded as a known limit             | none                                                                                         |
| S5 one COM enumerator leaked per call                                                                                    | Fixed by construction: each call drops its enumerator                                    | none                                                                                         |
| S12 one bad endpoint hides every microphone                                                                              | Each endpoint is read on its own and skipped on error; a failing list gives an empty one | `audio-controller.test.ts` (S12), `audio-runtime.test.ts`                                    |
| Found while porting: silent-flagged packets were copied as audio                                                         | Zeroed                                                                                   | Rust `silent_packets_read_as_zeros_and_others_are_kept`                                      |
| Found while porting: a stuck process-loopback activation froze the worker                                                | 12 s limit                                                                               | Rust `a_stuck_start_times_out_...`                                                           |
| Found while porting: the napi layer rejects `null` for an optional field, so a microphone start with no id failed        | The id is left out when absent                                                           | `native-audio-adapters.test.ts`. Found by the real-device run                                |
| Found while porting: the pump caught up without yielding, which would write silence over audio waiting in the event loop | It yields between chunks                                                                 | `recording-service.test.ts` (catch-up)                                                       |

Not fixed, kept as the spec describes: C6 (normalizer unused), S2 (default device change is not followed: the source is reported lost), S6, S7 (1024-character path buffer), S9, S10, S11, S13, S14 (a start can take up to 12 s; the page must show progress).

## User interface half

Code: `apps/desktop/src/renderer/features/audio/` (`SourcesPanel`, `MicrophoneSection`, `RecordingStatusLine`, hooks and `recording-status.ts`), `ui/Meter.tsx`, `ui/Select.tsx` (`onOpenChange`). Tests: `SourcesPanel.test.tsx`, `MicrophoneSection.test.tsx`, `RecordingStatusLine.test.tsx`, `recording-status.test.ts`, e2e `apps/desktop/e2e/audio-sources.spec.ts` (fake native build; `VOZELLA_FAKE_AUDIO_APPS` makes three fake apps play audio). Screenshots: `docs/port/screens/audio-capture/`.

Decisions made without anyone to ask:

1. **Sources is a quiet list, not tiles.** The meeting audio is a radio group in hairline rows (name, a tag, a thin meter), the way Notion lists properties. The selected row is the filled radio, not a color. Unavailable cards are dimmed and say "Not playing".
2. **App icons come from `app.getFileIcon`.** See item 131; the generic glyph is the fallback.
3. **The Import audio command is drawn, up to the WAV.** It picks, converts into the Inbox and says where the file went. The meeting record and the pipeline after it are the recording module's. (An earlier version left the button out; the audit was right that the user could not import.)
4. **The status line is mounted.** The Record page now records: Record, Pause, Resume and Stop go through `RecordingTakes` in main, which allocates `<Inbox>/<yyyy-MM-dd title>[ n].wav` (spec 3.3 rules, the Markdown counts as taken) and keeps the paused time. A take ends as a WAV in the Inbox with a line saying so; the meeting record, notes and transcription are the recording module's and replace that ending. Seen in the running app on the fake native build (`audio-take.spec.ts`, screenshot `record-recording-*.png`). Sources and Title are locked while a take runs, and the Sources microphone bar gives way to the status bar.
5. **The Record page microphone preview uses the same hook as Settings.** It runs while the page is active and the choice is not None, so the level bar is live before recording.
6. **One new string** for the code `process-loopback-unsupported`: `Ui_ProcessLoopbackUnsupported`, shown through `startFailureMessage` (the earlier note said two; a second label for a retry action had no user, so it was dropped). The recording module shows it.
7. **The Settings section is now `built`** in `SETTINGS_SECTIONS`.
8. **The microphone menu opens below the trigger** (`alignItemWithTrigger` off in `ui/Select.tsx`), so it no longer covers the label. This changes every select in the app.
9. **The Settings microphone section waits for both the saved id and the device list** before it starts the preview, so it never opens the default input first (`MicrophoneSection.test.tsx`).
10. **Strings:** one more, `Ui_TakeSaved` (en and es), for the line after a take. The Notes field was left unwired here and removed in the second follow-up (decision 12).
12. **No Notes field on the Record page** until the recording module can store it.
11. **Idle level curve.** See item 91, the idle level uses the same dB meter curve as the recording and app bars, because a raw RMS of speech sits near 0.05 and would barely move a thin bar. A deviation from spec 2.5 kept on purpose.

Not observed: a real microphone or real apps in the pages (the e2e uses the fake native build; the real-device proof is in the domain half), forced-colors rendering, a screen reader, Windows 10.

## Audit follow-up

An independent audit found five gaps and four design problems. All were real and are fixed:

- Import audio, recording status line and level bar, and the take controls (items 148, 149, 28, 33, 39, 49, 57, 60): the Record page now records and imports. Item 34 is half done: main keeps the paused time, the ASR clock skew waits for live transcription.
- Executable icons (131): done with `app.getFileIcon`; the earlier reason for dropping it was wrong.
- Activation failure text (67): the prefix and code are added in the Rust open path.
- Microphone menu position, the idle curve (now decision 11, item 91) and the Settings preview starting on the wrong device (decision 9).
- Dead Record button: no longer dead. The Notes field is still not wired, by decision 10.

Not observed: a real app icon for a real executable, a real failing process activation, and a recording on a real device in the new page (the e2e uses the fake native build).

## Second audit follow-up

- Item 37 (notice during start): fixed. The take now listens from the start call on; a fatal notice that arrives before the answer is kept and stops the take as soon as it is running, and a lost-source warning is kept in the status line hook across the start. Tests in `use-take.test.tsx` and `RecordRoute.test.tsx`.
- S14 / item 39 (progress while starting): fixed. The page shows `Ui_TakeStarting` (en and es) in phase starting.
- Item 129 (frozen meters): fixed on the page. While a take runs the Sources list draws every meter at zero, whatever state it last received, and hides the suggestion and fallback bars (design problem, same cause). Test in `SourcesPanel.test.tsx`.
- Notes field: decision 12, the field is removed from the Record page. It had no destination in the audio module and discarded input. The recording module adds it back with the meeting record. `RecordPage_SessionNotes.*` strings stay in the catalog.
- Real executable icons: unchanged, still `pending-real-validation`. Not a defect.

Not observed: the new start line and the zeroed meters in a refreshed screenshot of a real device.

## Left for other modules

- **User interface half:** done.
- **Recording module:** replace the end of a take (a WAV in the Inbox) with the meeting record and the pipeline: `RecordingTakes.stop` and `importPicked` are the seams. Read frames with `onRecordingFrame` for live ASR and apply `pausedSeconds` as the clock skew (34), and call `repairWavFile` before transcribing any WAV.
- **Calendar and others:** nothing.
- **Pending real validation:** Windows 10 builds 19041 to 20347 for process capture; real Teams, Zoom and browser calls; headset hot swap and long-session drift; a microphone with more than two channels; mp3, m4a and other Media Foundation formats; packaged builds of the addon.

## Audit round 2

Fixed, with tests:

- **Take survives leaving the Record page (33, 49, 57, 60):** new channel `audio.recording.state`; `useTake` asks main on mount and picks up `recording` or `paused`, so Stop, Pause, Resume and the failure notice work again. Tests: `use-take.test.tsx` (3 cases), `audio-handlers.test.ts`.
- **92 Settings preview during a take:** main refuses `audio.preview.start` while a take is busy, covering both pages. Test: `audio-handlers.test.ts`.
- **Stale pick race in `useMicrophones`:** `choose` bumps the reload generation. Tests: `use-microphones.test.tsx` (also covers 100 and 102).
- **C4 frozen bar while paused:** the Meter shows 0 while paused. Test: `RecordingStatusLine.test.tsx`.
- **Level window stale across start, stop, pause, resume:** reset on each. Test: `recording-service.test.ts`.
- **36, 42, 35 proof:** tests added for the pump cancel published before devices start (RED observed with the assignment removed), teardown order, and throwing mic/output stop plus removal during an aborted start.
- **47:** worker shutdown with a recording running finalizes the file (`audio-worker-rpc.test.ts`).
- **153, 154:** IEEE float repair, block align 0, empty data (`wav-format.test.ts`).
- **S7:** the executable path buffer is 32768 wide. No unit test (Windows API only); pending real validation.

Rejected or deferred, with the reason:

- **S2 (default device change):** the C# app also reports the source lost, and the user can stop and record again. Re-opening mid-take needs a native re-open path and a seam in the mixer; deferred to a later module, the lost-source warning stays.
- **S6, S9, S11:** the identity of an app is its exe path and the session list comes from the default endpoint, as in C#. Changing roll-up rules or enumerating every endpoint changes what the picker lists and needs a real multi-device run; there is none here. S11: two instances of one exe cannot be told apart after a restart, so the first one is kept deterministically.
- **Rust tests for 82, 83, 85, 115, 117, S12, and >2 channel capture (15, C2):** they need real COM endpoints; the crate has no fake. Left as pending-real-validation. The downmix itself is covered by the resampler test.
- **34 (pause skew to the live pass):** the live pass has no clock skew input and the accumulator dropped ClockSkew on purpose, so the value is returned but unused. Decision: not applied.
- **148, 39 preview restart after a failed start/import:** follows from `active={idle}`, already covered by the idle toggle test; no extra test added.
- **Design notes (signal red, existing em dash keys, `processId` max, mainProcessId fallback):** not changed in this round; the em dash keys belong to other modules.
- **Screenshots:** all of docs/port/screens/audio-capture were regenerated from the current build (no Notes field, zeroed meters while recording). Signal red for live recording was not applied here.

## Independent audit, round 2

Fixed, with the test that proves each:

- **57, 56, 60 notices while another page is open:** main keeps the notices of the running take (`AudioController.pendingNotices`, cleared on start and stop) and `audio.recording.state` returns them. On return the Record page stops the take on the first output or writer failure and shows lost-source warnings again. Tests: `audio-controller.test.ts` (57), `audio-handlers.test.ts`, `use-take.test.tsx` (57, 56). Decision: the take is stopped when the user comes back, not while the page is away, because the stop flow and its message live in the page.
- **Pump started before devices opened:** the pump now starts after both sources are open, as in C#, so a slow activation no longer writes a silent prefix. Test: `recording-service.test.ts` "the pump starts only after the devices are open".
- **26, 30, 28, 43, 45:** order of write and frame, the 50 ms paused sleep (the test clock now records sleeps), empty microphone frames, first error kept, failure precedence with all stored failures cleared. Item 25 (2 byte rule) cannot be reached: chunks are always 6400 bytes; the guard stays as a defence.
- **S6:** a differently named helper under a known browser or meeting app rolls up into that app (`active-audio-apps.test.ts`). Other cross-image parents still stop the climb. Supersedes the earlier "not fixed".
- **121, S11:** depth cap test with a 42 long chain; restoreApp picks the first match in list order (test).
- **S9:** `SessionMonitor` reads every active render endpoint, falling back to the default one. No Rust test (COM); pending real validation.
- **76:** every start failure of a process capture, and a failed `start_stream`, now rejects Start with "Process loopback capture failed to start: 0x... ". `start_stream` runs before `ready`. Rust test for the text; pending real validation for the stages.
- **78:** the TS adapter reports a stop once per capture (test). The Rust side relies on `FnOnce`.
- **81:** Rust tests for `is_alive` (self alive, killed child dead, unreadable process counts as alive).
- **82, 83, 85, S12:** selection rules moved out of COM (`keep_active`, `pick_microphone`) with Rust tests: inactive and unreadable endpoints skipped without hiding others, empty or stale id falls back to the default. 84 holds by construction: recording and preview both call `open`.
- **S7:** `IMAGE_NAME_CHARS` and `image_name` with a Rust test on a 2000 character path.
- **165:** `parseMainProcessId` throws on a missing or invalid `VOZELLA_MAIN_PID` instead of using 0; a worker test shows the main pid hides its own audio.
- **157:** tests for the length-changed refusal and for a file over 4 GiB through `repairWavFile`.
- **93, 96, 102, 133:** tests for preview restart after the panel goes idle again, for a pick restarting the preview and a re-pick doing nothing, and for card node identity across refresh and reorder. 102 fixed: a picked device falls back to System default when a later load fails.

Rejected or still open, with the reason:

- **C3 / item 15 (more than 2 channels):** capture asks WASAPI for stereo with autoconvert, so the OS mixes channels; no code path of ours sees more than 2. Not testable without a multichannel device. Stays pending real validation; the Rust test cited earlier covers the downmixer only (the import path, C2).
- **S2 (default device change):** still not followed. No endpoint-change notification is wired, and the lost-source path is not shown to fire on an endpoint change. Open item; needs a native re-open path.
- **S5:** Rust drops the enumerator per call; no test is possible for COM release. Claim stays unverified.
- **S10:** a zero data size cannot tell audio from a trailing chunk without parsing PCM, so no safe one-line guard exists. Mitigation: the app writes no trailing chunks. Open risk now that startup recovery scans the meetings folder.
- **115, 116 (Rust):** re-resolution per call and error swallowing are in code; no COM fake. Pending real validation.
- **161, C5 wiring, 63, 65, 70, 77, 80:** unchanged. 161 and 63/65/70 depend on the gated real-device run; 77 and 80 are native thread behaviour without a test seam.
- **Item 33:** C# always shows the paused text; the port shows an active warning over it while paused. Kept on purpose: the warning is still true while paused.
- **Design notes (signal red, date row in the live preview, placeholder app icons, menu covering labels, scrolled Settings shot, existing em dashes):** not changed; the screenshots come from fake executables and fixtures. `audio-screens.spec.ts` is opt-in and was not re-run.
