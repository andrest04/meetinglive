# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, OpenCode, or any agent following the [agents.md](https://agents.md) convention) working in this repository.

## Hard gate: every change MUST go through skills

This is not optional. **Do not write, edit, test, review, package, or ship MeetingLive code without first loading the matching `SKILL.md` files.** Ad-hoc implementation is a quality failure.

A new feature, a bug fix, a unit test, a UI test, a refactor, a review, or a packaging step that skipped its skills did not happen correctly. Redo it through the skills.

Before any implementation, test, or feature work:

1. Read the skill index at `.atl/skill-registry.md` (Engram topic `skill-registry` if the file is missing).
2. Load every matching skill in the routing table below — read the exact `SKILL.md` path. Do not summarize the skill.
3. Follow that skill's procedure. If the skill cannot be loaded, **STOP** and tell the user.
4. When delegating, inject those exact `SKILL.md` paths into the sub-agent prompt under `## Skills to load before work`. The sub-agent must read them **before** task-specific work.

Project skills live in `.agents/skills/` (see `skills-lock.json`). Claude Code also has `winui@win-dev-skills` plus `dotnet` / `dotnet-msbuild` / `dotnet-nuget` / `dotnet-test` / `dotnet-diag` `@dotnet-agent-skills` enabled in `.claude/settings.json`.

### Mandatory skill routing

| Work | Skills that MUST be loaded | Why |
| --- | --- | --- |
| New feature, XAML, layout, Fluent, accessibility, `x:Bind` | `winui-design` then `winui-dev-workflow` | Grounded WinUI samples before writing UI; build/run through `winapp` |
| Build, run, debug, crash diagnosis | `winui-dev-workflow` | `winapp run`; never the packaged `.exe`; never bare `dotnet run` |
| Write or change xUnit tests (`MeetingLive.Core.Tests`) | `csharp-xunit` | xUnit facts/theories, AAA, naming |
| Run tests | `run-tests` | Exact `dotnet test` command for this repo (per-csproj, not the solution) |
| Audit existing tests | `test-anti-patterns`, `assertion-quality`, `test-gap-analysis` | Catch empty/tautological tests and untested behavior |
| Coverage / "are we testing the right things?" | `coverage-analysis` | Cobertura line/branch evidence |
| Automated UI tests | `winui-ui-testing` | Native UIA via `winapp ui`. Playwright does **not** apply |
| Native interop (NeMo-Speech C ABI, P/Invoke, marshalling) | `dotnet-pinvoke` | Signatures, lifetime, crash-at-the-boundary |
| Performance of hot paths (audio pump, LLM, allocations) | `analyzing-dotnet-performance` | Known .NET anti-patterns |
| App crash dumps | `dump-collect` | Collect dumps; do not pretend to analyze them with this skill |
| Unclear MSBuild / `MSB4126` / project-file review | `binlog-failure-analysis`, `msbuild-antipatterns` | Diagnose the build, don't guess |
| Before any commit | `winui-code-review` | MVVM, `x:Bind`, a11y, theming, security, performance |
| MSIX, signing, Store, release CI | `winui-packaging` | Packaging is its own pipeline |
| Machine toolchain missing (WinApp CLI, Developer Mode) | `winui-setup` | **Only** when the user explicitly asks to set up or repair the toolchain |

Exact paths are in `.atl/skill-registry.md`. Example: `C:\Users\andres\Code\meetinglive\.agents\skills\winui-design\SKILL.md`.

### Project override the skills must not fight

MeetingLive is **C#12** on .NET 10 (`LangVersion` 12.0 in `Directory.Build.props`). Keep classic `[ObservableProperty]` **private-field** syntax. Do **not** migrate to C#13/C#14 partial properties even if `winui-code-review` / analyzer `WUI3xxx` suggests the newer pattern. The SDK 10 default is C#14 — do not remove the pin.

### Do not

- Skip skills because the change "looks small".
- Invent WinUI/XAML patterns without `winui-design`.
- Write xUnit tests without `csharp-xunit`.
- Touch native C ABI without `dotnet-pinvoke`.
- Use Playwright for native WinUI3 controls.
- Run `dotnet build` / `dotnet test` against `MeetingLive.sln` (AnyCPU vs `x86;x64;ARM64` → `MSB4126`).

Prerequisite: WinApp CLI v0.6+ (`winget install Microsoft.winappcli`) and Windows Developer Mode. `winui-setup` verifies both when the user asks.

To run the app: `winui-dev-workflow` (`winapp run <csproj> -c Debug --arch x64 --debug-output`).

## Commands

All commands assume the .NET 10 SDK is on PATH (`dotnet --version` should print `10.0.x`; `global.json` pins `10.0.400` with `rollForward: latestFeature`).

- Build the WinUI3 app (must specify `Platform`, since the app targets x86/x64/ARM64, not AnyCPU):
  `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`
- Build just the Core class library:
  `dotnet build MeetingLive.Core/MeetingLive.Core.csproj`
- Run all unit tests:
  `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- Run a single test:
  `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj --filter "FullyQualifiedName~ModelCatalogTests.SummaryModels_ContainsAllFourCuratedEntries"`
- **Do not** run `dotnet build`/`dotnet test` against `MeetingLive.sln` directly — the solution's default `Any CPU` platform mapping conflicts with the App project's `x86;x64;ARM64`-only platforms and fails with `MSB4126`. Build/test each `.csproj` individually (as above), or use the `winui-dev-workflow` skill.

## Architecture

Three projects, no remote backend — the entire pipeline (record → transcribe → summarize) runs locally on the user's machine, for zero cost:

- **`MeetingLive.App`** — WinUI3 (.NET 10, `net10.0-windows10.0.26100.0`) desktop app, MVVM via `CommunityToolkit.Mvvm` (classic `[ObservableProperty]` private-field syntax — the project is C#12, NOT the C#13/C#14 "partial property" syntax some WinUI templates default to; `Directory.Build.props` pins `LangVersion` 12.0 because SDK 10 defaults to C#14). `App.xaml.cs` exposes `App.Window`, `App.DispatcherQueue`, and `App.WindowHandle` as statics for use from anywhere (dialogs, WinRT interop, marshaling background-thread results back to the UI thread). User-facing text lives in `Strings/en-us/Resources.resw`: XAML uses `x:Uid`, C# uses `AppStrings.Get` / `AppStrings.Format` with `CultureInfo.CurrentCulture`. Default copy is English. Do not hardcode new UI strings.
  - `MainPage.xaml` — `NavigationView` shell (`PaneDisplayMode="Auto"` — do not hardcode `"Left"`, it disables WinUI3's native adaptive collapse-to-compact-pane behavior on narrow windows) hosting Record / Transcript / Summary, plus a native `IsSettingsVisible` Settings item at the pane footer with its `Content` set from `AppStrings` (`Nav_Settings`) so it does not follow the OS UI language.
  - `RecordingPage` — toggles `AudioCaptureService`, then runs transcription and summarization via `Task.Run` + `App.DispatcherQueue.TryEnqueue` to stay off/return to the UI thread.
  - `TranscriptPage` / `SummaryPage` — load a `MeetingRecord` by id or fall back to the most recent one.
  - `SettingsPage` — the single place for all app configuration: current/selected local LLM model with download & delete per model (`SettingsCard`/`SettingsExpander` from `CommunityToolkit.WinUI.Controls.SettingsControls`), data location (`AppPaths.RootDirectory`) with an "Open folder" action, and a summary-provider selector ("Local" active today, "Cloud (API key) — coming soon" as a disabled placeholder for the future — see `ISummaryProvider` below).
  - `Dialogs/SummaryModelSetupDialog` — `ContentDialog` wizard for first-time/model-change flows; reused by both `RecordingPage` (via `SummaryModelResolver`) and `SettingsPage` so the model-picking logic lives in one place.
- **`MeetingLive.Core`** — UI-independent logic, `net10.0-windows10.0.19041.0` (needs the Windows-specific TFM for WASAPI/WMI access, but a lower min version than the app for broader compatibility). Contains:
  - `Services/AudioCaptureService` — mixes microphone + WASAPI loopback (system audio) into a single 16kHz mono PCM WAV via NAudio, so no voice in a meeting is lost. Capture is push-based (NAudio `DataAvailable` events into `BufferedWaveProvider`s); a background pump loop pulls from a `MixingSampleProvider` and writes to `WaveFileWriter`. The pump loop paces itself against a `Stopwatch`-based real-time clock rather than relying on the mixer returning 0 bytes to throttle — `MixingSampleProvider.Read()` always fills the requested count (silence when a source buffer is empty), so without explicit pacing the loop free-runs as fast as the CPU allows and balloons the WAV file with silence far beyond the meeting's actual duration.
  - `Services/TranscriptionService` — wraps Whisper.net; downloads the GGML model on demand and caches it under `AppPaths.WhisperModelsDirectory`.
  - `Services/ISummaryProvider` / `LocalLlmSummaryProvider` — summary generation is behind an interface specifically so a future cloud provider (user's own API key) can be added without touching the rest of the pipeline. The only implementation today is **local and in-process**: `LocalLlmSummaryProvider` runs a GGUF model via `LLamaSharp` (`LLamaWeights.LoadFromFileAsync` + `StatelessExecutor`) — no external process, no separately-installed runtime (this replaced an earlier Ollama-based design: Ollama required the user to install and run a separate program, which didn't match the "just pick a model in Settings" UX the user wanted).
  - `Services/ILocalLlmModelManager` / `LocalLlmModelManager` — downloads/deletes GGUF models on demand, same on-demand-download-and-cache pattern as `TranscriptionService`, caches under `AppPaths.ModelsDirectory`.
  - `Services/HardwareDetectionService` — reads total RAM and primary GPU/VRAM via WMI (`Win32_ComputerSystem`, `Win32_VideoController`).
  - `Services/ModelCatalog` — curated (not live-benchmarked) list of local summary models with RAM/speed/quality tradeoffs; `SummaryModelInfo.RateFor(HardwareProfile)` compares an entry's minimum RAM against detected hardware to produce a `FitRating` (Recommended / MayBeSlow / NotRecommended) for the setup wizard and Settings. Current entries (each chosen as the best-benchmarked distilled model at its size tier — reasoning-distilled models like DeepSeek-R1-Distill were deliberately excluded because their chain-of-thought overhead adds latency without improving summary quality): Llama 3.2 1B Instruct (0.81GB, only distilled option this small), Gemma 4 E2B/E4B/12B Instruct (3.11/4.98/7.12GB — Gemma 4 is distilled from Gemini and benchmarks ahead of Qwen2.5 at comparable sizes).
  - `Services/MeetingRepository` — JSON-backed `IMeetingRepository`, one file under `AppPaths.MeetingsFilePath`, `SemaphoreSlim`-guarded for concurrent access.
  - `Services/AppSettingsService` — persists the selected local model id (`AppSettings.SelectedSummaryModelId`) under `AppPaths.SettingsFilePath`.
- **`MeetingLive.Core.Tests`** — xUnit, targets the same `net10.0-windows10.0.19041.0` TFM as `MeetingLive.Core` (required for any test project referencing a WinUI/Windows-App-SDK-adjacent project — TFMs must match). Uses hand-rolled test doubles (e.g. a fake `HttpMessageHandler` subclass) rather than a mocking library where the target can't be intercepted by one.

For UI-thread-bound tests (ViewModels, XAML controls) that this xUnit project cannot cover, use a **WinUI Unit Test App** project (template `winui-unittest`, installed via `Microsoft.WindowsAppSDK.WinUI.CSharp.Templates`) — those run on a real XAML UI thread, which is required for `Microsoft.UI.Xaml.*` types.

## Testing

Playwright does not apply here: it automates browsers/WebView2 content, not native WinUI3 controls (confirmed against the official Windows App SDK docs). Use instead:

- **Unit tests** (`MeetingLive.Core.Tests`, xUnit) — non-UI logic: `ModelCatalog`, `SummaryModelInfo.RateFor`, `LocalLlmSummaryProvider`/`LocalLlmModelManager` (with fakes, no real model download or Ollama dependency required).
- **WinUI Unit Test App** (template `winui-unittest`) — for tests that need the XAML UI thread (ViewModels, controls).
- **Appium + Windows Driver** (`appium driver install windows`) — the official successor to the discontinued WinAppDriver, for E2E UI automation: record → transcribe → summarize by driving the real app.
