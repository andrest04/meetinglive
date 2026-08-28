# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, or any agent following the [agents.md](https://agents.md) convention) working in this repository.

## Mandatory: use the `winui` plugin skills for any WinUI3/Windows App SDK work

This repo has the `winui@win-dev-skills` plugin installed (from `microsoft/win-dev-skills`), plus the general-purpose `dotnet@dotnet-agent-skills`, `dotnet-msbuild@dotnet-agent-skills`, `dotnet-nuget@dotnet-agent-skills`, `dotnet-test@dotnet-agent-skills`, and `dotnet-diag@dotnet-agent-skills` plugins. **Any implementation work in this codebase — new features, XAML/UI, bug fixes, refactors, packaging, migrations, tests — must go through the `winui-dev` agent and its skills, not ad-hoc edits.** Specifically:

- Scaffolding, building, running, or debugging the app → `winui-dev-workflow` (uses `winapp new`, `winapp run`, crash diagnostics).
- Any XAML/UI work (layout, theming, Fluent Design, accessibility, data binding, `x:Bind`) → `winui-design` (uses `winapp find-ui` for sample discovery).
- Before committing any change → `winui-code-review` (MVVM compliance, `x:Bind` syntax, accessibility, theming consistency, security, performance).
- Automated UI tests → `winui-ui-testing` (generates batch test scripts; this is the project's UI-testing tool — do not reach for Playwright, which only automates WebView2 content and does not apply to native WinUI3 controls).
- Release builds, signing, MSIX, CI/CD, Store submission → `winui-packaging`.
- Anything touching general .NET build/test/package plumbing outside WinUI-specific concerns → the `dotnet`/`dotnet-msbuild`/`dotnet-nuget`/`dotnet-test`/`dotnet-diag` skills.

Prerequisite: the `winapp` CLI (v0.6+) must be installed (`winget install Microsoft.winappcli`), and Windows Developer Mode must be enabled — `winui-setup` verifies both.

To run the app: use the `winui-dev-workflow` skill (`winapp run <csproj> -c Debug --arch x64 --debug-output`), never the packaged `.exe` directly and never a bare `dotnet run`.

## Commands

All commands assume the .NET 8 SDK is on PATH (`dotnet --version` should print `8.0.x`).

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

- **`MeetingLive.App`** — WinUI3 (.NET 8, `net8.0-windows10.0.26100.0`) desktop app, MVVM via `CommunityToolkit.Mvvm` (classic `[ObservableProperty]` private-field syntax — the project is C#12, NOT the C#13 "partial property" syntax some WinUI templates default to). `App.xaml.cs` exposes `App.Window`, `App.DispatcherQueue`, and `App.WindowHandle` as statics for use from anywhere (dialogs, WinRT interop, marshaling background-thread results back to the UI thread). All user-facing text is in English (hardcoded literals, no `.resw`/localization system — do not add one unless asked).
  - `MainPage.xaml` — `NavigationView` shell (`PaneDisplayMode="Auto"` — do not hardcode `"Left"`, it disables WinUI3's native adaptive collapse-to-compact-pane behavior on narrow windows) hosting Record / Transcript / Summary, plus a native `IsSettingsVisible` Settings item at the pane footer with its `Content` set explicitly to `"Settings"` in code-behind (the OS-localized default label would otherwise follow system language).
  - `RecordingPage` — toggles `AudioCaptureService`, then runs transcription and summarization via `Task.Run` + `App.DispatcherQueue.TryEnqueue` to stay off/return to the UI thread.
  - `TranscriptPage` / `SummaryPage` — load a `MeetingRecord` by id or fall back to the most recent one.
  - `SettingsPage` — the single place for all app configuration: current/selected local LLM model with download & delete per model (`SettingsCard`/`SettingsExpander` from `CommunityToolkit.WinUI.Controls.SettingsControls`), data location (`AppPaths.RootDirectory`) with an "Open folder" action, and a summary-provider selector ("Local" active today, "Cloud (API key) — coming soon" as a disabled placeholder for the future — see `ISummaryProvider` below).
  - `Dialogs/SummaryModelSetupDialog` — `ContentDialog` wizard for first-time/model-change flows; reused by both `RecordingPage` (via `SummaryModelResolver`) and `SettingsPage` so the model-picking logic lives in one place.
- **`MeetingLive.Core`** — UI-independent logic, `net8.0-windows10.0.19041.0` (needs the Windows-specific TFM for WASAPI/WMI access, but a lower min version than the app for broader compatibility). Contains:
  - `Services/AudioCaptureService` — mixes microphone + WASAPI loopback (system audio) into a single 16kHz mono PCM WAV via NAudio, so no voice in a meeting is lost. Capture is push-based (NAudio `DataAvailable` events into `BufferedWaveProvider`s); a background pump loop pulls from a `MixingSampleProvider` and writes to `WaveFileWriter`. The pump loop paces itself against a `Stopwatch`-based real-time clock rather than relying on the mixer returning 0 bytes to throttle — `MixingSampleProvider.Read()` always fills the requested count (silence when a source buffer is empty), so without explicit pacing the loop free-runs as fast as the CPU allows and balloons the WAV file with silence far beyond the meeting's actual duration.
  - `Services/TranscriptionService` — wraps Whisper.net; downloads the GGML model on demand and caches it under `AppPaths.ModelsDirectory`.
  - `Services/ISummaryProvider` / `LocalLlmSummaryProvider` — summary generation is behind an interface specifically so a future cloud provider (user's own API key) can be added without touching the rest of the pipeline. The only implementation today is **local and in-process**: `LocalLlmSummaryProvider` runs a GGUF model via `LLamaSharp` (`LLamaWeights.LoadFromFileAsync` + `StatelessExecutor`) — no external process, no separately-installed runtime (this replaced an earlier Ollama-based design: Ollama required the user to install and run a separate program, which didn't match the "just pick a model in Settings" UX the user wanted).
  - `Services/ILocalLlmModelManager` / `LocalLlmModelManager` — downloads/deletes GGUF models on demand, same on-demand-download-and-cache pattern as `TranscriptionService`, caches under `AppPaths.ModelsDirectory`.
  - `Services/HardwareDetectionService` — reads total RAM and primary GPU/VRAM via WMI (`Win32_ComputerSystem`, `Win32_VideoController`).
  - `Services/ModelCatalog` — curated (not live-benchmarked) list of local summary models with RAM/speed/quality tradeoffs; `SummaryModelInfo.RateFor(HardwareProfile)` compares an entry's minimum RAM against detected hardware to produce a `FitRating` (Recommended / MayBeSlow / NotRecommended) for the setup wizard and Settings. Current entries (each chosen as the best-benchmarked distilled model at its size tier — reasoning-distilled models like DeepSeek-R1-Distill were deliberately excluded because their chain-of-thought overhead adds latency without improving summary quality): Llama 3.2 1B Instruct (0.81GB, only distilled option this small), Gemma 4 E2B/E4B/12B Instruct (3.11/4.98/7.12GB — Gemma 4 is distilled from Gemini and benchmarks ahead of Qwen2.5 at comparable sizes).
  - `Services/MeetingRepository` — JSON-backed `IMeetingRepository`, one file under `AppPaths.MeetingsFilePath`, `SemaphoreSlim`-guarded for concurrent access.
  - `Services/AppSettingsService` — persists the selected local model id (`AppSettings.SelectedSummaryModelId`) under `AppPaths.SettingsFilePath`.
- **`MeetingLive.Core.Tests`** — xUnit, targets the same `net8.0-windows10.0.19041.0` TFM as `MeetingLive.Core` (required for any test project referencing a WinUI/Windows-App-SDK-adjacent project — TFMs must match). Uses hand-rolled test doubles (e.g. a fake `HttpMessageHandler` subclass) rather than a mocking library where the target can't be intercepted by one.

For UI-thread-bound tests (ViewModels, XAML controls) that this xUnit project cannot cover, use a **WinUI Unit Test App** project (template `winui-unittest`, installed via `Microsoft.WindowsAppSDK.WinUI.CSharp.Templates`) — those run on a real XAML UI thread, which is required for `Microsoft.UI.Xaml.*` types.

## Testing

Playwright does not apply here: it automates browsers/WebView2 content, not native WinUI3 controls (confirmed against the official Windows App SDK docs). Use instead:

- **Unit tests** (`MeetingLive.Core.Tests`, xUnit) — non-UI logic: `ModelCatalog`, `SummaryModelInfo.RateFor`, `LocalLlmSummaryProvider`/`LocalLlmModelManager` (with fakes, no real model download or Ollama dependency required).
- **WinUI Unit Test App** (template `winui-unittest`) — for tests that need the XAML UI thread (ViewModels, controls).
- **Appium + Windows Driver** (`appium driver install windows`) — the official successor to the discontinued WinAppDriver, for E2E UI automation: record → transcribe → summarize by driving the real app.
