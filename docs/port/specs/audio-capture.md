# Spec: audio-capture

Source of truth: `MeetingLive.Core` and `MeetingLive.App` at branch `feat/electron-port`. Every number, string and rule below was read from the C# code or from NAudio 2.2.1 behavior checked directly. File references use `path:line`.

Conventions. "Pump" is the thread that mixes sources and writes the WAV. "Output" is the meeting side (system loopback or one process tree). "Mic" is the microphone. "Mix format" is 16 kHz, mono. String keys are `.resw` resource names (en-us / es).

---

## 1. Purpose

The module records a meeting to disk and exposes what the rest of the app needs while recording.

1. Capture the microphone (optional) and exactly one meeting-audio output (all system audio, or one application's process tree), mix them to a single 16 kHz mono stream, and write it to a 16-bit PCM WAV file.
2. Raise the same mixed stream as float32 frames so live streaming ASR and the on-screen level bar can consume it.
3. Support pause and resume without recording the break.
4. Survive partial failure: a lost source degrades to the remaining source with a warning; a dead file writer or a dead process-tree capture ends the recording but keeps the audio already written readable.
5. List microphones, preview a microphone's level before recording, and remember the user's microphone and output choice between sessions.
6. Discover which applications are producing audio right now, group helper processes under their app root, and report a live peak per app.
7. Import an existing audio file and convert it to the same 16 kHz mono PCM16 WAV that live recording produces.
8. Repair WAV files whose RIFF and data sizes were never written because the process died.
9. Read a WAV file's duration.

Downstream contract: everything that leaves this module as a file is `16000 Hz, 1 channel, 16 bit PCM WAV` (the format the Nemotron ASR expects). Everything that leaves as live frames is `float32[]` in [-1, 1) plus a sample rate (always 16000).

---

## 2. User-facing features

### 2.1 Choosing what to record (Record page "Sources" card)

Heading `RecordPage_SourcesHeading.Text` = "Sources" / "Fuentes".

Two independent choices.

**Microphone** (combo, header `ComboRecordMicrophone.Header` = "Microphone" / "Micrófono"; automation name `ComboRecordMicrophone.AutomationProperties.Name`).

Items, always in this order:

1. `RecordPage_MicrophoneNone` = "None" / "Ninguno". Kind `None`. Capture microphone = false.
2. `Microphone_SystemDefault` = "System default" / "Predeterminado del sistema". Kind `SystemDefault`. Capture microphone = true with no device id (OS default input).
3. One item per active capture endpoint, in enumeration order, label = endpoint friendly name, kind `Device`, carries the endpoint id. Devices with an empty id are skipped (`RecordingPageViewModel.cs:2035`).

Behavior:

- The list reloads when the page is shown (`OnNavigatedTo`, `RecordingPageViewModel.cs:331`, `preserveCurrent` is true if the user already touched the combo) and every time the dropdown opens (`RefreshRecordingMicrophones`, line 2017).
- When a reload yields an identical list (same kind, device id and display name per index and same count), the existing items are kept so the open dropdown does not close (`SameMicrophoneChoices`, line 2071). If the idle preview is not running it is restarted in that case.
- Selection after a reload: if the user already chose something on this page (`preserveCurrent`), keep that choice; a `Device` choice whose device vanished falls back to System default (never None). Otherwise use the remembered choice (see 2.6).
- A programmatic change while rebuilding the list is not saved back (`_suppressRecordingSourceCommit`, released on the next dispatcher turn).
- A user pick sets "touched", stores the selection and saves it (2.6). Picking the already-selected object is ignored.
- Reload generation guard: a stale async reload (generation changed or page hidden) is dropped (`RecordingPageViewModel.cs:1988`). Any exception while loading settings or devices yields an empty device list (only None and System default remain).

**Meeting audio** (cards, 2.4): "All system audio" plus one card per app currently playing audio.

Summary line `RecordPage_SourcesSummary` = "Mic: {0} · Audio: {1}" / "Micrófono: {0} · Audio: {1}". {0} = selected microphone display name (falls back to "System default" when nothing is selected), {1} = "All system audio" or the selected app's name. Refreshed whenever the microphone or the card selection changes.

Building the capture request when Record is pressed (`CreateCaptureSourcesOrShowError`, line 2155):

- `captureMicrophone` = the selected microphone is not `None`.
- `deviceId` = the id only when kind is `Device` and the id is non-empty, otherwise null (null with capture enabled means OS default).
- Output: `AudioSources.ResolveRecordingTarget()` (2.4). A non-null pid gives `ProcessTree(captureMicrophone, deviceId, pid)`, null gives `SystemLoopback(captureMicrophone, deviceId)`.

### 2.2 Recording

Status line while recording (`RecordingStatusText`, line 2167). If a source-lost warning is active it wins and shows that warning (so a resume from pause does not erase it). Otherwise:

| Mic | Output | Key | en | es |
|---|---|---|---|---|
| on | all system | `Status_Recording` | Recording... mic + system audio. | Grabando... micrófono + audio del sistema. |
| none | all system | `Status_RecordingNoMic` | Recording... system audio only. | Grabando... solo audio del sistema. |
| on | app X | `Status_RecordingMicApp` | Recording... mic + {0}. | Grabando... micrófono + {0}. |
| none | app X | `Status_RecordingNoMicApp` | Recording... {0} only. | Grabando... solo {0}. |

{0} = selected app's name.

Start sequence as seen by the capture module (`RecordingPageViewModel.cs:1259-1300`):

1. The caller subscribes to `OutputCaptureFailed`, `CaptureFaulted`, `CaptureSourceLost`, `PcmFrameAvailable` before calling Start, resets its failure flags, and calls `Start(path, sources)` on a worker thread.
2. After Start returns, if a failure was already notified in the gap, the caller immediately runs the stop path; otherwise it shows the status text above.
3. If Start throws, the caller detaches the handlers, stops live transcription if it had started, shows `Error_StartRecording` = "Error: could not start recording ({0})." / "Error: no se pudo iniciar la grabación ({0})." with `{0}` = exception message, and restarts the idle mic preview. It does not delete the WAV file Start may have created (bug C1).
4. The idle microphone preview is stopped before Start (`StopMicPreview`).

Start preconditions and errors (`AudioCaptureService.Start`, line 92):

- `sources` null throws `ArgumentNullException`; invalid `sources` throws (2.2.1).
- Already recording throws `InvalidOperationException("A recording is already in progress.")`. `IsRecording` stays true during stop teardown, so Start during a stop also throws this.
- Any failure while opening devices or the file tears down everything opened so far and rethrows the original exception (2.2.2).

#### 2.2.1 Capture request validation (`RecordingCaptureSources`)

Fields: `captureMicrophone: bool`, `microphoneDeviceId: string|null`, `output: SystemLoopback(0) | ProcessTree(1)`, `processId: uint32`.

Rules, enforced in the constructor and again in `ThrowIfInvalid` (called at the top of Start):

- `output` not one of the two defined values: `ArgumentException("Output must be exactly system loopback or one process tree.")`, parameter `Output`.
- `ProcessTree` with pid 0: `ArgumentOutOfRangeException`, param `processId`, message "Process id 0 is not a valid capture target.".
- `SystemLoopback` with pid != 0: `ArgumentException("System loopback cannot also target a process.")`, param `processId`.
- Null or empty device id with `captureMicrophone = true` is the OS default, not "no microphone". `captureMicrophone = false` ignores the device id entirely.
- Factories: `SystemLoopback(captureMicrophone, deviceId)` uses pid 0; `ProcessTree(captureMicrophone, deviceId, pid)`.
- `UsesSystemLoopback` = output is `SystemLoopback`.
- The legacy overload `Start(path, microphoneDeviceId = null)` is `SystemLoopback(captureMicrophone: true, id)`.

#### 2.2.2 What Start does, in order (`AudioCaptureService.cs:92-160`)

1. Validate. Throw if already recording.
2. Reset: paused = false, userStop = false, outputFailure = null, pumpFailure = null, `outputIsProcessCapture = !UsesSystemLoopback`, `liveSources = captureMicrophone ? 2 : 1`.
3. Create an empty mixer (float, 16000 Hz, mono).
4. If microphone requested: create the mic capture for the device id (resolver, 3.1.4); give it a 5-second buffer; on data append bytes to the buffer; subscribe to its stopped event; add its converted stream to the mixer.
5. Create exactly one output capture: system loopback of the default render device, or a process-tree loopback of the pid. Never both. Same buffer, data and stopped wiring.
6. Convert the mixer to 16-bit PCM and create the WAV writer at the output path with that format (16000 Hz, 1 ch, 16 bit).
7. Create a cancellation token and start the pump on a thread-pool task. Publish the token to the instance field before starting devices, because a device may fail the instant it starts and its handler cancels through that field.
8. Start the mic capture first, then the output capture.
9. Publish handles to fields and set `IsRecording = true`.

On any exception in steps 3-8: clear the published token, detach stopped handlers, then abort: cancel the pump, wait for it (swallow its errors), dispose the writer, stop and dispose the mic, stop and dispose the output (each step individually guarded, every error swallowed), dispose the token. Rethrow the original exception (`catch { ...; throw; }`).

#### 2.2.3 Per-source conversion to the mix format (`AudioCaptureService.cs:399-411`)

- Each source feeds a buffer: `BufferDuration = 5 s`, `DiscardOnBufferOverflow = true` (overflow drops new data; the buffer pads with zeros when it underruns).
- Channel handling: 2 channels are averaged to mono with left weight 0.5 and right weight 0.5. 1 channel is used as is. More than 2 channels is not handled (bug C3).
- Sample rate: if not 16000, resample with a WDL resampler (NAudio `WdlResamplingSampleProvider`) to 16000. Otherwise untouched.
- Source formats seen in practice: mic and system loopback use the device mix format (NAudio standardizes it, typically 32-bit float, 48000 Hz, 2 ch); process loopback is fixed at 48000 Hz, 16-bit PCM, 2 ch.
- The mixer sums all inputs sample by sample with no attenuation. The sum is clamped to [-1, 1] when converted to 16-bit, then scaled by 32767 (full-scale float 1.0 becomes 32767, -1.0 becomes -32767).

#### 2.2.4 The pump (`AudioCaptureService.cs:429-481`)

The mixer never reports "no data": it always returns the requested number of samples, with silence when a source buffer is empty. So the pump paces itself against the wall clock.

- Chunk size: `AverageBytesPerSecond / 5` = 32000 / 5 = 6400 bytes = 200 ms = 3200 samples.
- Loop until cancelled:
  - If paused: start a pause stopwatch slice if not running; read one chunk and discard it (so source buffers drain and do not overflow); sleep 50 ms; continue. Nothing is written, no frame raised, no header flush.
  - If not paused and a pause slice was running: add its elapsed milliseconds to `pauseAccumulatedMs`, reset the slice.
  - Read one chunk from the mixer. If bytes > 0: write to the WAV, add to `bytesWritten`, flush the header if the cadence says so (2.2.5), raise the PCM frame (2.2.6).
  - Pacing: `expectedElapsedMs = bytesWritten * 1000 / 32000`; `sleepMs = expectedElapsedMs - (stopwatch.elapsed - pauseAccumulatedMs)`; if `sleepMs > 0` sleep `(int)sleepMs` ms. If the pump falls behind it does not sleep and catches up by reading backlog.
- Effect: the WAV duration tracks wall-clock time minus paused time, with silence filling any period where a source delivered nothing.
- Any exception in the loop is stored as the pump failure; if the user is not stopping, `CaptureFaulted` fires with it (2.3.3). The pump then ends; devices keep running; `IsRecording` stays true until Stop.

#### 2.2.5 Header flush cadence

`WavHeaderFlushCadence.ForFormat(format, 5 s)` = `AverageBytesPerSecond * 5` = 160000 bytes of written audio. `ShouldFlush(total)` returns true when `total - lastFlushBytes >= interval` and then sets `lastFlushBytes = total` (so it fires once per interval; the next one counts from the last flush, not from zero). The constructor throws `ArgumentOutOfRangeException` for an interval of 0 or less. It counts written bytes, so paused time never triggers a flush. The flush is the writer's `Flush()`, which rewrites the RIFF and data sizes and restores the write position, so an abrupt exit leaves a readable file at most 5 s behind. An `IOException` during a periodic flush is swallowed (the final flush at stop retries).

#### 2.2.6 Live PCM frames

`PcmFrameAvailable` fires from the pump thread right after each write, only if there is a subscriber and the chunk has at least 2 bytes. Frame: `samples[i] = int16LE / 32768f`, `sampleRate = 16000`, nominal 3200 samples per frame. The event is the same mixed stream as the file. Subscribers must not block (the live ASR service queues frames on a channel and drops the oldest). A subscriber that throws kills the pump and surfaces as a pump fault (test `PumpFault_ThrowingFrameSubscriberIsAlsoSurfaced`).

During recording the page converts each frame to RMS (`sqrt(sum(s^2)/n)` in double), maps it with the level-meter curve (2.7), multiplies by 100 and sets `MicLevel` on the UI thread (`RecordingPageViewModel.cs:1820`). Empty frames are ignored.

### 2.3 Pause, stop and failures

#### 2.3.1 Pause and resume

- `Pause()` sets the paused flag only if `IsRecording`; `Resume()` clears it only if `IsRecording`. Both are no-ops otherwise. `IsPaused` reads the flag.
- Devices keep capturing during a pause; their data is drained and discarded by the pump (2.2.4).
- Status while paused: `Status_Paused` = "Paused. The break is not recorded." / "En pausa. La interrupción no se graba."
- On resume the page sets the status back with `RecordingStatusText()`.
- The page keeps its own elapsed-time stopwatch, pause clock and `pausedDuration`; on resume it passes `pausedDuration` to the live ASR clock (`SetClockSkew`). The pause toggle is ignored unless the session state allows capture control.
- Stop clears the paused flag.

#### 2.3.2 Stop (`AudioCaptureService.StopAsync`, lines 170-275)

- `Stop()` is `StopAsync().GetAwaiter().GetResult()`; UI code must use `StopAsync`. `Dispose()` calls `Stop()` and swallows any error.
- Single flight: under a lock, if a stop task already exists return it (every concurrent caller awaits the same task and sees the same outcome, including the same exception). If not recording return a completed task. Otherwise start the teardown on a thread-pool task.
- Teardown sequence. Every step runs even if an earlier one fails; the first teardown error is kept:
  1. Capture local references to mic, output, writer, token, pump task, path.
  2. Set `userStop = 1` (so device-stopped events are not treated as failures).
  3. Detach the devices' stopped handlers.
  4. `StopRecording()` on mic, then on output.
  5. Cancel the pump token.
  6. Await the pump task; ignore `OperationCanceledException`; other exceptions become the teardown error if none yet.
  7. Writer: `Flush()` then `Dispose()`, each guarded. If either failed and the path is known, run `WavHeaderRepair.Repair(path)` (result ignored): the audio on disk is still the meeting.
  8. Dispose mic, output, token (each guarded).
  9. Null all fields, clear paused.
  10. Failure to report = pump failure, else output failure, else teardown error. Clear the stored pump and output failures.
  11. Under the lock set `IsRecording = false` and clear the stop task.
  12. If a failure exists, throw it (all awaiting callers see it).
- After a failed stop the instance is reusable: a new `Start` works (test `PumpFault_AfterStopANewRecordingCanStart`).

Page-side stop (`StopRecordingCoreAsync`): detach handlers first, await `StopAsync`. If it throws and no capture failure message was already shown, show `Error_StopRecording` = "Error stopping the recording: {0}" / "Error al detener la grabación: {0}". Then it records the end time, stops live transcription (a failure there falls back to the text on screen), marks processing, clears paused/recording and starts the pipeline. A caller that loses the race to stop awaits the stop already running.

#### 2.3.3 Failure classification

Three outcomes, by who failed and whether the user asked to stop:

| Event | Raised when | Recording continues? | UI message key |
|---|---|---|---|
| `CaptureSourceLost(source, remaining, error)` | Mic stops with an error while not stopping; or system loopback stops with an error while not stopping | Yes | `Warning_MicrophoneLost`, `Warning_OutputAudioLost`, `Warning_NoAudioSourcesLeft` |
| `OutputCaptureFailed(error)` | Process-tree output stops with an error while not stopping | No: pump token cancelled, page stops the recording | `Error_OutputCaptureFailed` |
| `CaptureFaulted(error)` | Pump throws while not stopping (full disk, throwing frame subscriber) | Pump is dead; page stops the recording; the file stays readable | `Error_CaptureFaulted` |

Predicates (exact, tested):

- `ShouldSurfaceOutputFailure(error, userStop, isProcessCapture) = error != null && !userStop && isProcessCapture`.
- `IsSourceLost(error, userStop) = error != null && !userStop`.

Output stopped handler (`OnOutputCaptureStopped`, line 289):

- If `ShouldSurfaceOutputFailure` is false: treat as a source stop via `ReportSourceStopped(Output, error, userStop)` and return. That covers system loopback errors, user stops and error-free stops.
- If true: store the output failure, cancel the pump token (ignore `ObjectDisposedException`), raise `OutputCaptureFailed(error)`. Not counted as a lost source.

`ReportSourceStopped`: if `IsSourceLost` is false, do nothing. Otherwise atomically decrement `liveSources`, clamp at a minimum of 0, and raise `CaptureSourceLost(source, remaining, error)`. `source` is `Microphone` or `Output` (`Output` means loopback or process tree). `remaining == 0` means only silence is now being written. Both endpoints of a headset can die together on separate capture threads, hence the atomic decrement. The event is raised on the capture thread.

Page handlers:

- `OutputCaptureFailed` -> key `Error_OutputCaptureFailed`; `CaptureFaulted` -> key `Error_CaptureFaulted`. Both go through `StopForCaptureFailure`: on the UI thread, only the first failure is handled (`_captureFailureNotified` exchanged to 1); it formats the message with the exception message, shows it as the status, and if recording starts the stop path.
- `CaptureSourceLost`: key = `Warning_NoAudioSourcesLeft` when `remaining == 0`, else `Warning_MicrophoneLost` when the source is the microphone, else `Warning_OutputAudioLost`. On the UI thread: if the current warning is already `Warning_NoAudioSourcesLeft` ignore (nothing outranks it, two events can arrive out of order); otherwise remember the key and, if recording, show it as the status.
- A failure that fires in the gap before `IsRecording` is set is handled right after Start returns (2.2).

Messages:

| Key | en | es |
|---|---|---|
| `Warning_MicrophoneLost` | The microphone stopped working, so your voice isn't being recorded. Recording continues with the meeting audio. | El micrófono dejó de funcionar, así que tu voz no se está grabando. La grabación continúa con el audio de la reunión. |
| `Warning_OutputAudioLost` | The meeting audio stopped working, so the other side isn't being recorded. Recording continues with the microphone. | El audio de la reunión dejó de funcionar, así que la otra parte no se está grabando. La grabación continúa con el micrófono. |
| `Warning_NoAudioSourcesLeft` | Nothing is being captured because no audio source is left. Stop the recording to keep what was saved so far. | No se está capturando nada porque no queda ninguna fuente de audio. Detén la grabación para conservar lo guardado hasta ahora. |
| `Error_OutputCaptureFailed` | Recording stopped because the meeting audio failed: {0} | La grabación se detuvo porque falló el audio de la reunión: {0} |
| `Error_CaptureFaulted` | Recording stopped because of an audio error: {0}. The audio captured so far was kept. | La grabación se detuvo por un error de audio: {0}. Se conservó el audio capturado hasta ahora. |

### 2.4 Meeting-audio picker (cards)

Component `RecordingAudioSourcesViewModel` plus `AudioSourceCard`. Visible on the Record page.

Cards:

- A fixed first card "All system audio" (`RecordPage_AllSystemAudio.Text` = "All system audio" / "Todo el audio del sistema"), tooltip `RecordPage_SystemCardTooltip` = "Records everything playing on this PC, including other apps." / "Graba todo lo que suena en este equipo, incluidas otras aplicaciones." Fallback glyph is a Segoe icon-font speaker character (`AudioSourceCard.cs:13`; app cards use a different one, line 14), no icon, no meter (a system-wide peak is not read, a made-up one would mislead). It is selected by default.
- One card per app with an active audio session: name = friendly name; icon = the executable's icon (async, cached, fallback app glyph when no icon); tooltip `RecordPage_AppCardTooltip` = "Records this app and the helper processes it starts. Audio from other apps is left out." / "Graba esta aplicación y los procesos auxiliares que inicia. El audio de otras aplicaciones queda fuera."; a live meter 0-100.
- Tags and hints on app cards:
  - "Detected" tag (`RecordPage_AppDetectedTag.Text` = "Detected" / "Detectada") when the app is a known meeting app and available.
  - "Records all tabs" (`RecordPage_BrowserHint.Text` = "Records all tabs" / "Graba todas las pestañas") when the app is a browser and available.
  - "Not playing" (`RecordPage_AppNotPlaying.Text` = "Not playing" / "Sin audio") when it is not available.
- Unavailable cards render at opacity 0.55 (available: 1.0); meter level 0.
- Empty hint `RecordPage_NoAppsPlaying.Text` = "Play audio in your meeting app to pick it here" / "Reproduce audio en tu aplicación de reuniones para elegirla aquí". Shown when no app card is available (`!Cards.Any(card => !IsSystem && IsAvailable)`; an unavailable selected app does not count).
- Card instances are reused across refreshes (keyed by process id) so the selection never resets. The list is updated with minimal removes, inserts and moves.

Selection (`SelectCard`): selecting the already-selected card is ignored; otherwise mark user-touched, close the fallback bar, set the selection, and remember it asynchronously (2.6). Programmatic selection changes do not remember.

Resolving the target at Record time (`ResolveRecordingTarget`, line 193):

- All system audio selected: returns null (system loopback).
- App selected and `ActiveAppEntries.IsStillRunning(app, processes)` true: close fallback bar, return the app's root pid.
- App selected but gone: set `FallbackMessage` = `RecordPage_SourceFallbackMessage`, open the info bar (title `RecordPage_SourceFallback.Title` = "Audio source changed" / "Fuente de audio cambiada"), switch the selection back to All system audio, return null. `RecordPage_SourceFallbackMessage` = "{0} is no longer running. Recording all system audio instead." / "{0} ya no se está ejecutando. Se grabará todo el audio del sistema." ({0} = card name).

Meeting-app suggestion (consumes this module's data; logic in `MeetingAppSuggestion`):

- Shown only while All system audio is selected. Pick the known meeting app (`IsKnownMeetingApp`) that is playing and whose pid was not dismissed; the loudest peak wins, ties go by friendly name (current-culture, case-insensitive).
- Title `RecordPage_SuggestionTitle` = "{0} is in a call" / "{0} está en una llamada"; action `RecordPage_SuggestionAction` = "Use {0}" / "Usar {0}". The action selects that app's card (a user-style selection, so it is remembered). It never switches by itself.
- Closing the info bar with the X adds that pid to the dismissed set for the rest of the session. Evaluation is skipped while the remembered app is being restored, so a suggestion does not flash and vanish.

Polling (`PollAsync`, line 234):

- Runs only while the Record page is visible and the page is neither recording nor processing (`UpdateSourcePolling`, line 1945); `Stop()` zeroes every card's level.
- One background task owns the session source (not thread-safe) and the app service. It publishes an immediate full refresh, then ticks a 150 ms timer. Every 10th tick (every 1.5 s) it does a full `Refresh`; other ticks read peaks only. Results are posted to the UI thread; stale generations are discarded.
- Any exception ends the loop silently (meters are best effort). Cancellation is the normal end.
- On each full refresh: merge (3.4.4), update cards, sync card order, update the empty hint, store the last app list, and on the first refresh after `Start()` (when the user has not touched the cards) try to restore the remembered app (2.6).
- Meter value for a card = `ToMeterValue(peak) * 100` (2.7). Peak updates skip the system card and unavailable cards.

### 2.5 Settings: microphone picker and level preview

Settings section "Microphone": label `Settings_Microphone.Text` = "Microphone" / "Micrófono"; level bar label `Settings_MicLevel.Text` = "Microphone level" / "Nivel del micrófono"; combo placeholder `ComboMicrophoneDevice.PlaceholderText` = "System default".

- The list is the sentinel "System default" (empty id) followed by every active capture endpoint.
- Loading: the saved id (`selectedMicrophoneDeviceId`, null means default) picks the matching item or System default. The selection is set without raising the combo's change event; selection events are ignored while the page is loading or while the list is being rebuilt (`_isLoading`, `_suppressMicrophoneCommit`, released after the page paints).
- Picking a different item: update the selection, restart the level meter on that device, save `selectedMicrophoneDeviceId` (null for System default). Re-picking the same id is ignored.
- Level meter: `LevelChanged` (float 0..1) arrives on a background thread; the page multiplies by 100, clamps to [0, 100], and sets the bar on the UI thread. The meter runs while the Settings page is shown and is stopped (and the handler unsubscribed) when leaving.
- Preview behavior (`MicrophoneLevelMeterService`): see 3.1.5.

### 2.6 Remembering choices (`RecordAudioSourceMemory`)

Callers always load the current settings object, mutate it with these helpers, and save it back; the helpers never create a settings object. Saving failures are ignored (a locked settings file must not break picking).

Writing:

- `RememberMicrophone(kind, deviceId)`: `recordMicrophoneKind` = the enum name (`"None"`, `"SystemDefault"`, `"Device"`); `recordMicrophoneDeviceId` = the id only for `Device`, else null. Other settings untouched.
- `RememberSystemAudio`: `recordOutputKind = "System"`, `recordAppExePath = null`, `recordAppName = null`.
- `RememberApp(exePath, name)`: `recordOutputKind = "App"`, `recordAppExePath = exePath` (may be null), `recordAppName = name`.

Reading:

- `RestoreMicrophone(settings, availableDeviceIds)`:
  - If `recordMicrophoneKind` parses (case-insensitive) to a defined enum value: `None` -> None; `Device` -> that device if its id is non-empty and is in the available set (ordinal compare), else System default; `SystemDefault` -> System default.
  - Not set, unparsable, or an undefined numeric value: fall back to the Settings microphone `selectedMicrophoneDeviceId` with the same rule (present -> Device, else System default). Never returns None in this branch.
  - An unplugged remembered device falls back to System default, never to None.
- `RestoreApp(settings, activeApps)`: null unless `recordOutputKind` equals "App" (case-insensitive) and `recordAppExePath` is not blank. Otherwise the first active app whose exe path equals the remembered path (case-insensitive), else null. Null means all system audio, silently. Because it matches by path and returns the live entry, the restored card gets the current process id. An app that is not playing right now is never auto-selected.

On the Record page the restore of the app happens once per `Start()` of the poller, after the first enumeration, and only when the user has not picked a card yet and no app is currently selected (`RestoreRememberedAppAsync`, line 164). Settings read errors leave all system audio selected.

### 2.7 Level meter curve (`AudioLevelMeter.ToMeterValue`)

Maps a linear amplitude (RMS or peak) to a 0..1 meter position on a dB scale.

```
FloorDecibels = -60
MinAmplitude  = 1e-6
if NaN -> 0
db = 20 * log10(max(amplitude, 1e-6))
value = clamp((db - (-60)) / 60, 0, 1)
```

Reference points: 0 -> 0; 1e-6 -> 0; 0.0005 (-66 dBFS) -> 0; amplitude for -30 dB (0.0316228) -> 0.5; 1.0 -> 1.0; 4.0 -> 1.0 (clamped); negative -> 0; typical speech RMS 0.05 (-26 dBFS) -> about 0.566. Monotonic. Both the recording bar and app cards use `value * 100`.

### 2.8 Importing an audio file

Entry: the Record page "Import audio" command, enabled by the session state (`CanImport`). Flow (`RecordingPageViewModel.cs:1386`):

1. Readiness check first (a separate module); abort silently if not ready.
2. File picker, single file, filter extensions exactly: `.wav .mp3 .m4a .aac .flac .wma .3gp .mp4`. Suggested start location: Downloads (falls back to Documents library).
3. `recordedAt` = the source file's last-write time (local time); if the time is `DateTime.MinValue` or reading it fails with an IO, access or argument error, use now.
4. Destination = a library path allocated by the library layout module for (meeting id, recordedAt, title).
5. Status `Status_Importing` = "Importing audio..." / "Importando audio...". Stop the idle mic preview.
6. On a worker thread: `ConvertToNemotronWav(source, destination)` then `WavFileDuration.ReadTotalTime(destination)`.
7. On any error: delete the destination best-effort, show `Error_ImportAudio` = "Error: couldn't import that audio ({0})." / "Error: no se pudo importar ese audio ({0})." ({0} = exception message), restart the mic preview, and return. The same message is shown if anything else in the import command throws.
8. On success: `endedAt = recordedAt + wavDuration`, and the normal post-recording pipeline continues (other module).

`ConvertToNemotronWav(sourcePath, destinationWavPath, cancellationToken)` (`AudioImportService.cs`):

- Null, empty or whitespace paths throw `ArgumentException`.
- Missing source: `FileNotFoundException("The audio file was not found.", sourcePath)`.
- Creates the destination directory if the path has one.
- Reads the file with a decoder that handles the formats above (NAudio `AudioFileReader`: WAV/MP3/AAC/M4A/WMA/FLAC through Media Foundation, as float).
- Exactly 2 channels: average to mono (0.5/0.5). Other channel counts are passed through unchanged (bug C2).
- Resample to 16000 Hz if different (WDL).
- Convert to 16-bit PCM and write a WAV (16000 Hz, 1 ch, 16 bit expected).
- Copy loop: buffer = max(AverageBytesPerSecond, 4096) = 32000 bytes; `ThrowIfCancellationRequested` after each non-empty read.
- Zero bytes written: `InvalidDataException("The audio file contained no samples.")`.
- Any exception: delete the destination best-effort (ignore IO or access errors) and rethrow.

### 2.9 Duration and repair utilities

- `WavFileDuration.ReadTotalTime(path)`: throws `ArgumentException` for null/empty/whitespace; opens the file with `AudioFileReader` and returns `TotalTime` (frames / sample rate). It does not repair; a file with zero sizes fails.
- `WavHeaderRepair.Repair(path)` returns one of `Valid`, `Repaired`, `NotWav`, `Unsupported`, `Failed`. Algorithm in 3.6. Never throws for IO or access errors; throws `ArgumentException` only for a null, empty or whitespace path. Called at stop when the writer failed to flush or dispose (2.3.2) and before transcription of any WAV (`TranscriptionService.cs:67`).

### 2.10 Unused: `PcmLevelNormalizer`

Production code never calls it (bug C6). Keep the behavior documented because tests pin it and a future "very quiet mic" fix may use it. See 3.7.

---

## 3. Domain rules, constants, algorithms

### 3.1 Capture constants and devices

3.1.1 Mix format: IEEE float, 16000 Hz, 1 channel. File format: PCM 16-bit, 16000 Hz, 1 channel, 32000 bytes/s, block align 2.

3.1.2 Constants

| Name | Value | Where |
|---|---|---|
| Pump chunk | 6400 bytes (200 ms, 3200 samples) | `AudioCaptureService.cs:436` |
| Paused pump sleep | 50 ms | line 451 |
| Source buffer | 5 s each, discard on overflow | line 399 |
| Header flush interval | 5 s = 160000 bytes | line 18 |
| Process loopback format | 48000 Hz, 16-bit PCM, 2 ch | `ProcessLoopbackCapture.cs:22-24` |
| Process loopback owner-thread ready wait | 12 s | line 61 |
| Process loopback activation timeout | 10 s | line 25 |
| Process loopback start wait | 5 s | line 92 |
| Process loopback stop join | 5 s | line 405 |
| Process loopback buffer-event wait | 200 ms | line 276 |
| Buffer flag SILENT | 0x2 | line 21 |
| Active app peak threshold | 0.001 (default arg) | `ActiveAudioAppService.cs:86` |
| Max parent walk depth | 32 | line 57 |
| Poll tick | 150 ms; full refresh every 10 ticks (1.5 s) | `RecordingAudioSourcesViewModel.cs:17-18` |

3.1.3 Events and ordering guarantees

- `PcmFrameAvailable`: pump thread. `OutputCaptureFailed`: capture thread of the process loopback. `CaptureSourceLost`: capture thread. `CaptureFaulted`: pump thread. Handlers must marshal to their own thread.
- `CaptureSourceLost` and `CaptureFaulted` are declared with empty default `add`/`remove` accessors on the interface (`IAudioCaptureService.cs:41-56`), so a test fake that does not implement them drops subscriptions silently.

3.1.4 Microphone endpoint resolution (`MicrophoneDeviceResolver.Resolve`), shared by recording and the preview:

1. If the id is non-empty: look up the endpoint by id; if its state is Active return it. Any exception (unplugged, id no longer resolves) is swallowed.
2. Otherwise return the default capture endpoint for role Console. Never throws for a stale id; throws only if there is no default capture device at all.

3.1.5 Microphone list (`MicrophoneDeviceService`): active capture endpoints only (state Active, data flow Capture), each as `{ id: endpoint id string, name: friendly name }`. Not filtered or sorted by the service. The id is the OS endpoint id string and is the persisted key.

3.1.6 Level-preview service (`MicrophoneLevelMeterService`)

- `Start(deviceId)`: first `Stop()`, then open a capture on the resolved device, subscribe data and stopped, start recording. Any failure (device busy, unavailable, creation fails) is swallowed: the instance holds no capture, the failed capture is detached and disposed, and a later `Start` works. It never throws.
- `Stop()`: take the capture under a lock, detach handlers, stop (errors swallowed), dispose. Safe to call repeatedly or when not started.
- Data event: ignore empty buffers; compute a normalized RMS and raise `LevelChanged(float)`. Raised on a background thread.
- Stopped event (device removed mid preview): detach, dispose the capture if this instance still owns it, then raise `LevelChanged(0)`.
- RMS formula per buffer, over all interleaved samples of all channels, double precision: `rms = sqrt(sum(s^2) / n)`, clamped to [0, 1].
  - 32-bit IEEE float: `s` as is, non-finite samples skipped.
  - Else 16-bit: `s = int16 / 32768`.
  - Else 32-bit PCM: `s = int32 / int.MaxValue`.
  - Any other depth (for example 24-bit) returns 0.
  - No samples counted returns 0.
- No file output, nothing persisted or transcribed. Independent from the recording pipeline.

### 3.2 Process-tree loopback (`ProcessLoopbackCapture`), Windows only

Purpose: capture the audio of one app and its descendants, mixed like system loopback. It never falls back to system loopback.

Construction (blocks the caller):

- Pid 0 throws `ArgumentOutOfRangeException` ("Process id 0 is not a valid capture target.").
- Starts a background owner thread named `ProcessLoopbackCapture`, which initializes COM as multithreaded (a changed-mode error `0x80010106` is tolerated and means "do not uninitialize"), activates the client, configures it, then waits for start or stop.
- The constructor waits up to 12 s for activation. Timeout throws `TimeoutException("Process loopback activation did not finish within 12 seconds.")`. An activation error is rethrown as is. On any constructor failure the thread is asked to stop and joined and wait handles are disposed (unless the thread is still alive inside a native call, in which case handles are leaked on purpose until process exit).

Activation parameters (the exact 12-byte `AUDIOCLIENT_ACTIVATION_PARAMS` blob, little endian):

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 4 | ActivationType | 1 (process loopback) |
| 4 | 4 | TargetProcessId | pid (uint32) |
| 8 | 4 | ProcessLoopbackMode | 0 (`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`) |

Example for pid 4242 (0x1092): `01 00 00 00 92 10 00 00 00 00 00 00`. Pid 0 is rejected before any native call.

The blob is passed in a `PROPVARIANT` of type blob (`VT_BLOB`) with `cbSize = 12`. Both the blob and the variant must stay pinned until the completion callback returns (the callback may fire after the waiter timed out; the callback owns the pins and releases any client it receives if abandoned).

Activation call: `ActivateAudioInterfaceAsync("VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK", IID_IAudioClient, propvariant, completionHandler)` from `mmdevapi.dll`, `stdcall`, System32 only. The completion handler runs on an MTA thread. Wait up to 10 s; on timeout throw `TimeoutException("Process loopback activation timed out after 10 seconds.")`. If the result HRESULT fails throw `InvalidOperationException("Process loopback activation failed: 0x{hr:X8}. {message}")`. If the result is not an `IAudioClient`, HRESULT `0x80004002` with detail "Activation did not return IAudioClient.".

Client configuration:

- The process-loopback client does not support `GetMixFormat` (returns E_NOTIMPL), so the format is fixed: PCM, 2 channels, 48000 Hz, 16 bits, block align 4, avg bytes/s 192000, cbSize 0.
- `Initialize(shared, flags = LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM, bufferDuration 0, periodicity 0, format, no session guid)`. A COM error is wrapped: `InvalidOperationException("Process loopback initialization failed: 0x{hr:X8}. {message}")`.
- Get the capture client service; if it is not `IAudioCaptureClient` throw "Process loopback GetService did not return IAudioCaptureClient.".
- Register an auto-reset event handle for buffer-ready callbacks.
- Properties `WaveFormat` returns that fixed format (throws `InvalidOperationException` if not yet available); setting it always throws "Process loopback capture uses a fixed 48 kHz 16-bit stereo format.".

Start: `StartRecording()` throws `ObjectDisposedException` if disposed, rethrows the stored init error if any, signals the owner thread and waits up to 5 s. Timeout throws `TimeoutException("Process loopback capture did not start.")`. A start error is wrapped: `InvalidOperationException("Process loopback capture failed to start: 0x{hr:X8}. {message}")`.

Capture loop (owner thread): until stop requested: wait up to 200 ms on the buffer event; drain packets: loop `GetNextPacketSize`, if 0 return; `GetBuffer`; copy `frames * blockAlign` bytes into a reusable buffer, or zero-fill if flags contain SILENT (0x2) or data is null (silent packets are uninitialized memory and must never be copied); `ReleaseBuffer(frames)`; raise `DataAvailable(buffer, byteCount)`. A packet is always released even if copying throws (a second failure is swallowed). A subscriber that throws is swallowed so it cannot kill the capture thread. Any other exception (except out of memory) is stored as the capture error and ends the loop. The discontinuity and timestamp-error flags are ignored.

Stop and teardown: `StopRecording()` sets stop-requested, wakes the owner thread and the buffer event, joins up to 5 s (unless called from the owner thread) and raises the stopped event with no error if not yet raised. The owner thread's `finally`: stop the audio client if it had started, release the capture client and audio client COM objects (`ReleaseComObject`, never CloseHandle), uninitialize COM if this thread initialized it, unblock waiters, raise the stopped event with the stored capture error (null on normal stop). The stopped event fires exactly once per instance (first caller wins). `Dispose` is idempotent.

Consumer contract: `DataAvailable(buffer, count)` carries 16-bit stereo 48 kHz interleaved bytes; the subscriber must copy during the event.

### 3.3 System loopback

System loopback uses the OS default render endpoint (NAudio `WasapiLoopbackCapture`, default constructor), resolved once at Start. Format = the endpoint mix format. Errors surface as `CaptureSourceLost(Output, ...)` and do not stop the recording. There is no automatic re-open if the default device changes (suspected S2).

### 3.4 Active audio app discovery

#### 3.4.1 Inputs

- `IAudioSessionSource` (Windows-bound): `Enumerate()` returns `AudioSessionSnapshot { processId, isSystemSounds, isStateActive, peak }` for every session on the default render endpoint (role Multimedia), refreshing the session list each call and caching sessions; `ReadPeaks()` returns max peak per process id from the cached sessions (cheap). Per-session read failures (COM) are skipped; the whole enumeration swallows COM and invalid-operation errors and returns an empty list. The default endpoint is resolved on every `Enumerate` (headphones can be plugged in). Peak = master peak value 0..1; unreadable peak = 0 in the snapshot. Not thread-safe: one polling loop only. Disposing releases the device.
- `IProcessInfoProvider`: `GetProcess(pid)` returns `ProcessDetails { pid, parentPid, exePath|null, processName, startTimeUtc|null }` or null; `GetVersionInfo(exePath)` returns `{ fileDescription, productName }` or null.

#### 3.4.2 Refresh algorithm (`ActiveAudioAppService.Refresh`)

For each session:

1. Skip if `isSystemSounds` or pid 0.
2. Active = `isStateActive || peak > threshold` (threshold 0.001, strict greater-than). Skip if not active. A session in the active state with zero peak is included.
3. `GetProcess(pid)`; skip if null.
4. Find the root (3.4.3).
5. Skip if the process or its root is excluded: pid equals the app's own pid (the pid is a constructor argument), or the executable name (file name without extension, or the process name when no path) is in the excluded set, case-insensitive: `ApplicationFrameHost, TextInputHost, SystemSettings, explorer, ShellExperienceHost, StartMenuExperienceHost, SearchHost, LockApp, dwm, audiodg`.
6. Record `rootBySessionPid[pid] = root.pid`, `rootInfo[root.pid] = root`, `peakByRoot[root.pid] = max(existing, peak)`.

Store the new session-to-root map (used by `ReadPeaks`). Return one `ActiveAudioApp` per root, sorted by friendly name (current culture, ignore case), then by pid.

`ActiveAudioApp { processId (root), exePath|null, friendlyName, isBrowser, isKnownMeetingApp, peak }`.

- Two roots from the same executable that are both playing are two entries. Two sessions under one root are one entry with the max peak.
- `friendlyName`: root exe path non-null and version info exists: trimmed file description if not blank, else trimmed product name if not blank; else the process name.
- Executable name for flags = file name without extension, or the process name when the path is unknown.
- `isBrowser` if the exe name is one of (case-insensitive): `chrome, msedge, firefox, brave, opera, vivaldi, arc`.
- `isKnownMeetingApp` if the exe name is one of: `zoom, teams, ms-teams, webex, webexmta, slack, discord, skype, cpthost`. Browsers are deliberately absent (whether a browser is in a call depends on window titles, a different feature).
- `ReadPeaks()`: returns an empty map if no session map exists; otherwise for each cached session peak whose pid is in the map, `result[root] = max(result[root], peak)`. Sessions not mapped to an app are ignored. It does not re-enumerate.

#### 3.4.3 Root resolution (`FindRoot`)

Start at the session's process. Up to 32 iterations, move to the parent only if all hold: current exe path is known; parent pid is not 0; parent pid not seen already (cycle guard); `GetProcess(parentPid)` exists; the parent's exe path equals the current exe path (ordinal ignore case); the parent was not started after the child (a parent with a later start time than the child is a recycled pid; only checked when both start times are known). Otherwise stop. Consequence: a Chrome utility process rolls up to the main `chrome.exe`; a parent with a different image (for example a launcher) stops the climb; an access-denied exe path (null) means no roll-up and the entry is named by the process name.

#### 3.4.4 Picker merge (`ActiveAppEntries.Merge`)

Input: the active list and the currently selected app (or null). Output entries, each `{ app, isAvailable }`.

- All active apps become available entries in input order.
- If a selected app exists and no active app has the same pid, insert the selected app as an unavailable entry before the first entry whose friendly name sorts strictly after the selected one's (current culture, ignore case), or at the end if none. This keeps a paused app visible and selected.
- Apps that stop playing and were not selected disappear.

`IsStillRunning(app, processes)`: false if `GetProcess(pid)` is null. If either side's exe path is unknown, true. Otherwise true only if the two paths are equal ignoring case (rejects a recycled pid used by another image).

#### 3.4.5 Process info provider (`WindowsProcessInfoProvider`), Windows only

- `GetProcess(0)` returns null.
- Opens the process with query-limited-information access (0x1000). If the open fails, fall back to the process name by pid: details with parent 0, no exe path, no start time, name = process name; null if the process is gone or inaccessible.
- With a handle: exe path = full image name (1024-character buffer), parent pid = inherited-from-unique-process-id from the basic process information class 0 (0 on failure), start time = creation time converted from FILETIME to UTC (null if the call fails or the value is not positive). Name = exe file name without extension, or the process name if the path could not be read; if no name at all then null.
- `GetVersionInfo(path)`: reads the file version info; an IO, access or argument error returns null.

### 3.5 Source-level facts the picker relies on

- Process-tree capture of a root pid also records every descendant process, including the browser's tab processes (hence the browser hint).
- Capturing an app does not capture other apps; the microphone is separate.

### 3.6 WAV header repair algorithm (`WavHeaderRepair`)

Goal: after an abrupt exit the writer has not written the RIFF size and the data size (both 0). Repair rewrites only those two uint32 fields. It never truncates audio and never touches a consistent file.

Analysis (read-only, file shared for read/write):

1. File length above 4 GiB (`uint.MaxValue`): `Unsupported`.
2. Read the first 12 bytes; not `RIFF` at 0..3 or not `WAVE` at 8..11 (or fewer than 12 bytes): `NotWav`. Read `riffSize` = uint32 LE at 4.
3. Walk chunks from offset 12. For each: 8-byte header (4-byte id, uint32 LE size). Incomplete header ends the walk.
   - `fmt `: size below 16 -> `NotWav`; cannot read 16 bytes -> `NotWav`. Format tag (uint16 at body+0) must be 1 (PCM) or 3 (IEEE float) and block align (uint16 at body+12) non-zero, else `Unsupported`. Remember block align.
   - `data`: if no `fmt ` seen (block align 0) -> `NotWav`. Otherwise build the plan with `dataOffset = headerOffset + 8`, `dataSizeOffset = headerOffset + 4`.
   - Other chunks (for example LIST) are skipped.
   - Next chunk offset = body offset + size + (size & 1) (word alignment). If it is at or beyond the file length the walk ends.
   - Walk ended without a data chunk: `NotWav`.
4. Plan: `available = fileLength - dataOffset` (negative -> `NotWav`).
   - `dataBroken = (dataSize == 0 && available >= blockAlign) || dataOffset + dataSize > fileLength`.
   - `riffBroken = riffSize == 0 || riffSize + 8 > fileLength`.
   - Neither: `Valid`, nothing written.
   - `newData = dataBroken ? available - (available % blockAlign) : dataSize` (round down to whole frames).
   - `endOfAudio = dataBroken ? dataOffset + newData : fileLength`.
   - New RIFF size = `endOfAudio - 8`.
Write: reopen read/write with read sharing, refuse if the length changed (`Failed`), write uint32 LE new RIFF size at offset 4 and new data size at `dataSizeOffset`, flush to disk, `Repaired`. IO or access errors anywhere return `Failed`; a missing or locked file returns `Failed`.

Example: the app's own recordings have an 18-byte fmt chunk (cbSize 0) so the data chunk header is at offset 36 and audio starts at offset 46. A crashed recording looks like:

```
52 49 46 46 00 00 00 00 57 41 56 45   RIFF, riffSize=0, WAVE
66 6D 74 20 12 00 00 00               "fmt " size 18
01 00 01 00 80 3E 00 00 00 7D 00 00 02 00 10 00 00 00   PCM, 1 ch, 16000 Hz, 32000 B/s, align 2, 16 bit, cbSize 0
64 61 74 61 00 00 00 00               "data" size 0
<audio bytes...>
```

After repair with N audio bytes (N rounded down to a multiple of 2): riffSize = 46 + N - 8, dataSize = N.

### 3.7 `PcmLevelNormalizer` (not wired in)

Constants: `TargetPeak = 0.70`, `MaxGain = 16` (+24 dB), `SilencePeak = 0.002`.

- `ResolveGain(peakFs)`: returns 1 if `peakFs <= 0.002` or `peakFs >= 0.70`; otherwise `min(0.70 / peakFs, 16)`.
- `NormalizeFloat32(samples)`: empty input does nothing; compute peak = max abs; gain = `ResolveGain(peak)`; if gain <= 1 do nothing; else multiply every sample by gain and clamp to [-1, 1].
- `NormalizeInt16Le(bytes)`: fewer than 2 bytes does nothing; peak = max abs of int16 values (as int, so -32768 is 32768); gain = `ResolveGain(peak / 32768)`; if gain <= 1 do nothing; else each sample = round(sample * gain) clamped to [-32768, 32767].
- Rule: must run on a whole recording or a long window, never on 200 ms slices (per-chunk peak gain pumps the level and breaks streaming ASR).

---

## 4. Persistence and wire formats

### 4.1 Output WAV

RIFF/WAVE, PCM, 16000 Hz, 1 channel, 16 bit, little endian. Header written by NAudio `WaveFileWriter` is 46 bytes (fmt chunk of 18 bytes, cbSize 0), data follows. Sizes are valid after each 5 s flush and at stop. Samples are mixed float scaled by 32767. A port may write a 44-byte header with a 16-byte fmt chunk; the repair function accepts both (it follows chunk sizes).

### 4.2 Live frame

```
{ samples: float32[~3200], sampleRate: 16000 }   // value = int16 / 32768, range [-1, 1)
```

### 4.3 Capture request

```
{ captureMicrophone: true, microphoneDeviceId: null,                 output: "SystemLoopback", processId: 0 }
{ captureMicrophone: false, microphoneDeviceId: null,                output: "ProcessTree",    processId: 4242 }
{ captureMicrophone: true, microphoneDeviceId: "{0.0.1.00000000}.{aaaaaaaa-0000-0000-0000-000000000000}", output: "SystemLoopback", processId: 0 }
```

### 4.4 Settings keys (JSON, camelCase, case-insensitive on read)

The settings file is rewritten wholesale (load, mutate, save). Audio-related fields of `AppSettings`:

```json
{
  "selectedMicrophoneDeviceId": null,
  "recordMicrophoneKind": "Device",
  "recordMicrophoneDeviceId": "{0.0.1.00000000}.{aaaaaaaa-0000-0000-0000-000000000000}",
  "recordOutputKind": "App",
  "recordAppExePath": "C:\\Program Files\\Zoom\\bin\\Zoom.exe",
  "recordAppName": "Zoom Workplace"
}
```

| Field | Values | Meaning |
|---|---|---|
| `selectedMicrophoneDeviceId` | endpoint id or null | Settings microphone; null/empty = OS default. Also the Record page fallback when `recordMicrophoneKind` is unset |
| `recordMicrophoneKind` | `"None"`, `"SystemDefault"`, `"Device"`, null | Last Record-page microphone choice; null = never changed |
| `recordMicrophoneDeviceId` | id or null | Only meaningful for `Device` |
| `recordOutputKind` | `"System"`, `"App"`, null | Last meeting-audio choice |
| `recordAppExePath` | path or null | Matching key (case-insensitive) |
| `recordAppName` | text or null | Informational only |

Device ids are compared ordinally; exe paths case-insensitively. Per-call state (selection, dismissed suggestions, last app list) is in memory only.

### 4.5 Device and app records

```
MicrophoneDeviceOption { id: string (OS endpoint id), name: string (friendly name) }   // id "" is the "System default" sentinel in Settings only
ActiveAudioApp         { processId: uint32 (root), exePath: string|null, friendlyName, isBrowser, isKnownMeetingApp, peak: float 0..1 }
ProcessDetails         { processId, parentProcessId, exePath|null, processName, startTimeUtc|null }
AudioSessionSnapshot   { processId, isSystemSounds, isStateActive, peak }
```

### 4.6 Import

Input extensions: `.wav .mp3 .m4a .aac .flac .wma .3gp .mp4`. Output: a WAV as in 4.1. Meeting timestamp: source last-write time.

---

## 5. Native and OS dependencies

| Dependency | Used for | Classification |
|---|---|---|
| WASAPI shared-mode capture on the default or chosen capture endpoint (NAudio `WasapiCapture`) | Microphone | Windows-only. macOS equivalent: CoreAudio input device |
| WASAPI loopback of the default render endpoint (`WasapiLoopbackCapture`) | System audio | Windows-only. macOS needs ScreenCaptureKit audio or a virtual driver |
| `ActivateAudioInterfaceAsync` with `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, `IAudioClient`, `IAudioCaptureClient`, 12-byte activation blob, `PROPVARIANT` blob, COM MTA thread (`mmdevapi.dll`, `ole32.dll`; CsWin32 symbols listed in `NativeMethods.txt`: `ActivateAudioInterfaceAsync, AUDCLNT_SHAREMODE, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler, IAudioCaptureClient, IAudioClient, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`) | Per-app capture | Windows-only. Needs a recent Windows (see bug C7). macOS: per-process tap (CoreAudio process taps, 14.2+) |
| `IMMDeviceEnumerator` capture endpoints, friendly names, ids, default endpoint by role | Microphone list and resolution | Windows-only (the contract is portable: list of id and name, default fallback) |
| `IAudioSessionManager2` session enumeration and `IAudioMeterInformation` peaks on the default render endpoint | Active app discovery and meters | Windows-only. macOS has no equivalent per-app peak; needs a different approach |
| `OpenProcess(0x1000)`, `QueryFullProcessImageNameW`, `GetProcessTimes`, `NtQueryInformationProcess(class 0)`, `Process.GetProcessById`, file version info | Process details for grouping | Windows-only |
| Media Foundation decoding via `AudioFileReader` (mp3, m4a, aac, wma, mp4, 3gp, flac) | Import | Windows-only as implemented; the decode/resample/downmix contract is portable (needs a decoder such as ffmpeg) |
| WDL resampler, mono mixing, float-to-PCM16 conversion, mixer | Mixing | Portable (pure math) |
| RIFF writing and repair, header flush cadence, level curve, normalizer | Files and meters | Portable (pure logic and file I/O) |
| Settings persistence (JSON), remembered choices, merge logic, app grouping and exclusion/browsers/meeting lists, failure classification, state machine in `AudioCaptureService` | Rules | Portable |
| Per-app icon extraction (`AppIconCache`) | Cards | Windows-only; outside this module |
| File picker and Downloads start location | Import | UI toolkit specific |

Notes for porting (not behavior): the excluded-host list and the "own pid" exclusion are Windows shell specifics; in an Electron app the own process is a tree (main, renderer, GPU, utility), and `FindRoot` collapses same-image children onto the main process, so pass the main process pid as the excluded pid.

---

## 6. Existing test coverage (`MeetingLive.Core.Tests`)

Namespace `MeetingLive.Core.Tests.Services` unless noted. Cases listed must carry over (as the same behavior, adapted to the new language).

**`AudioCaptureServiceTests`** (fakes: `AudioCaptureFakes.cs` provides `FakeWaveIn`, `DiskFullStream`; 6400 bytes per pump write; disk-full limit 7000 bytes)
- `PumpFault_ReachesTheCallerWhileStillRecording`: fault event fires, `IsRecording` still true, `StopAsync` throws the IO error.
- `PumpFault_StopRethrowsCleansUpAndLeavesReadableAudio`: stop rethrows, not recording, each device disposed once, WAV readable at 16000 Hz with length > 0.
- `PumpFault_AfterStopANewRecordingCanStart`.
- `PumpFault_ThrowingFrameSubscriberIsAlsoSurfaced`.
- `TeardownStepFailure_RunsTheRestAndReachesTheCaller`: mic stop throws, output still stopped and disposed, WAV readable.
- `MicrophoneLost_WarnsAndKeepsRecordingWithTheOutput` (source Microphone, remaining 1, no stop event, still recording).
- `MicrophoneLost_TheOutputStillReachesTheMix` (frame with sample > 0.1 after mic death).
- `SystemLoopbackLost_WarnsAndKeepsRecordingWithTheMicrophone`.
- `BothSourcesLost_TheLastWarningSaysNothingIsLeft` (remaining 1 then 0).
- `OnlySourceLost_SaysNothingIsLeft` (system only, remaining 0).
- `ProcessOutputLost_KeepsItsExistingStopBehavior` (OutputCaptureFailed once, no source-lost, stop rethrows, not recording).
- `MicrophoneLost_DuringProcessCapture_WarnsAndKeepsRecording`.
- `UserStop_IsNeverReportedAsAFailure` (zero events on a clean stop).
- `IsSourceLost_NeedsAnErrorAndNoUserStop` (theory: only error and not user stop is true).
- `ConcurrentStops_TearDownOnceAndAllComplete` (8 concurrent stops, one stop and one dispose per device).
- `ConcurrentStops_EveryCallerSeesTheSameFailure`.
- `Stop_WhenNotRecording_DoesNothing`.
- `Dispose_AfterAFault_DoesNotThrow`.

**`RecordingCaptureSourcesTests`**
- `SystemLoopback_WithDeviceId_KeepsMicrophoneAndDoesNotRequireProcessId`; `SystemLoopback_CaptureMicrophoneFalse_IsDistinctFromNullDeviceId`; `ProcessTree_ProcessIdZero_ThrowsArgumentOutOfRangeException`; `ProcessTree_NonZeroProcessId_DoesNotUseSystemLoopback`; `Create_SystemLoopbackWithProcessId_ThrowsArgumentException`.
- `AudioClientActivationParams_IncludeTree_Is12BytesWithHeaderOffsets` (struct is 12 bytes; offsets 0, 4, 8; Windows-specific).
- `ShouldSurfaceOutputFailure_ErrorWhileRecording_IsTrue`, `_NullError_IsFalse`, `_UserStop_IsFalse`, `_SystemLoopbackError_IsFalse`.
- `PropVariant_PinnedBlobCarrier_MatchesNativeSize` (Windows-specific).

**`ActiveAudioAppServiceTests`** (29 methods incl. theories): root roll-up with same image, stops at a different image, recycled parent pid (parent started after child), missing parent, parent cycle terminates, two sessions same root = one entry with max peak, two roots same exe both playing = two entries, only one playing = one entry, inactive silent excluded, inactive above threshold included, active with zero peak included, inactive below threshold excluded, system sounds excluded, own process tree excluded, ten shell/system hosts always excluded (theory), unresolvable process skipped, pid 0 skipped, access-denied exe path -> process name and no roll-up, friendly name preference (description, then product name, then process name), `IsBrowser` by exe name (theory), `IsKnownMeetingApp` by exe name (theory), ordering by friendly name, peak on the entry, `ReadPeaks` returns latest per root without re-enumerating, `ReadPeaks` before `Refresh` is empty, `ReadPeaks` ignores unmapped sessions.

**`ActiveAppEntriesTests`**: nothing selected returns all available; selected still playing stays available without duplicate; selected stopped kept as unavailable; unavailable inserted in name order; nothing playing and nothing selected is empty; `IsStillRunning`: gone false, same image true, pid reused by another image false, unreadable path trusts the existing process.

**`MeetingAppSuggestionTests`** (cross-module, consumes `ActiveAudioApp`): suggested when a meeting app plays; none when an app is already selected; none when no meeting app; dismissed pid skipped; dismissed pid does not hide another app; loudest wins; equal loudness first by name; empty list.

**`RecordAudioSourceMemoryTests`**: remember device stores kind and id; non-device clears id; keeps every other setting; remember app stores kind, path, name; remember system clears the app; restore: nothing remembered uses Settings device when present, otherwise System default; remembered None stays None; remembered device plugged in is that device; unplugged falls back to System default not None; unknown kind falls back to Settings microphone; app restore: nothing remembered null, remembered system null, remembered app playing returns it with the current pid (path compare ignores case), not playing null, no path null; `Settings_SurviveAJsonRoundTrip`.

**`AudioLevelMeterTests`**: at or below floor (0, 1e-6, 0.0005) is 0 (theory); full scale 1; above full scale clamps to 1; -30 dB is 0.5; typical speech in [0.5, 0.6]; negative is 0; NaN is 0; louder never reads lower.

**`PcmLevelNormalizerTests`**: int16 silence unchanged; quiet speech raised toward target; already loud unchanged; below the silence floor unchanged; float32 quiet utterance gets one gain; different chunk peaks would pump the level (documents why not to normalize per chunk); no int16 overflow.

**`WavHeaderRepairTests`**: valid file bytes identical; valid file last-write time unchanged; zero sizes repaired and fully readable; app layout with 18-byte fmt repaired; odd trailing byte rounds data size down to block align (riff size = 44 + N - 8 in the test's layout); extra LIST chunk before data; overstated data size (0xFFFFFFFF both); zero RIFF size only fixes RIFF and keeps data size; non-WAV bytes -> `NotWav` untouched; truncated header -> `NotWav`; compressed format -> `Unsupported` untouched; missing file -> `Failed` without throwing; file locked by a writer -> `Failed` without throwing.

**`WavHeaderFlushCadenceTests`**: below interval false; at interval true once; next interval counts from the last flush; `ForFormat` uses seconds of audio; non-positive interval throws (theory 0, -1); writer `Flush` while open leaves a readable copy with the written length; flush then more writes then flush covers all audio; writer without flush leaves an unreadable header in a copy.

**`MicrophoneLevelMeterServiceTests`**: failing start disposes the capture; a start after a failed start opens a working capture; a capture that cannot be created does not throw; stop disposes a started capture once.

**`AudioImportServiceTests`**: stereo 44.1 kHz PCM becomes 16 kHz mono PCM16 and keeps the duration within 50 ms; already 16 kHz mono yields a valid WAV with length > 0; missing source throws `FileNotFoundException` and creates nothing; non-audio bytes throw and leave no valid WAV.

**`WindowsProcessInfoProviderTests`**: current process returns image path (equal ignoring case to the process path), a non-zero parent, a start time not in the future; the parent of the current process started before the child (when found); pid 0 returns null; missing file returns null version info.

Not covered by any test (a port needs new tests): pause/resume timing and draining, pacing of the pump against the wall clock, the 5 s header flush inside the pump, PCM16-to-float frame conversion and the "only when subscribed" rule, resampling/downmix/mix numeric correctness and clamping, `ProcessLoopbackCapture` (activation, timeouts, silent flag, teardown), `MicrophoneDeviceResolver` fallback, `MicrophoneDeviceService`, `NAudioAudioSessionSource`, `WavFileDuration`, `RecordingAudioSourcesViewModel` (polling, restore, fallback bar, suggestion dismissal), `RecordingPageViewModel` capture event handling and warning precedence, the microphone dropdown reload logic, `ComputeRmsLevel` formats.

---

## 7. Bugs, races and uncovered cases

Confirmed (verified by reading the code, and for C3 also by running NAudio):

- **C1. Failed Start leaves an empty WAV file on disk.** `AudioCaptureService.cs:135` creates the writer (header written) before devices start (`143-144`). `AbortFailedStart` (`336-397`) disposes the writer and never deletes the file. `RecordingPageViewModel.cs:1289-1299` (the catch) does not delete `audioPath` either. A failed start (for example process-loopback activation timeout) leaves a 46-byte, zero-audio WAV in the library folder. Port: delete the file in the abort path.
- **C2. Import does not downmix more than 2 channels.** `AudioImportService.cs:32` averages only `Channels == 2`. A 5.1 or other multichannel source keeps its channel count through resampling and 16-bit conversion, so the output is not mono, against the interface contract (`IAudioImportService.cs:7`). Port: downmix any channel count.
- **C3. A microphone with more than 2 channels makes Start fail.** `AudioCaptureService.cs:405-411` downmixes only 2-channel sources; the mixer rejects a non-mono input (verified: adding a stereo provider to the mono mixer throws), so Start throws and the user sees `Error_StartRecording`. Rare (multichannel array mics in shared mode). Port: downmix any channel count.
- **C4. Level bar during recording shows the mix, not the microphone.** `RecordingPageViewModel.cs:1820-1831` feeds `MicLevel` from the mixed stream (mic plus meeting audio), while before recording the same bar shows the microphone only (`MicrophoneLevelMeterService`). The bar is labelled `RecordPage_MicLevelBar.AutomationProperties.Name` = "Microphone level". With microphone None it still moves. Decide intentionally in the port.
- **C5. No recovery of crashed recordings except at transcription time.** `WavHeaderRepair.Repair` is called only at `AudioCaptureService.cs:245` (after a failed final flush) and `TranscriptionService.cs:67`. There is no startup scan, so after a crash or kill the WAV (sizes 0, up to 5 s of audio lost) is unreadable by anything that opens it before transcription (`WavFileDuration`, playback).
- **C6. `PcmLevelNormalizer` is dead code in production.** Referenced only by its tests (`rg PcmLevelNormalizer`). Quiet microphones are not boosted anywhere.
- **C7. No OS capability check for process loopback.** The app declares `TargetPlatformMinVersion 10.0.17763.0` (`MeetingLive.App.csproj:5`), but process loopback activation is documented as requiring a newer Windows (Microsoft documents build 20348 for the API; verify before relying on a lower bound). `ProcessLoopbackCapture.cs:439-498` does not check; on older systems the user sees the raw message "Process loopback activation failed: 0x{hr:X8}. ..." inside `Error_StartRecording`.

Suspected (needs a device or runtime test):

- **S1. A process-tree capture does not notice that the target exited.** `ProcessLoopbackCapture.cs:270-286` ends only on stop or error. If the stream just goes quiet when the app quits, the recording continues writing silence for the other side with no warning.
- **S2. Default device change mid-recording is not followed.** `AudioCaptureService.cs:332-334` binds system loopback and the mic to the endpoint at Start. If the endpoint is invalidated the source is reported lost (warning) and not re-opened.
- **S3. An error-free unexpected stop is ignored.** `IsSourceLost` and `ShouldSurfaceOutputFailure` (`AudioCaptureService.cs:78-85`) both require an exception; if a capture stops itself with a null error nothing is reported and that source silently contributes silence.
- **S4. Concurrent `MicrophoneLevelMeterService.Start` calls can leak a capture.** `MicrophoneLevelMeterService.cs:28-51`: two overlapping calls both pass `Stop()`, both create captures and the second overwrites `_capture`; the first stays running with handlers attached. The service is a singleton shared by the Settings page and the Record page (`AppServices`), both started from UI-thread code today.
- **S5. `MicrophoneDeviceResolver` leaks one COM enumerator per call.** `MicrophoneDeviceResolver.cs:19` never disposes it (commented as intentional).
- **S6. Helper processes with a different image are not rolled up.** `ActiveAudioAppService.cs:149-170` only climbs to a parent with the same image. An app whose audio is produced by a differently named child (for example a WebView2 host under `ms-teams`) appears as the child's name, is not flagged as a known meeting app, and capturing it records only that child's subtree.
- **S7. Long executable paths.** `WindowsProcessInfoProvider.cs:68` uses a 1024-character buffer; a longer path returns null, so the app gets no roll-up and no icon or friendly name.
- **S8. Culture-dependent ordering.** `ActiveAudioAppService.cs:125`, `ActiveAppEntries.cs:19`, `MeetingAppSuggestion.cs:20` order names with the current culture; the same machine state orders differently per locale. Define a locale explicitly in the port.
- **S9. Apps playing to a non-default output device are not listed.** `NAudioAudioSessionSource.cs:26` reads only the default render endpoint, although process loopback would capture them regardless of device.
- **S10. Repair over-extends the data chunk when trailing chunks exist.** `WavHeaderRepair.cs:131-137`: when the data size is 0, the new data size runs to end of file, including any chunk after the audio. The app's own files have no trailing chunks, so low risk.
- **S11. Ambiguity between two running instances of one app.** `RecordAudioSourceMemory.cs:75` picks the first active app with the remembered exe path (sorted by name then pid), which may not be the one in the call.
- **S12. One bad capture endpoint can hide every microphone.** `MicrophoneDeviceService.cs:15` reads `FriendlyName` without a guard; an exception propagates, and `RecordingPageViewModel.cs:1983-1986` swallows it and uses an empty list (only None and System default remain).
- **S13. Float to int16 asymmetry.** The file uses `x * 32767` (clamped), live frames use `/ 32768`, so full-scale negative reads as -0.99997. Negligible.
- **S14. Start can block for up to about 17 s with no UI feedback specific to capture.** The 12 s activation wait plus the 5 s start wait run inside `Task.Run(Start)` after the mic was opened and started; the status text only changes after Start returns (apart from the model-loading status).

Design points a porter must keep (not bugs): stopping takes `IsRecording` false only at the very end of teardown; a pump fault leaves devices running until the caller stops; Settings and Record page hold separate microphone preferences (the Record page value wins once set); process-loopback failure ends the recording while system-loopback or microphone failure only warns; an unavailable (stopped) app stays selected and dimmed until Record is pressed.

---

## 8. Parity checklist

Tick each item when the port reproduces the behavior and a test covers it.

### Capture request and validation
1. `RecordingCaptureSources` has captureMicrophone, microphoneDeviceId, output kind (SystemLoopback or ProcessTree) and processId.
2. Output is exactly system loopback or one process tree; both or neither is impossible.
3. An undefined output kind throws "Output must be exactly system loopback or one process tree.".
4. ProcessTree with pid 0 throws (argument out of range, "Process id 0 is not a valid capture target.") before any device opens.
5. SystemLoopback with a non-zero pid throws "System loopback cannot also target a process.".
6. Null or empty device id with microphone enabled means the OS default input; microphone disabled never opens a mic regardless of id.
7. The legacy `Start(path, deviceId)` overload equals system loopback with the microphone on.
8. Start validates the request before touching a device.
9. Starting while `IsRecording` throws "A recording is already in progress." (also during a stop).

### Mixing and file output
10. Mix format is 16 kHz mono float; file format is PCM16, 16 kHz, 1 channel.
11. Microphone input is optional; exactly one output input is always present.
12. Each source has a 5-second buffer that drops new data on overflow and pads silence on underrun.
13. Stereo sources are averaged to mono with weights 0.5 and 0.5.
14. Non-16 kHz sources are resampled (WDL-quality) to 16 kHz.
15. Sources of more than 2 channels are downmixed to mono (fixes C3).
16. Sources are summed with no attenuation and clamped to [-1, 1] before conversion to int16 (x32767).
17. The pump writes 6400-byte (200 ms) chunks.
18. The pump is paced by a wall clock so the file duration equals recorded time minus paused time.
19. The mixer or pump fills periods with no source data with silence.
20. A pump that falls behind catches up without sleeping.
21. The WAV header is flushed every 160000 written bytes (5 s of audio), counting from the last flush; flush IO errors are ignored.
22. The header flush counts bytes, so paused time does not trigger it.
23. Output path is created by the writer at Start; the file is closed and readable after Stop.

### Live frames
24. `PcmFrameAvailable` carries float32 samples (int16/32768) and sample rate 16000, 200 ms per frame.
25. The event is raised only when there are subscribers and the chunk has at least 2 bytes.
26. The event is raised from the pump after the write.
27. A throwing frame subscriber turns into a pump fault that is reported and kept for Stop.
28. During recording the level bar value is RMS -> level curve -> x100 on the UI thread; empty frames are ignored.

### Pause and resume
29. `Pause()` is a no-op when not recording; `Resume()` too.
30. While paused the pump drains and discards source data, sleeps 50 ms per loop, writes nothing, raises no frames and does not flush.
31. Paused time is excluded from the pacing clock.
32. Stop clears the paused state.
33. Paused status text is `Status_Paused` and resuming restores the recording status (a source warning wins).
34. The caller tracks paused duration and passes it as live ASR clock skew on resume.

### Start failure handling
35. Any failure during Start stops and disposes everything opened, individually guarded, and rethrows the original error.
36. The pump cancellation token is published before devices start so an immediate device failure can cancel it.
37. A failure that happens between device start and `IsRecording = true` is handled by the caller right after Start returns.
38. A failed Start does not leave a header-only WAV file behind (fixes C1).
39. The caller shows `Error_StartRecording` with the exception message and restarts the idle mic preview.

### Stop
40. Stop is single flight: concurrent callers share one task and one outcome (including the exception).
41. Stop when not recording does nothing and does not touch devices.
42. Teardown order is: set user-stop, detach handlers, stop mic, stop output, cancel pump, await pump, flush and dispose writer, dispose devices and token.
43. Every teardown step runs even if an earlier one failed; the first error is kept.
44. If flush or dispose of the writer fails, the file header is repaired from the file length.
45. The reported failure is pump failure, else output failure, else the first teardown error; all stored failures are cleared; it is thrown to every waiting caller.
46. `IsRecording` becomes false only after teardown; the instance can start a new recording after a failed stop.
47. Dispose stops and swallows errors; sync Stop must not be used from UI code.
48. A caller-initiated stop never raises source-lost, output-failed or faulted events.
49. The page detaches capture handlers before awaiting Stop and shows `Error_StopRecording` unless a capture failure message is already showing.

### Failure classification
50. Source lost = error present and not user stop.
51. Process-tree output failure is surfaced only when error present, not user stop and output is a process capture.
52. A process-tree failure stores the error, cancels the pump and raises `OutputCaptureFailed`; it is not a source-lost event.
53. A system-loopback or microphone error raises `CaptureSourceLost(source, remaining, error)` and recording continues.
54. `remaining` starts at 2 with a mic or 1 without, is decremented atomically per lost source and clamped at 0.
55. Microphone loss during a process capture is a warning, not a stop.
56. `CaptureFaulted` fires on pump failure when not stopping; the recording is not auto-stopped by the service.
57. The page handles only the first output/faulted failure, shows its message, and starts the stop path.
58. Source-lost key: `Warning_NoAudioSourcesLeft` when remaining is 0, else mic -> `Warning_MicrophoneLost`, else `Warning_OutputAudioLost`.
59. `Warning_NoAudioSourcesLeft` is never replaced by a later warning.
60. An active warning replaces the recording status text and survives pause/resume status refreshes.
61. Every message key listed in section 2 exists in English and Spanish with identical placeholders.

### Process-tree loopback
62. Pid 0 is rejected in the constructor.
63. Activation blob is 12 bytes: type 1, pid, mode 0 (include process tree), little endian.
64. The variant carries the blob (blob type, size 12) and both stay pinned until the completion callback returns, even after a waiter timeout.
65. Activation target is the process-loopback virtual device with the audio client interface.
66. Activation wait is 10 s with "Process loopback activation timed out after 10 seconds."; constructor wait is 12 s with "Process loopback activation did not finish within 12 seconds.".
67. A failed activation HRESULT yields "Process loopback activation failed: 0x{hr:X8}. {message}".
68. A late activation result is released if no one is waiting.
69. Format is fixed at 48 kHz, 16-bit, 2 channels with automatic conversion; the format cannot be set.
70. Initialize flags are loopback, event callback and auto-convert PCM, shared mode, zero buffer duration.
71. Capture loop waits 200 ms on the buffer event and drains all available packets.
72. Packets flagged SILENT are zero-filled, never copied.
73. Every acquired packet is released even if copying fails.
74. A throwing data subscriber does not kill the capture thread.
75. An unexpected capture error is stored and reported through the stopped event.
76. Start waits up to 5 s ("Process loopback capture did not start."); start errors are wrapped with "Process loopback capture failed to start: 0x{hr:X8}. {message}".
77. Stop sets a flag, wakes the thread, joins up to 5 s, releases COM objects, uninitializes COM only if this thread initialized it.
78. The stopped event fires exactly once per instance; Dispose is idempotent.
79. Process loopback never falls back to system loopback.
80. COM apartment is multithreaded; a changed-mode error is tolerated.
81. Detect that the target process exited and report it (new behavior for S1).

### Microphone list and resolution
82. The list contains active capture endpoints only, each with id and friendly name.
83. Resolution: non-empty id and active state -> that device; any failure or inactive -> default capture device (console role).
84. The same resolution is used for recording and the preview.
85. A stale device id never throws; only "no default device" does.

### Microphone preview
86. `Start` stops any previous preview first.
87. `Start` never throws and leaves no half-open capture on failure; a later start works.
88. `Stop` is idempotent and safe when not started.
89. A device that stops itself is disposed and a level of 0 is raised.
90. Level = RMS over all interleaved samples (float32, int16/32768, int32/int.MaxValue; other depths 0; non-finite skipped), clamped to [0, 1].
91. Levels arrive on a background thread and are marshalled to the UI, x100 and clamped to [0, 100].
92. Preview runs on the Settings page and the idle Record page only when the page is visible, not recording, not processing, and the mic choice is not None.
93. Preview stops before Start of a recording and on import start; it restarts after a failed start or import.

### Settings microphone picker
94. Items: System default sentinel (empty id) then the endpoints.
95. Saved id selects its item or System default; programmatic selection does not trigger a save.
96. Picking a new item saves `selectedMicrophoneDeviceId` (null for default) and restarts the meter; re-picking is ignored.
97. Selection events during page load are ignored.
98. The meter stops and unsubscribes when leaving the page.

### Record page microphone choice
99. Items are None, System default, then devices, with the labels given in section 2.1.
100. Reload on page show and on dropdown open; identical lists are not rebuilt.
101. Reload keeps the user's choice; a vanished device falls back to System default.
102. A stale async reload is discarded; load errors give an empty device list.
103. Selection and capture request mapping: None -> mic off; System default -> mic on, null id; Device -> mic on, id.
104. Summary line "Mic: {0} · Audio: {1}" updates on any change.

### Remembered choices
105. Microphone kind and device are stored as "None", "SystemDefault", "Device" and an id (id only for Device).
106. System audio choice stores "System" and clears app path and name.
107. App choice stores "App", exe path and name.
108. Restore parses kind case-insensitively; unknown or undefined falls back to the Settings microphone.
109. Restore of None stays None; an unplugged Device falls back to System default (never None).
110. Device ids compare ordinally.
111. Restore of the app matches by exe path (case-insensitive) among currently playing apps and returns the live pid; otherwise null.
112. A remembered app that is not playing is never auto-selected; no message is shown.
113. The restore runs once per poller start after the first enumeration, only if the user has not picked a card.
114. Saving always loads current settings, mutates, then saves; failures are ignored.

### Active app discovery
115. Sessions come from the default render endpoint, re-resolved on each enumeration.
116. Enumeration swallows audio-service errors and returns an empty list.
117. System sounds and pid 0 sessions are skipped.
118. Active = state active or peak > 0.001.
119. Unresolvable processes are skipped.
120. Own pid and the ten shell/system hosts are excluded (checked on the process and on its root).
121. Root resolution climbs while the parent has the same image, with cycle guard, depth cap 32, and recycled-pid rejection by start time.
122. Unknown exe path means no climb and name by process name.
123. One entry per root; peak is the max over its sessions.
124. Friendly name preference: file description, product name, process name (trimmed, non-blank).
125. Browser list: chrome, msedge, firefox, brave, opera, vivaldi, arc.
126. Meeting app list: zoom, teams, ms-teams, webex, webexmta, slack, discord, skype, cpthost.
127. Result is ordered by friendly name (case-insensitive) then pid.
128. `ReadPeaks` uses the cached session-to-root map without re-enumerating and ignores unmapped sessions.
129. Poll: immediate refresh, 150 ms tick, full refresh every 10th tick, peaks otherwise; stale results dropped; errors end the loop silently; runs only while the Record page is visible and idle.

### Picker cards
130. "All system audio" card is first, always present, selected by default, has no meter.
131. App cards show name, icon (fallback glyph), live meter (curve x100), tags (Detected, Records all tabs, Not playing) per state.
132. A selected app that stops playing stays as an unavailable (dimmed, level 0) card inserted in name order.
133. Cards are reused by pid; list updates are minimal moves.
134. Empty hint shows when no available app card exists.
135. Selecting a card marks it user-touched, clears the fallback bar, remembers it.
136. At Record time a gone app (pid missing, or image path changed) falls back to all system audio and shows the "Audio source changed" bar with the message.
137. A still-running app returns its root pid as the capture target.
138. Meeting-app suggestion is shown only for all-system selection; loudest known meeting app, tie by name; dismissed pids are skipped for the session; action selects the card.
139. Suggestion evaluation waits for the remembered-app restore.

### Import
140. Extension filter is `.wav .mp3 .m4a .aac .flac .wma .3gp .mp4`.
141. `recordedAt` is the source's last-write time, now if unreadable or the minimum value.
142. Missing source throws "The audio file was not found."; blank paths throw.
143. Destination directory is created.
144. Output is 16 kHz mono PCM16 WAV; channel counts other than 2 are also downmixed (fixes C2).
145. Zero output bytes throws "The audio file contained no samples.".
146. Cancellation is honored between buffers.
147. Any failure deletes the partial destination file.
148. Page shows `Status_Importing`, `Error_ImportAudio`, deletes the partial file and restarts the preview on failure.
149. `endedAt` = `recordedAt` + the converted WAV duration.

### WAV utilities
150. `WavFileDuration` returns the decoded total time and rejects blank paths.
151. `WavHeaderRepair` returns Valid, Repaired, NotWav, Unsupported or Failed, never throws on IO errors.
152. Repair follows chunk sizes with word alignment, accepts 16-byte and 18-byte fmt chunks and extra chunks before data.
153. Only PCM (1) and IEEE float (3) with non-zero block align are supported.
154. Data size is broken when zero with at least one frame available or beyond the file end; RIFF size is broken when zero or `riff + 8 > length`.
155. Repaired data size is rounded down to whole frames; RIFF size = end of audio - 8.
156. A consistent file is left byte-identical with an unchanged last-write time.
157. Repair refuses (Failed) if the file length changes between analysis and write, and files over 4 GiB are Unsupported.
158. Repair runs before transcription and after a failed final flush; recover crashed recordings at startup (new, fixes C5).

### Level helpers
159. `ToMeterValue` follows the -60 dBFS floor curve with 1e-6 minimum, NaN -> 0, clamp [0, 1].
160. `PcmLevelNormalizer` constants (0.70, 16, 0.002) and gain rule are preserved or the feature is deliberately dropped (C6).
161. Normalization is never applied per pump chunk.

### Platform
162. Native capture sits behind interfaces: microphone source, system-loopback source, process-tree source, session/peak source, process-info provider.
163. Windows-only pieces (WASAPI, process loopback activation, session enumeration, process queries, Media Foundation decode) are isolated from the portable rules.
164. Process loopback is gated by an OS capability check with a clear message (fixes C7).
165. In the Electron app the app's own whole process tree is excluded from the active list (main pid as excluded pid).
