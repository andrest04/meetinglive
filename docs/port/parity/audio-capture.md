# Parity ledger: audio-capture (domain and integration half)

Spec: `docs/port/specs/audio-capture.md`. Section 8 has 165 items; every one is below. This ledger covers the domain and integration half: capture, mixing, WAV files, devices, levels, app sessions, import, and the main-process handlers. The Record page, the Settings microphone section and the strings they need are the user interface half.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped` (reason given), `pending-real-validation` (what is needed). Two more mark work that belongs to another half and has its data ready: `open-ui` (the user interface half draws or wires it) and `open-recording` (the recording module calls it).

## Where things are

| Concern | Code |
| --- | --- |
| Capture request, validation, failure predicates | `packages/core/src/audio-capture/capture-sources.ts` |
| Recording service (start, pause, stop, pump, failures) | `audio-capture/recording-service.ts` |
| Mixer and 5 s source buffers | `audio-capture/mixer.ts` |
| WAV header, flush cadence, repair analysis, duration | `audio-capture/wav-format.ts` |
| Level curve, RMS, normalizer | `audio-capture/level-meter.ts` |
| Active app discovery | `audio-capture/active-audio-apps.ts` |
| Picker merge, still-running check, suggestion, remembered choices | `audio-capture/source-picker.ts` |
| Microphone options and the picker model (cards, selection, fallback) | `audio-capture/record-sources.ts` |
| Idle microphone preview | `audio-capture/microphone-preview.ts` |
| Import | `audio-capture/import-service.ts` |
| Device ports, Windows build gate | `audio-capture/ports.ts` |
| Test doubles for the recording service | `audio-capture/recording-test-kit.ts` |
| Native: capture thread, stop reporting, app exit, silent packets | `native/vozella-native/src/audio/capture.rs`, `binding.rs` |
| Native: microphones and render sessions | `src/audio/devices.rs` |
| Native: process details, version info, Windows build | `src/audio/process.rs` |
| Native: Media Foundation decode | `src/audio/decode.rs` |
| Adapters, WAV file writer, repair, startup recovery, runtime wiring | `packages/platform/src/native/native-adapters.ts`, `src/audio/` |
| Fakes | `packages/platform/src/fakes/fake-audio-capture.ts`, `fake-audio-devices.ts`, `audio/wav-file-decoder.ts` |
| Worker messages and page channels | `packages/contracts/src/workers.ts`, `audio.ts` |
| Audio worker (rpc, pushes) | `apps/desktop/src/workers/audio/audio-worker-core.ts` |
| Main-side worker host (calls, pushes, restart notice) | `apps/desktop/src/main/workers/audio-worker-host.ts` |
| Controller (picker polling, microphone list, recording, import) | `apps/desktop/src/main/audio/audio-controller.ts` |
| Handlers | `apps/desktop/src/main/ipc/audio-handlers.ts` |
| Real-device proof | `packages/platform/src/audio/real-device.integration.test.ts` |

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

| # | Status | Note |
| --- | --- | --- |
| 1 | done | `RecordingCaptureSources`, `capture-sources.test.ts` |
| 2 | done | Two factories and `assertValidCaptureSources` |
| 3 | done | Exact message, `CaptureSourcesError` with `param` and `kind` |
| 4 | done | Out-of-range error before any device; service test checks no session opened |
| 5 | done | Exact message |
| 6 | done | `effectiveMicrophoneId`; the service test opens no mic when it is off |
| 7 | done | `legacyCaptureSources`. TypeScript has no overloads, so there is only the helper |
| 8 | done | Validation is the first line of `start` |
| 9 | done | Also during a stop; test covers both |

### Mixing and file output

| # | Status | Note |
| --- | --- | --- |
| 10 | done | Float mix at 16 kHz mono, PCM16 file |
| 11 | done | Mic optional, exactly one output |
| 12 | done | `MixerInput`: drop on overflow, zeros on underrun, tested at the 5 s limit |
| 13 | done | Done in Rust (`Downsampler48to16` averages channels). Rust test `averages_any_channel_count_to_mono` |
| 14 | done | Own 63-tap Blackman windowed-sinc low-pass and 3:1 decimation replaces the WDL resampler. Spike measured tone level and alias rejection |
| 15 | improved | C3. The WASAPI client is asked for stereo with auto conversion, then every channel is averaged. No more-than-2-channel microphone was available here: `pending-real-validation` for such a device |
| 16 | done | Sum, clamp, scale by 32767, rounded (not truncated). One LSB at most from the NAudio path |
| 17 | done | 6400-byte chunks |
| 18 | done | Pacing test with a manual clock; real-device run: 3 s of recording gave a 2.6 to 3.6 s file |
| 19 | done | Silence on an empty buffer, tested |
| 20 | done | No sleep when behind, but a turn of the event loop between chunks so arrived audio reaches the buffers first (tested both ways) |
| 21 | done | Every 160000 bytes, counted from the last flush; IO error ignored |
| 22 | done | Counts written bytes; tested across a pause |
| 23 | done | `WavFileWriter` creates the file at start and closes it at stop |

### Live frames

| # | Status | Note |
| --- | --- | --- |
| 24 | done | `PcmFrame` float32 (int16 / 32768), 16000 Hz, 3200 samples |
| 25 | done | Only with a listener and at least 2 bytes |
| 26 | done | After the write |
| 27 | done | A throwing listener becomes a pump fault, kept for stop |
| 28 | improved | C4 decision above. The percent is computed in the worker and clamped in main; empty frames are ignored |

### Pause and resume

| # | Status | Note |
| --- | --- | --- |
| 29 | done | No-op when not recording |
| 30 | done | Drain, 50 ms sleep, nothing written, no frame, no flush |
| 31 | done | Real-time test: 0.5 s, 1 s pause, 0.5 s gave under 1.6 s |
| 32 | done | |
| 33 | open-ui | Status text and warning precedence are the page's. The service emits the data |
| 34 | open-recording | The recording module keeps the paused duration and sets the ASR clock skew |

### Start failure handling

| # | Status | Note |
| --- | --- | --- |
| 35 | done | Every step guarded, original error rethrown |
| 36 | done | The cancel source exists before any device starts |
| 37 | done | Listeners are set before `start`; events during start are delivered; `isRecording` is true only when `start` resolves |
| 38 | improved | C1. The abort removes the file. Tests in core, runtime and worker |
| 39 | open-ui | Message and restarting the preview are the page's. `startRecording` already stops the preview |

### Stop

| # | Status | Note |
| --- | --- | --- |
| 40 | done | One task shared by all callers, same outcome |
| 41 | done | |
| 42 | done | Order as in the spec |
| 43 | done | First error kept |
| 44 | done | `repairWav` runs when flush or close failed |
| 45 | done | Pump failure, else output failure, else teardown error; all cleared |
| 46 | done | |
| 47 | done | No synchronous stop exists. The worker's shutdown stops the recording and swallows errors |
| 48 | done | |
| 49 | open-recording | Detaching handlers and showing the error are the caller's |

### Failure classification

| # | Status | Note |
| --- | --- | --- |
| 50 | done | `isSourceLost` |
| 51 | done | `shouldSurfaceOutputFailure` |
| 52 | done | |
| 53 | done | |
| 54 | done | Never below zero |
| 55 | done | |
| 56 | done | The service does not stop itself |
| 57 | open-recording | `audio.recording.notice` carries `output-failed` and `faulted`; the first one handled is the caller's rule |
| 58 | open-ui | The notice carries `source` and `remaining` |
| 59 | open-ui | Never replaced is a rule of the status line |
| 60 | open-ui | |
| 61 | done | The five message keys exist in both catalogs already. This half adds no string |

### Process-tree loopback

Activation, the 12-byte blob, the property variant and the wait are inside the `wasapi` 0.26 crate (`AudioClient::new_application_loopback_client`), which builds the same structures. Isolation of one process from another was proved in the real-device run.

| # | Status | Note |
| --- | --- | --- |
| 62 | done | Pid 0 is rejected by the capture request before any native call |
| 63 | done | The crate fills `AUDIOCLIENT_ACTIVATION_PARAMS` with type process loopback, the pid and include-tree. Behavior shown by the real run: tone A captured at over 0.05 amplitude, tone B under a tenth of it |
| 64 | done | The crate keeps the blob and the variant alive until the wait ends |
| 65 | done | `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` with `IAudioClient` |
| 66 | improved | The crate waits without a limit. The start now waits 12 s on the capture thread, then fails with "Process loopback activation did not finish within 12 seconds." and tells the thread to stop. Rust test with a short timeout. The 10 s inner timeout is not separate |
| 67 | dropped | The crate returns the Windows error; the text is not the C# one. The HRESULT is in the Windows message |
| 68 | dropped | The crate owns the completion handler; a late result after our timeout is released with the thread when it ends. Cannot be forced from a test |
| 69 | improved | The stream asks for 48 kHz 32-bit float stereo with auto conversion (what the spike proved), not 16-bit |
| 70 | done | Shared mode, event callback, auto convert, loopback, zero buffer duration |
| 71 | improved | Waits 20 ms for the buffer event and drains all packets, so frames stay 20 ms |
| 72 | improved | The crate copies a silent-flagged packet as it is. The capture now zeroes it (Rust test). Counted in stats |
| 73 | done | The crate releases the buffer after copying |
| 74 | done | A throwing JavaScript callback is on the Node side, not on the capture thread (non-blocking call) |
| 75 | done | `onStopped(error)` |
| 76 | improved | The 12 s start wait above replaces the separate 5 s start wait; a failed start returns the Windows error |
| 77 | done | Flag, join, COM left by thread exit. No 5 s join limit |
| 78 | done | The stop callback is a one-shot; a second `stop()` returns empty stats |
| 79 | done | The service opens exactly one output |
| 80 | done | `initialize_mta` result ignored |
| 81 | improved | S1 above. Real run: a captured process was killed and `onOutputCaptureFailed` fired with "the captured application exited", then stop kept a readable file |

### Microphone list and resolution

| # | Status | Note |
| --- | --- | --- |
| 82 | done | `listMicrophones`: active endpoints with id and friendly name |
| 83 | done | `resolve_microphone` |
| 84 | done | Recording and preview both go through `startCapture` with the same resolver |
| 85 | done | A stale id falls back to the default; only "no default" fails |

### Microphone preview

| # | Status | Note |
| --- | --- | --- |
| 86 | done | |
| 87 | done | Never throws; later start works |
| 88 | done | |
| 89 | done | Level 0 on a device that stops itself |
| 90 | improved | The native capture delivers PCM16 only, so the live path is int16 / 32768. `computeBufferRms` still reads float32 and int32 and returns 0 for other depths, with tests, for the contract. Clamped to [0, 1] |
| 91 | done | Worker throttles to ten per second, main clamps to 0..100. The page marshals |
| 92 | open-ui | |
| 93 | open-ui | `startRecording` and `importAudio` stop the preview |

### Settings microphone picker

| # | Status | Note |
| --- | --- | --- |
| 94 | open-ui | `audio.microphones.load` returns the devices; the sentinel is the page's |
| 95 | open-ui | |
| 96 | open-ui | Save through `settings.update({ selectedMicrophoneDeviceId })` |
| 97 | open-ui | |
| 98 | open-ui | `audio.preview.stop` |

### Record page microphone choice

| # | Status | Note |
| --- | --- | --- |
| 99 | done | Options in order; labels are the page's |
| 100 | open-ui | `sameMicrophoneOptions` and `selectMicrophoneAfterReload` are ready |
| 101 | done | |
| 102 | open-ui | A stale reload is the page's generation check. Load errors give an empty list in main (tested) |
| 103 | done | `buildCaptureSources` |
| 104 | open-ui | |

### Remembered choices

| # | Status | Note |
| --- | --- | --- |
| 105 | done | |
| 106 | done | |
| 107 | done | |
| 108 | done | |
| 109 | done | |
| 110 | done | Exact comparison |
| 111 | done | Path comparison ignores case; live pid returned |
| 112 | done | |
| 113 | done | Once per start of the poller, only if the user has not picked |
| 114 | improved | Decision 8 |

### Active app discovery

| # | Status | Note |
| --- | --- | --- |
| 115 | done | `SessionMonitor.enumerate` resolves the default render endpoint every call |
| 116 | done | Any error gives an empty list |
| 117 | done | System sounds by session identifier, and pid 0 |
| 118 | done | Strictly greater than 0.001 |
| 119 | done | |
| 120 | done | Checked on the process and on its root |
| 121 | done | |
| 122 | done | |
| 123 | done | |
| 124 | done | |
| 125 | done | |
| 126 | done | |
| 127 | improved | S8, decision 7 |
| 128 | done | |
| 129 | done | Controller loop; stale generations dropped; errors end it. Runs only while the page asks for it, and not during a recording |

### Picker cards

| # | Status | Note |
| --- | --- | --- |
| 130 | open-ui | State: the system card is first, always there, selected by default, level 0 |
| 131 | open-ui | State has the app, its flags and the level. Icons need a new native call, see Left for other modules |
| 132 | done | State; unavailable card keeps its place and reads 0 |
| 133 | open-ui | Cards carry the pid as a key |
| 134 | done | `noAppsPlaying` |
| 135 | done | `select` remembers and clears the fallback; programmatic restore does not remember |
| 136 | done | Checked against the current process image through the worker |
| 137 | done | |
| 138 | done | |
| 139 | done | Decision 10 |

### Import

| # | Status | Note |
| --- | --- | --- |
| 140 | done | `IMPORT_EXTENSIONS` and the dialog filter |
| 141 | done | `importRecordedAt` |
| 142 | done | |
| 143 | done | |
| 144 | improved | C2. Real run: 44.1 kHz stereo gave 16 kHz mono PCM16, duration within 50 ms, 440 Hz tone intact |
| 145 | done | |
| 146 | done | Checked after each buffer, with a yield, so a message can arrive |
| 147 | done | |
| 148 | open-recording | The command, the status and the error text belong to the recording page. `audio.import.pickFile`, `importAudio` and the preview stop are ready |
| 149 | open-recording | `readWavDurationSeconds` returns the length |

### WAV utilities

| # | Status | Note |
| --- | --- | --- |
| 150 | done | `readWavFileInfo`, `readWavDurationSeconds`. Blank path throws; zero sizes throw |
| 151 | done | |
| 152 | done | 16 and 18 byte fmt, extra chunks, word alignment |
| 153 | done | |
| 154 | done | |
| 155 | done | |
| 156 | done | Bytes and last-write time unchanged |
| 157 | done | The length check is in place and 4 GiB is tested in the analysis. The length-changed race has no test: it cannot be forced without a second writer |
| 158 | improved | C5. `recoverCrashedRecordings` runs at startup in the background over the meetings folder. The call before transcription belongs to the transcription module |

### Level helpers

| # | Status | Note |
| --- | --- | --- |
| 159 | done | |
| 160 | done | Constants and rules kept and tested, not wired in (C6) |
| 161 | done | Nothing calls it |

### Platform

| # | Status | Note |
| --- | --- | --- |
| 162 | done | `AudioCapturePort`, `MicrophoneDeviceSource`, `AudioSessionSource`, `ProcessInfoProvider`, `OsBuildProbe`, decoder |
| 163 | done | Only `native/` and the adapters know Windows |
| 164 | improved | C7, decision 4 |
| 165 | done | Decision 11 |

## Tests

| Spec section 6 group | Where |
| --- | --- |
| `AudioCaptureServiceTests` (all 18 cases) | `recording-service.test.ts` plus pause, mixing, flush and catch-up cases the spec lists as uncovered |
| `RecordingCaptureSourcesTests` | `capture-sources.test.ts`. The activation blob and property variant tests are inside the crate, shown by the real-device isolation test |
| `ActiveAudioAppServiceTests` | `active-audio-apps.test.ts` |
| `ActiveAppEntriesTests`, `MeetingAppSuggestionTests`, `RecordAudioSourceMemoryTests` | `record-sources.test.ts`. The JSON round trip of the settings is covered by the library settings tests |
| `AudioLevelMeterTests`, `PcmLevelNormalizerTests` | `level-meter.test.ts` |
| `WavHeaderRepairTests`, `WavHeaderFlushCadenceTests` | `wav-format.test.ts` (pure) and `packages/platform/src/audio/wav-files.test.ts` (files). A file locked by a writer is not reproducible: Node opens files with shared access, so that case is `dropped` |
| `MicrophoneLevelMeterServiceTests` | `microphone-import.test.ts` |
| `AudioImportServiceTests` | `microphone-import.test.ts`, `audio-runtime.test.ts` |
| `WindowsProcessInfoProviderTests` | Real-device run (`getProcessDetails` of itself, its parent, pid 0, version info) was checked by hand; the provider has no unit test because it needs Windows |
| Worker, host, controller, handlers, contracts | `audio-worker-rpc.test.ts`, `audio-worker-host-rpc.test.ts`, `audio-controller.test.ts`, `audio-handlers.test.ts`, `audio.test.ts` |
| Native | `cargo test`: silent packets, start timeout, channel average |

**Real devices.** `VOZELLA_REAL_AUDIO=1 pnpm --filter @vozella/platform exec vitest run real-device` plays two generated tones (440 and 1000 Hz) from two PowerShell processes through the default speaker. Run on this machine (Windows build 26300): all 7 passed. Seen: build number and microphone list read; the playing process listed with a peak above zero; process capture of tone A heard 440 Hz and not 1000 Hz, 3.6 to 4.6 s for 4 s; system loopback with the real microphone on gave 14 or more frames of 3200 samples and the same duration rule, no source lost; killing the captured process raised the exit failure and stop kept a readable file; the idle preview opened and stopped; a 3 s 44.1 kHz stereo WAV imported through Media Foundation within 50 ms; junk bytes were refused with no file left. Not seen: a Windows 10 machine, a call app (Teams, Zoom, a browser), a headset hot swap, a long session, a microphone with more than two channels, an mp3 or m4a file (no encoder on this machine; Media Foundation read the WAV path only).

## Bugs fixed (section 7)

| Bug | Fix | Regression test |
| --- | --- | --- |
| C1 failed start leaves a header-only file | The abort path removes the file | `recording-service.test.ts` (C1), `audio-runtime.test.ts` (C1), `audio-worker-rpc.test.ts` |
| C2 import does not downmix more than 2 channels | Every channel is averaged | `wav-files.test.ts`, `audio-runtime.test.ts` (C2), Rust `averages_any_channel_count_to_mono` |
| C3 microphone with more than 2 channels fails | Engine converts to stereo, then every channel is averaged. The mixer takes only mono | Rust test above. Real >2 channel device not tried |
| C4 level bar shows the mix | Microphone alone, silent with None or paused | `recording-service.test.ts` (C4) |
| C5 no recovery of crashed recordings | Startup scan and repair | `recover-recordings.test.ts` |
| C7 no capability check | Preflight with a clear error and a code | `recording-service.test.ts` (C7), `audio-runtime.test.ts` (C7), `audio-worker-rpc.test.ts` |
| S1 exit of the captured app not noticed | Liveness poll in the capture thread | Real-device run. Stop reporting is in `native-audio-adapters.test.ts` |
| S4 overlapping preview starts leak a capture | A generation counter stops the loser | `microphone-import.test.ts` (S4) |
| S8 culture-dependent ordering | Fixed collator | `active-audio-apps.test.ts` (order) |
| S9 apps on a non-default output not listed | Not fixed: same default-endpoint rule as the spec; recorded as a known limit | none |
| S5 one COM enumerator leaked per call | Fixed by construction: each call drops its enumerator | none |
| S12 one bad endpoint hides every microphone | Each endpoint is read on its own and skipped on error; a failing list gives an empty one | `audio-controller.test.ts` (S12), `audio-runtime.test.ts` |
| Found while porting: silent-flagged packets were copied as audio | Zeroed | Rust `silent_packets_read_as_zeros_and_others_are_kept` |
| Found while porting: a stuck process-loopback activation froze the worker | 12 s limit | Rust `a_stuck_start_times_out_...` |
| Found while porting: the napi layer rejects `null` for an optional field, so a microphone start with no id failed | The id is left out when absent | `native-audio-adapters.test.ts`. Found by the real-device run |
| Found while porting: the pump caught up without yielding, which would write silence over audio waiting in the event loop | It yields between chunks | `recording-service.test.ts` (catch-up) |

Not fixed, kept as the spec describes: C6 (normalizer unused), S2 (default device change is not followed: the source is reported lost), S6, S7 (1024-character path buffer), S9, S10, S11, S13, S14 (a start can take up to 12 s; the page must show progress).

## Left for other modules

- **User interface half:** the Record page Sources card (microphone combo and its reload rules, cards, tags, hint, fallback bar, suggestion bar, summary line), the status line and the warning precedence (items 33, 58 to 60), the recording level bar, the Settings microphone section with its level bar (94 to 98), the page-side preview start and stop rules (92, 93), the stale-reload check (102). New strings are not needed: the keys listed in the spec exist in both catalogs. The refusal for an old Windows has `code: 'process-loopback-unsupported'` and an English message; the page should show its own words for that code, which needs two new keys (en and es).
- **Recording module:** allocate the path, call `AudioController.startRecording/pause/resume/stop`, read frames with `onRecordingFrame` for live ASR, hold the paused duration for the clock skew (34), react to `audio.recording.notice` (57, 49), run the import command and its pipeline (148, 149), and call `repairWavFile` before transcribing any WAV.
- **Icons for app cards:** `AppIconCache` is outside this module. It needs a native call that returns an executable's icon; cards carry `exePath` for it.
- **Calendar and others:** nothing.
- **Pending real validation:** Windows 10 builds 19041 to 20347 for process capture; real Teams, Zoom and browser calls; headset hot swap and long-session drift; a microphone with more than two channels; mp3, m4a and other Media Foundation formats; packaged builds of the addon.
