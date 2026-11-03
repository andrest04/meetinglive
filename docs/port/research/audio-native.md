# Native audio capture for the Electron port (Windows first, macOS later)

Research date: 2026-11-02. Scope: microphone (WASAPI), system loopback, per-process-tree loopback, delivered to an Electron app, then resampled to 16 kHz mono for local inference.

Labels used below: **[V]** verified against a primary source fetched during this research (URL given), **[A]** assumption or inference, **[U]** could not be verified from a primary source in this session.

## 1. Findings

### 1.1 Per-process loopback on Windows

- **[V]** `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` is "Process loopback activation, allowing for the inclusion or exclusion of audio rendered by the specified process and its child processes." Header `audioclientactivationparams.h`. Minimum supported client: **Windows 10 Build 20348**. https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type
- **[V]** Microsoft's ApplicationLoopback sample captures "only audio from the specified process, and its children" (include mode) or everything except that tree (exclude mode). It states it needs build 20348 or later, and that a target process with no rendering streams yields silence. https://github.com/microsoft/windows-classic-samples/tree/main/Samples/ApplicationLoopback
- **[V]** Sample mechanics (source read): the device ID is the constant `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`; activation params carry `ActivationType`, `ProcessLoopbackMode` (include/exclude tree) and `TargetProcessId`. The sample does not call `GetMixFormat`; it hard-codes a PCM format (44.1 kHz, 16-bit, stereo) and initializes with `AUDCLNT_SHAREMODE_SHARED`, `AUDCLNT_STREAMFLAGS_LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM`. `SRC_DEFAULT_QUALITY` is present but commented out. https://raw.githubusercontent.com/microsoft/windows-classic-samples/main/Samples/ApplicationLoopback/cpp/LoopbackCapture.cpp
- **[V]** Real-world reports say it works on build 19041 (Windows 10 2004): GStreamer's wasapi2 element first gated at 20348 per the docs, then lowered the check to 19041 because "other software enables this" there. This is third-party evidence, not a Microsoft statement. https://git.fasttube.de/FaSTTUBe/GST-Tensordecoder-ov_ep/commit/c98ad6f249f72db4eb6a2bca911f3c57808b197e (mirror of the GStreamer change). **[A]** Treat 19041 as "probably works, untested by us"; documented floor is 20348.

### 1.2 Libraries and what they support

| Option | Per-process loopback | Evidence |
|---|---|---|
| `wasapi` crate (HEnquist/wasapi-rs) 0.26.0, MIT, released 2026-10-11, ~483k downloads, needs Rust 1.85 (example needs 1.88) | **Yes** | **[V]** `AudioClient::new_application_loopback_client(process_id, include_tree)` calls `ActivateAudioInterfaceAsync` with `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` and `PROCESS_LOOPBACK_MODE_INCLUDE_/EXCLUDE_TARGET_PROCESS_TREE`. Source: https://raw.githubusercontent.com/HEnquist/wasapi-rs/master/src/api.rs ; example https://docs.rs/crate/wasapi/latest/source/examples/record_application.rs ; metadata https://crates.io/api/v1/crates/wasapi |
| `cpal` (RustAudio) | **No** | **[V]** In `src/host/wasapi/device.rs`, `ActivateAudioInterfaceAsync` is used only for the default render/capture virtual interfaces; loopback is the classic `AUDCLNT_STREAMFLAGS_LOOPBACK` on a render endpoint. No process-loopback code. A search of cpal's issue tracker for "process loopback" returned no matching issue. https://raw.githubusercontent.com/RustAudio/cpal/master/src/host/wasapi/device.rs , https://github.com/RustAudio/cpal/issues?q=process+loopback |
| Raw Win32 via C++ (`node-addon-api`) or Rust `windows` crate | Yes | **[V]** This is exactly what the Microsoft sample does (above). |
| Electron `getDisplayMedia` with `audio: 'loopback'` | **No (whole-system only)** | **[V]** Electron docs: "Specifying a loopback device will capture system audio, and is currently only supported on Windows"; `loopbackWithMute` also exists; a `WebFrameMain` value captures that frame's `webContents` audio only. No process-tree option. https://www.electronjs.org/docs/latest/api/session |

`wasapi` crate caveats **[V]** (same api.rs): the process-loopback client does not support `get_mixformat`, `is_supported`, `get_device_period`, or `get_audiorenderclient`; only `Direction::Capture` in shared mode works; activation blocks the calling thread (do not call on a UI thread); COM initialization is the caller's job (the doc comment mentions STA, the example uses MTA, so the crate documentation is internally inconsistent; test on our target).

### 1.3 Resampling to 16 kHz mono

- **[V]** Windows can convert for you: the Microsoft sample and the `wasapi` example both request a fixed format with `AUTOCONVERTPCM` (the `wasapi` example asks for 32-bit float, 48 kHz, 2 ch with autoconvert) rather than asking the client for its mix format.
- **[A]** Requesting 16 kHz mono directly from the audio engine is unverified. `AUTOCONVERTPCM` is documented to convert PCM, but the sample/channel ranges accepted for the process-loopback virtual device were not confirmed in this session. Safer design: capture at 48 kHz float stereo (known to work in the `wasapi` example), then downmix and resample in the addon (Rust: `rubato` or `fon`; **[U]** not evaluated here), emitting 16 kHz mono Int16/Float32 frames. This keeps one code path for mic, system, and process streams and keeps quality under our control.
- **[A]** Mixing mic and system into separate tracks (not a single mix) is preferable for diarization-by-channel; the addon should expose them as separately tagged streams.

### 1.4 Electron ABI

- **[V]** Node-API is "ABI stable across versions of Node.js ... modules compiled for one major version to run on later major versions without recompilation." The guarantee holds only if the addon uses Node-API exclusively (no V8/libuv/node.h). https://nodejs.org/api/n-api.html
- **[V]** Electron's guide says native modules "will need to be recompiled for Electron" and to rebuild after upgrading Electron; that guide predates or ignores Node-API stability. https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules . Electron's native-code guide names napi-rs, neon and node-bindgen as Rust options and uses `node-addon-api` for C++. https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron
- **[V]** `@electron/rebuild` prefers Node-API prebuilt binaries (Electron N-API file, then generic N-API file, then ABI-specific). Search summary, secondary source: https://github.com/electron/rebuild
- **[V]** napi-rs: Node-API level is chosen at project creation; per-platform optional npm packages (`win32-x64-msvc`, `darwin-arm64`, ...); CLI needs Node `^20.17 || ^22.13 || >=23.5` and Rust 1.88+. https://napi.rs/docs/introduction/getting-started . The page does not mention Electron. **[A]** A napi-rs addon that avoids V8-specific APIs loads in Electron the same as in Node; confirm with a smoke test in CI against our pinned Electron.
- **[V]** Current Electron stable observed: v45.2.1 (Chromium 156.0.8078.75). https://github.com/electron/electron/releases/latest

### 1.5 macOS future path

- **[V]** Electron docs: on macOS 14.2+, `NSAudioCaptureUsageDescription` must be in Info.plist for `desktopCapturer` audio; from Electron 39, Chromium uses the CoreAudio Tap API by default, with "no automatic fallback" to ScreenCaptureKit if tap creation fails; a missing permission yields an audio track that is `ended` and delivers no samples, with no error surfaced. https://www.electronjs.org/docs/latest/api/desktop-capturer
- **[U]** Apple's own documentation pages for Core Audio taps and `SCStreamConfiguration.capturesAudio` could not be read (only titles returned). The following is from model knowledge and must be re-verified before design: process taps (`AudioHardwareCreateProcessTap`, `CATapDescription`) need macOS 14.2+; they accept a list of process objects (PID to object translation via `kAudioHardwarePropertyTranslatePIDToProcessObject`); capture goes through an aggregate device plus IOProc. ScreenCaptureKit audio needs macOS 13+ and Screen Recording permission.
- **[V]** cpal's README table lists "loopback recording requires 14.6+" for macOS CoreAudio, which suggests cpal exposes system loopback on macOS only; it is not a per-process solution. https://github.com/RustAudio/cpal
- **[A]** A Rust crate layout with `cfg(target_os)` modules behind one trait (`start(source) -> stream of 16 kHz mono frames`) fits: `wasapi` on Windows, Core Audio taps (via `objc2`/`coreaudio-rs`, **[U]** not evaluated) on macOS.

### 1.6 Chromium/Web Audio

- **[V]** Chromium has landed work on Windows window/process-based audio capture for `getDisplayMedia` (WASAPI implementation, May 2025). Final shipped status and whether Electron exposes it were **[U]**. https://groups.google.com/a/chromium.org/g/chromium-reviews/c/Qtd8JuvEZ70
- **[V]** Electron's own docs show no per-process selector. So Web Audio/`getDisplayMedia` cannot target "Teams.exe and its children" today through documented Electron API.
- Web Audio latency and resampling (an `AudioContext` with `sampleRate: 16000`) are convenient, but **[A]** audio then lives in the renderer and is subject to throttling, permissions UI, and the macOS silent-failure behaviour above.

### 1.7 Prior art

- **[V]** Existing Node/Electron projects already wrap the Microsoft sample: `WerdoxDev/loopback-capture` (N-API port, returns Node Buffers, system + per-app), `WerdoxDev/application-loopback` and `@kokapuk/application-loopback` (native addon fork, tested on Windows 11 only), and `process-audio-capture-stdio` (C++ helper child process, audio forwarded over stdout). https://github.com/WerdoxDev/loopback-capture , https://www.pkgstats.com/pkg:@kokapuk/application-loopback , https://gh.r-mj.com/Need-an-AwP/process-audio-capture-stdio . Maintenance quality of these was not assessed; **[A]** we should not depend on them, but they show the pattern is viable in Electron.
- **[V]** Hazard from GStreamer's tracker: a capture client "will not produce any data if there's no outputting sound to corresponding render client" (loopback delivers no packets during silence). https://gitlab.freedesktop.org/gstreamer/gst-plugins-bad/-/merge_requests/1588 . **[A]** The addon must synthesize silence frames by timestamp so the stream stays aligned with the mic.

## 2. Comparison

Criteria weights reflect a meeting recorder: long sessions (1-3 h), must not drop or drift, must survive device changes, and must run alongside heavy local inference.

| Criterion | Rust addon (napi-rs + `wasapi`) | C++ `node-addon-api` | Rust/C++ sidecar process | Web Audio / `getDisplayMedia` |
|---|---|---|---|---|
| Per-process-tree loopback | Yes (**V**) | Yes (**V**, MS sample) | Yes | No |
| Mic + system loopback | Yes | Yes | Yes | Mic yes; system loopback whole-system only |
| Reliability under crash | A native fault kills the Electron main process unless the addon is loaded in a `utilityProcess` | Same | Isolated; supervisor can restart capture | Renderer-level, sandboxed |
| Latency path | Callback thread to JS via threadsafe function; low and controllable | Same | Extra hop (pipe or shared memory); sub-10 ms added is typical **[A]** | Renderer to main via IPC |
| Resampling to 16 kHz mono | In Rust, off the JS thread | In C++ (need a library) | Same as either | `AudioContext` 16 kHz, done by Chromium |
| Electron ABI | Node-API, no per-Electron rebuild if V8-free (**V** Node docs; **A** for Electron) | Same if `NAPI_VERSION` fixed | None (separate exe) | None |
| Build/CI complexity | Rust toolchain plus napi-rs CI; prebuilt per platform | node-gyp, MSVC, Python | Plain cargo/cmake exe; sign it separately | None |
| macOS future | `cfg` modules; share code | Obj-C++ file alongside | Same helper per OS | Electron 39+ tap path, silent-failure risk |
| Memory safety / maintenance | High | Lower | Depends on language | n/a |

## 3. Recommendation

**Use a Rust native capture module built with napi-rs on top of the `wasapi` crate, loaded in an Electron `utilityProcess` (not the main process), behind a platform-neutral `AudioSource` interface.**

Design:

1. One crate `vozella-audio` exposing: `list_endpoints()`, `start_mic(deviceId)`, `start_system_loopback()`, `start_process_loopback(pid, includeTree)`, each returning a stream of tagged 16 kHz mono frames via a napi-rs `ThreadsafeFunction`. Frames are produced on a Rust thread; JS never touches the capture callback.
2. Capture at 48 kHz float stereo with `AUTOCONVERTPCM`, downmix and resample in Rust, fill silence for gaps, timestamp with the QPC value from the capture client.
3. Windows: process loopback when build >= 20348 (optionally 19041+ behind a capability probe that attempts activation); otherwise fall back to whole-system loopback and surface this in the UI.
4. Spawn the module inside `utilityProcess` so a native crash only restarts capture. This keeps the single-binary distribution benefit of an addon with most of the isolation of a sidecar.
5. macOS later: add a `coreaudio_tap` backend (process taps, 14.2+) in the same crate; ScreenCaptureKit stays a fallback candidate.

Why not the others:
- **cpal**: no per-process loopback (**V**); would still need raw WASAPI code for the main feature.
- **C++ addon**: equivalent capability, worse memory safety and a heavier toolchain; no advantage unless the team prefers C++.
- **Pure sidecar**: strongest isolation and zero ABI concern, and it is the fallback if napi-rs-in-Electron proves flaky. Costs: a second signed executable, a framing protocol, and lifecycle management.
- **Web Audio/`getDisplayMedia`**: cannot do per-process capture, hides failures on macOS, and ties capture to the renderer.

Tradeoffs accepted: Rust toolchain in CI; `wasapi` is a single-maintainer crate (a thin wrapper, so replaceable with the `windows` crate if abandoned); `utilityProcess` adds a message hop to the main process.

## 4. Risks and open items

1. **OS floor**: documented minimum is build 20348; 19041 works per third parties only. Decide the supported Windows range and test on at least one 19041/19045 machine and one Windows 11 machine. Windows 10 22H2 is the likely common case and needs a real test.
2. **Silence stalls**: loopback may deliver no packets while nothing plays (**V** GStreamer note). Mitigate with timestamp-driven silence insertion; test with a paused call.
3. **Target PID selection**: the tree is rooted at the PID passed in; the `wasapi` example comment says to pass the parent. Electron/Chromium apps (Teams, Zoom, browsers) spawn separate audio-service processes, so choosing the right root PID needs a process-tree probe. **[A]** Not tested; needs spike with Teams, Zoom, Chrome, and Meet-in-browser.
4. **Format negotiation**: `GetMixFormat` is unsupported on the process-loopback client (**V**); confirm that 48 kHz float stereo and, separately, 16 kHz mono are accepted under `AUTOCONVERTPCM` on our target builds before relying on engine-side conversion.
5. **COM threading**: the `wasapi` crate docs are inconsistent (STA vs MTA). Run activation on a dedicated thread, off any UI thread; verify under `utilityProcess`.
6. **Device changes**: default-device switches, Bluetooth headset profile changes (sample-rate flips), and mic unplug during a meeting must restart the stream without losing alignment. Not researched; needs tests.
7. **Echo/double capture**: capturing the system mix plus the mic can duplicate remote speech if the user uses speakers. Exclude our own process tree with exclude mode, and consider AEC later. **[A]**
8. **Electron loading of the napi-rs addon**: not confirmed by a primary source; add a CI smoke test on the pinned Electron version and on `electron-builder`/`forge` packaging (asar unpack for `.node` files).
9. **macOS**: Apple API details are **[U]** here; Electron's own docs flag silent failure when the audio permission is missing, so the macOS backend needs an explicit permission check path. Re-fetch Apple documentation before starting that work.
10. **Content protection / DRM**: some apps may mark audio as protected; behavior with process loopback was not researched.
11. **Licenses**: `wasapi` is MIT (**V**); verify transitive licenses (resampler crate) when chosen.
12. **Existing app behaviour**: this research did not inspect the current WinUI3 capture implementation (out of scope); the port should match its current track layout and sample formats, which a separate module study should record.
