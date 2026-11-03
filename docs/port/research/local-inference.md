# Local inference for the Electron port

Date: 2026-11-02. Target: Windows 11, NVIDIA RTX 3070 (8 GB), CPU fallback; macOS later.
Status labels: **Verified** = read in a primary source or in this repo this session. **Assumption** = not verified; needs the spike listed in section 7.

## 1. How the current app does it (Verified, from the repo)

ASR
- `MeetingLive.Core/Native/NemoSpeechNativeLibrary.cs` loads `nemo_speech_asr_c.dll` from an extracted NeMo-Speech.cpp zip and binds 17 C exports by name (`nemo_speech_asr_create`, `_recognize_f32`, `_streaming_recognize`, `_stream_push_f32`, `_stream_next`, `_stream_finish`, `_stream_close`, `_result_*`, `_last_error`).
- All config structs are size-prefixed and built by hand (backend, model, streaming, endpointing, diarization, recognizer, recognition options).
- Settings in use: GPU index `0`, or `-1` for CPU; streaming chunk 0.16 s; `rnnt_right_context` 3 frames (320 ms) for live and 13 (1.12 s) for the offline post-Stop pass; energy endpointing at 800 ms; word timestamps, punctuation and optional Sortformer speaker tags on.
- The DLL is never unloaded. The code comment says unloading it while ONNX/CUDA worker threads run kills the process (`0xC0000409`). `FinishAndDrain` also aborts CUDA, so the app never closes a stream the normal way.
- `NemoSpeechRuntimeManager` downloads a pinned zip (v0.1.0, SHA-256 checked), extracts it to `cuda` or `cpu`, and uses an `.incomplete` marker. `SelectBackend` picks CUDA when an NVIDIA GPU is detected.
- Models (`NemotronAsrCatalog`): `nemotron-3.5-asr-streaming-0.6b.q8_0.gguf` (0.74 GB) and `diar_streaming_sortformer_4spk-v2.q8_0.gguf` (0.14 GB), downloaded from Hugging Face.

LLM
- `LocalLlmSummaryProvider` uses LLamaSharp 0.27.0 in process, with `LLamaSharp.Backend.Cpu` as the only backend package (`MeetingLive.Core.csproj`). `ModelParams` sets only `ContextSize` (4096); there is no GPU layer setting. **Finding: the current local LLM runs on CPU only, even on the RTX 3070.** GPU offload is new capability in the port, not a copy.
- Map-reduce summarization needs a token counter (`weights.Tokenize`) and token streaming.
- `ModelCatalog` has four Q4_K_M GGUFs: Llama 3.2 1B (0.81 GB), Gemma 4 E2B (3.11 GB), Gemma 4 E4B (4.98 GB), Gemma 4 12B (7.12 GB).

## 2. Findings

### 2.1 NeMo-Speech.cpp is a stable C ABI and has moved on

- Official NVIDIA runtime built on ggml, Apache-2.0. The embedding contract is the C ABI in `include/nemo_speech/` (opaque handles, no exceptions across the ABI). https://github.com/NVIDIA/NeMo-Speech.cpp , https://raw.githubusercontent.com/NVIDIA/NeMo-Speech.cpp/v0.3.0/docs/sdk.md
- ABI rule: size-prefixed structs are append-only; code built against an older header can pass a shorter struct and the runtime defaults new fields. So the 17 exports already used stay valid across versions. (sdk.md)
- Threading rule: one recognizer may serve concurrent calls; each stream is driven from one thread; `*_last_error()` is thread-local. (sdk.md)
- Latest release is **v0.3.0 (2026-10-30)**; the app pins v0.1.0 (2026-08-19). Windows assets in v0.3.0: `windows-x86_64-cpu.zip` (9 MB), `windows-x86_64-cuda.zip` (509 MB), `windows-x86_64-vulkan.zip` (22 MB), `windows-aarch64-cuda.zip`. macOS assets: `macos-aarch64-metal`, `macos-aarch64-cpu`, `macos-x86_64-cpu`. https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.3.0
- v0.3.0 fixes that matter for meetings: streaming no longer drops speech at stream start; word times stay inside the audio; long recordings without endpointing no longer collapse to one speaker after about 10 minutes (word speaker accuracy on AMI ES2002a 59.2% to 99.7%); ASR GGUFs are memory-mapped. (release notes, same URL)
- It also ships a `nemo-speech serve` HTTP server with an OpenAI-style transcription route and a realtime WebSocket `/v1/audio/transcriptions/realtime` taking PCM16 frames. https://raw.githubusercontent.com/NVIDIA/NeMo-Speech.cpp/v0.3.0/docs/api.md , docs/server.md. It binds 127.0.0.1:8080 by default, with optional `--api-key`.
- The README mentions no Node or Rust bindings. A Windows source build needs the CUDA Toolkit or Vulkan SDK; the prebuilt zips avoid that. (docs/install.md)
- Models: Nemotron 3.5 ASR Streaming 0.6B (40+ language-locales, language-ID prompt, `es-ES`/`en-US`/`auto`), Parakeet TDT 0.6B v3 (25 European languages, offline only, streaming requests are rejected), Parakeet CTC 1.1B (English), Nemotron 3.5 Transcribe 30B-A4B (speech-LLM, complete recordings, CUDA, too large for 8 GB by size alone; not evaluated). (docs/asr/models.md)

### 2.2 Spanish and English quality of the current model

Nemotron 3.5 ASR Streaming 0.6B, FLEURS WER by chunk size, from the model card (https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b):

| Chunk | 160 ms | 320 ms | 560 ms | 1.12 s |
|---|---|---|---|---|
| Spanish | 4.64 | 4.39 | 4.26 | 4.11 |
| English | 8.88 | 8.27 | 7.99 | 7.91 |

NVIDIA notes text normalization can inflate these. License OpenMDW-1.1, stated ready for commercial use. English-only users can use the separate English streaming model. The app's 320 ms live and 1.12 s offline profiles match these columns.

### 2.3 sherpa-onnx

- v2.0.1 (2026-10-26). `sherpa-onnx-node` 2.0.1 is a Node addon with prebuilt optional packages for win-x64, win-arm64, darwin-x64, darwin-arm64, linux. https://registry.npmjs.org/sherpa-onnx-node/latest
- It has a Nemotron multilingual streaming example with per-stream language pinning, using `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-1120ms-int8-2026-06-11` and `'provider': 'cpu'`. https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_asr_streaming_nemotron.js
- Windows CUDA builds exist as separate release tarballs (CUDA 12.x or 13.x with cuDNN 9); I found no sign that the npm package bundles CUDA. https://github.com/k2-fsa/sherpa-onnx/releases/latest . Running it on the GPU from Node would mean replacing the addon's native libraries by hand (**Assumption**, untested).
- The example shows a 1120 ms model only; a 320 ms variant for live preview was not confirmed.
- Diarization is supported (separate segmentation and embedding models). Sortformer streaming with ASR-aligned speaker tags, as used today, was not found.

### 2.4 Whisper family

- `openai/whisper-large-v3` is Apache-2.0 (Hugging Face API). That whisper.cpp streaming is chunked re-decoding rather than cache-aware streaming is an **Assumption** from general knowledge, not re-verified this session.
- I collected no Spanish or English WER comparison against Nemotron, so no quality claim is made. Not recommended as primary: no accuracy advantage shown, it would drop word-aligned speaker tags and the tuned endpointing design, and Nemotron already covers both languages.

### 2.5 LLM runtimes

node-llama-cpp
- v3.22.2 (2026-10-17), MIT, Node >= 20. Prebuilt optional packages: `win-x64`, `win-x64-cuda`, `win-x64-cuda-ext`, `win-x64-vulkan`, `mac-arm64-metal`, linux variants. https://registry.npmjs.org/node-llama-cpp/latest
- Docs: calling `getLlama()` with no options picks the best GPU automatically; layers offload until VRAM is full; `gpuLayers` overrides; too many layers throws `InsufficientMemoryError`. Prebuilt CUDA binaries were compiled against CUDA 12.4 and 13.1; if they do not work with the installed CUDA, it downloads llama.cpp and builds from source, which "can take up to an hour". https://node-llama-cpp.withcat.ai/guide/CUDA
- Electron guide: "You can only use node-llama-cpp on the main process" (the warning is about renderers); it says nothing about utilityProcess. Native binaries must stay out of the asar. https://node-llama-cpp.withcat.ai/guide/electron
- The 3.22.2 release notes say it ships a specific llama.cpp build and that newer ones need a manual `source download`. https://github.com/withcatai/node-llama-cpp/releases/latest
- Open Gemma 4 issues: #627 (31B repeats tokens at random, maintainer suspects the weights; reported on CUDA/RTX 3090), #624 (Gemma chat wrapper drops `systemPrompt`). https://github.com/withcatai/node-llama-cpp/issues/627 , /issues/624 . Neither is confirmed for the E2B/E4B/12B sizes in the catalog.

llama.cpp `llama-server`
- Latest tag b12063. Windows zips per release: `cuda-12.4-x64` (287 MB, plus a 391 MB `cudart` bundle), `cuda-13.4-x64` (169 MB, plus a 424 MB cudart bundle), `vulkan-x64` (38 MB), `cpu-x64` (25 MB). https://github.com/ggml-org/llama.cpp/releases/latest
- Server: `-ngl` default `auto`, `--fit` on by default (adjusts unset args to fit device memory, default margin 1024 MiB), Jinja chat templates by default, `--api-key`, `GET /health` (503 while loading, 200 when ready), parallel slots, prompt caching, SSE streaming, `json_schema` constrained output, `POST /tokenize`, default host 127.0.0.1. https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- It tracks upstream directly, so a new GGUF architecture needs no wrapper release. GGUF is llama.cpp's native format, so the four catalog files should load as they are (loading each one on the pinned build is part of the spike).

Rust bindings (llama-cpp-2 and similar): not evaluated from sources. They add a Rust toolchain and a second native-module story to the Electron build with no capability the sidecar lacks. Rust was given as an example in the brief, not a requirement.

### 2.6 Electron process model

- `utilityProcess.fork()` runs Node with message ports; the child talks to main through `process.parentPort`; `stdout`/`stderr` can be piped; `exit` and an experimental `error` event report death; MessagePorts can be transferred, so a renderer can be wired straight to the worker. https://www.electronjs.org/docs/latest/api/utility-process
- The page documents nothing about loading native addons or DLLs in a utility process (**Assumption**: it behaves like Node; spike required).
- Electron 45.2.1 is current; koffi 3.3.6 (MIT) has Windows x64/arm64 prebuilds, structs, callbacks, and sync and async calls. The koffi page does not mention Electron. https://registry.npmjs.org/koffi/latest , https://koffi.dev/

## 3. Comparison

ASR options

| Option | Spanish + English | Streaming | Word times / speakers | RTX 3070 | Effort | Risk |
|---|---|---|---|---|---|---|
| A. NeMo-Speech C ABI via koffi in utilityProcess | Same model as today | Yes, cache-aware | Yes, already used | CUDA zip, same as today | Low: port 17 bindings and 7 structs | koffi in utilityProcess unproven; DLL cannot be unloaded |
| B. `nemo-speech serve` sidecar + WebSocket | Same model | Yes (PCM16 WS) | Timestamps in HTTP; speaker tags over WS not confirmed | Same zip | Low-medium | Event schema may omit what the app needs; local HTTP surface to secure |
| C. sherpa-onnx-node | Nemotron int8 ONNX | Yes | Word times unverified; no Sortformer-aligned tags found | CPU in npm package; GPU unproven | Medium | Loses diarization path, GPU uncertain |
| D. whisper.cpp | Multilingual (no figures collected) | Chunked | No speaker tags | CUDA/Vulkan builds exist (not checked) | Medium | Different pipeline, no evidence of gain |

LLM options

| Option | GGUF catalog | GPU on 3070 | Streaming | Isolation | Packaging |
|---|---|---|---|---|---|
| A. `llama-server` sidecar (pinned zip) | Yes | CUDA, Vulkan, CPU zips; `-ngl auto` | SSE | Separate process, kill to unload | Same pinned-zip pattern as the NeMo runtime |
| B. node-llama-cpp | Yes, but its bundled llama.cpp lags | CUDA/Vulkan prebuilt, auto | Native API | Needs utilityProcess (unverified) | Native addon, asar exclusion, source-build fallback |
| C. Rust bindings | Yes | Per build | Custom | Custom | New toolchain |

## 4. Recommendation

**ASR: keep NeMo-Speech.cpp and Nemotron. Load the C ABI with koffi inside a dedicated `utilityProcess`, and bump the runtime pin from v0.1.0 to v0.3.0.**
- Same model, same quality, same behavior the product already tuned (800 ms endpointing, 320 ms live and 1.12 s offline profiles, Sortformer tags). Porting is a 1:1 binding job.
- v0.3.0 fixes the speaker-collapse bug on long recordings, which is the common meeting case.
- Fallback if koffi in utilityProcess fails the spike: run `nemo-speech serve` as a child process (option B) behind the same ASR interface.
- Keep the runtime download manager design (pinned URL + SHA-256, backend folder, incomplete marker). Add `vulkan` as a third backend for non-NVIDIA GPUs; macOS maps to the `metal` and `cpu` archives.

**LLM: run `llama-server` from llama.cpp as a managed sidecar process and talk to it over loopback HTTP with SSE.**
- It is the only option that tracks Gemma 4 support without waiting for a wrapper release, and it keeps GPU/VRAM state in a process we can kill and restart.
- It reuses the app's existing pattern: pinned release zip, SHA-256, per-backend folder (`cuda`, `vulkan`, `cpu`), plus the `cudart` bundle for CUDA. Pick CUDA when NVIDIA is detected, Vulkan otherwise, CPU last.
- Start with `-ngl auto` and `--fit` (both defaults), `-c 4096` to match the current map-reduce, `--host 127.0.0.1`, a free port chosen at launch, and `--api-key` set to a per-launch random token. Use `/tokenize` for the map-reduce token counter.
- Sizing on 8 GB VRAM: Gemma 4 E2B and E4B (3.11 and 4.98 GB files) should fit with context; the 12B (7.12 GB file) will need partial offload (**Assumption**; `--fit` decides). Keep the "GPU only" label for 12B.
- Fallback: node-llama-cpp in a utilityProcess, if the sidecar's per-launch model load time proves unacceptable.

**Process layout.** Two long-lived workers, neither in the main process nor a renderer:
1. `asr-worker` (utilityProcess): owns the DLL, recognizer and streams; the renderer sends PCM over a transferred MessagePort; the worker emits partial and final events. Never unload the library; on exit, let the process die.
2. `llm-sidecar` (child process, `llama-server`): spawned lazily on first summary, restarted on crash, killed on idle timeout or app quit.

Run ASR and LLM at different times where possible: ASR live during recording, LLM after Stop. Nemotron q8 plus Sortformer is about 0.9 GB of weights, but a CUDA context plus a 5 GB LLM on one 8 GB card is the tight case.

## 5. Tradeoffs

- koffi path: lowest effort and reuses proven C behavior, but an FFI struct mistake crashes the worker, not the app; the utilityProcess boundary contains that.
- Sidecar for LLM: more disk (CUDA 12.4 zip 287 MB + cudart 391 MB, or the 13.4 pair 169 + 424 MB) than node-llama-cpp prebuilt packages (size not measured), and a port-and-token handshake to build. In return: crash isolation, upstream model support, easy backend swap.
- Staying on Nemotron means one engine for both languages, but no Whisper-class breadth beyond the model card's 40 locales (19 transcription-ready).
- Upgrading to v0.3.0 changes the runtime under tuned behavior; re-run the existing probe (800 ms endpointing, finals per 52 s clip) before shipping.

## 6. Risks

1. koffi plus CUDA ONNX threads in a utilityProcess is untested; the thread-on-unload crash is already known in the .NET app.
2. The v0.3.0 CUDA zip is 509 MB (the v0.1.0 size was not recorded here); download UX needs progress and resume, which already exist.
3. `llama-server` flags and API shift between releases (b12061 and b12063 were published a day apart); pin one build and test the catalog against it.
4. Gemma 4 repetition reports exist upstream (#627, 31B only so far); add a repetition guard and test E2B/E4B/12B with real transcripts.
5. VRAM contention between ASR and LLM on 8 GB; mitigate by sequencing and by the `--fit` margin.
6. Vulkan builds of either engine on AMD/Intel are unmeasured for speed and correctness.
7. macOS: NeMo-Speech has Metal and CPU archives; I only listed Windows assets for llama.cpp, so mac `llama-server` availability is unchecked.
8. Licenses of llama.cpp and the bundled CUDA runtime were not read this session, and OpenMDW-1.1 was only seen as a summary; do a legal check before bundling download links in the installer.

## 7. Spikes before committing (each under one day)

1. koffi in `utilityProcess` loads `nemo_speech_asr_c.dll` v0.3.0 (CUDA and CPU), runs offline and streaming on a test WAV (not user data), returns word times, and exits without the `0xC0000409` abort.
2. Run several streams concurrently, each with one driving loop, to confirm the one-thread-per-stream rule holds with Node timers.
3. `llama-server` b12063 CUDA 12.4: load each of the four catalog GGUFs, record tokens/s with `-ngl auto` on the 3070, confirm Gemma 4 template output and `/tokenize` counts fit the map-reduce budget.
4. Measure peak VRAM with live ASR plus E4B loaded.
5. If spike 1 fails, repeat with `nemo-speech serve` and the realtime WebSocket, and check that final events carry word times and speaker tags.

## Sources

- https://github.com/NVIDIA/NeMo-Speech.cpp (README, releases/tag/v0.3.0, docs/sdk.md, docs/api.md, docs/server.md, docs/install.md, docs/asr/models.md, docs/asr/configuration.md)
- https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- https://github.com/k2-fsa/sherpa-onnx , nodejs-addon-examples/test_asr_streaming_nemotron.js , https://registry.npmjs.org/sherpa-onnx-node/latest
- https://github.com/withcatai/node-llama-cpp , https://node-llama-cpp.withcat.ai/guide/electron , /guide/CUDA , issues #627 and #624 , https://registry.npmjs.org/node-llama-cpp/latest
- https://github.com/ggml-org/llama.cpp/releases/latest , https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://www.electronjs.org/docs/latest/api/utility-process , https://koffi.dev/ , https://registry.npmjs.org/koffi/latest , https://registry.npmjs.org/electron/latest
- Repo files listed in section 1.
