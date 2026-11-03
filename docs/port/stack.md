# Electron port: stack and conventions

Binding brief for everyone working in `apps/desktop`, `packages/*`, and `native/*`. Evidence lives in `docs/port/research/*`. Every native choice below was run in a spike on this machine on 2026-11-02; caveats are listed at the end.

## Stack

| Area | Choice | Why |
| --- | --- | --- |
| Shell | Electron 45.2.1, pinned exactly | Current stable; all spikes ran on it |
| Build | electron-vite 6, electron-builder 26 (NSIS, per-user), electron-updater | Forge's Vite plugin is still experimental; MSIX target is alpha |
| Language | TypeScript strict, `noUncheckedIndexedAccess` | |
| UI | React 19, Tailwind v4, Base UI primitives, own components | Editor and component ecosystem |
| Notes editor | TipTap 3 with `@tiptap/markdown`; Markdown is the only stored form | Needs a round-trip test suite |
| View state | Zustand; main process owns truth | |
| Lists, routing | TanStack Virtual; TanStack Router with hash history (pill and popup windows have no router) | |
| IPC | Own typed contract: zod schemas in `packages/contracts`, `invoke` for requests, named event channels for streams | `electron-trpc` 1.0.0 is days old; our surface is small enough that a thin layer is safer |
| Audio | Rust napi-rs addon on `wasapi` 0.26 in a `utilityProcess`: 48 kHz f32 stereo in, 16 kHz mono PCM16 out, 20 ms frames, silence synthesized from the clock | cpal and Chromium cannot do per-process loopback; the spike proved exclusion |
| ASR | NeMo-Speech.cpp v0.3.0 C ABI through koffi 3 in its own `utilityProcess`, Nemotron GGUF, CUDA or CPU | Same engine and models as today, with v0.3.0 streaming and diarization fixes. Spike: exact Spanish text, RTF 0.06 on GPU |
| Local LLM | `llama-server` (llama.cpp, pinned b-tag, SHA-256 per zip) as a child process on loopback with an ephemeral API key, SSE streaming, backends cuda12, cuda13, vulkan, cpu | Spike: 230 t/s on GPU. Today's app is CPU-only, so GPU offload is a real upgrade. A Job Object or equivalent must kill it if the parent dies |
| Calendar, DPAPI, sessions | Same Rust addon, `windows` crate, behind ports | Store read worked unpackaged. `safeStorage` cannot read .NET DPAPI blobs; `CryptUnprotectData` can |
| Credentials | `safeStorage` for new secrets. Old DPAPI files are read only through an explicit import | |
| Search | No database. Markdown files stay the source of truth; filter in memory as today | Add SQLite only if a measured need appears |
| CLI tools | `spawn` with `shell:false`, argv array, prompt on stdin, explicit `.cmd` shim handling (CVE-2024-27980) | |
| Tests | Vitest 5; Playwright `_electron` for e2e with a fake-native build flag; contract tests run against both fake and real adapters | |

Rust exists only where the OS forces it. Nothing else is written in Rust for speed alone: inference is already native.

## Layout

```
apps/desktop/          Electron app
  src/main/            composition root, windows, tray, IPC handlers
  src/preload/         contextBridge exposing the typed API only
  src/renderer/        React: app/, features/<module>/, ui/ (design system), i18n/
  src/workers/         utilityProcess entries: audio, asr
packages/contracts/    zod schemas and channel definitions, no runtime dependencies beyond zod
packages/core/         pure domain by feature, ports as interfaces; no electron, no fs
packages/platform/     node adapters for the ports (fs, CLI, HTTP, llama, nemo) plus fakes
native/vozella-native/ Rust addon: audio, calendar, dpapi, sessions, windows; per-OS modules
```

Dependency direction: `apps/desktop` to `platform` to `core`; `contracts` is shared. `core` never imports Electron or Node I/O. Every OS-specific capability is a port with a Windows adapter and a fake; macOS later adds adapters only.

Screaming architecture: folders name features (`recording`, `library`, `chat`), never `utils`, `helpers`, or `services`. Container and presentational split in the renderer: `features/*` containers talk to IPC; `ui/` is pure.

## Data safety

- App data: `%LOCALAPPDATA%\Vozella`. Meetings default: `Documents\Vozella`. Neither is the existing `MeetingLive` location.
- The user's real folder (`Documents\MeetingLive`) is used only if they pick it in Settings. Agents never pick it, read it, or test against it.
- All runs set `VOZELLA_DATA_ROOT` to a temp folder. A guard refuses to start in dev or test if the resolved path is under the real `MeetingLive` folders.
- The file formats stay byte-compatible with `docs/port/specs/library-storage.md` so the folder can be opened later. Writes are atomic: temp file then rename.
- No use of the user's Claude, Codex, xAI, or TypeSafe accounts. Provider tests use doubles. Whatever stayed unverified goes in the parity ledger as `pending-real-validation`.

## Design direction

Reference points: Granola and Notion. The app should feel like a quiet document tool that happens to record. Load the `frontend-design` skill, and take tokens from `website/index.html` and `docs/brand`.

- **Color:** only the tokens: `paper`, `paper-raised`, `ink`, `on-ink`, `ink-muted`, `ink-faint`, `border-control`, `hairline`, plus light and dark values. `signal` red means live recording and nothing else; errors use ink with an icon and clear words. Folder accents stay as user-chosen content, muted.
- **Type:** Schibsted Grotesk for UI and notes, IBM Plex Mono for timestamps, durations, and data. Bundled locally through `@fontsource`, never a CDN. Scale is small and tight: 13/14 UI, 15/16 reading, a large title only on the document.
- **Shape:** hairlines over shadows. Radius 4 to 6. Shadows only on real overlays. No gradients, glass, glows, emoji, or purple. No cards inside cards.
- **Layout:** narrow sidebar with the library tree; the meeting is a centered document column around 720 px with generous margins; chat and transcript are panes that resize. Custom title bar with `titleBarOverlay`, solid background.
- **Motion:** 120 to 160 ms ease-out, opacity and small translate only; honor `prefers-reduced-motion`.
- **Empty and loading:** quiet one-line copy, skeletons of real layout, no illustrations.
- **Copy:** sentence case, plain words, no exclamation marks, nothing about AI magic. The product speaks as a tool.
- **Accessibility:** WCAG 2.2 AA contrast, full keyboard use, visible focus, accessible names, forced-colors support.

The recording bars mark from `docs/brand` is the only ornament. If a screen looks like a generic SaaS template, it is wrong.

## Porting rules

1. The module spec in `docs/port/specs/<module>.md` is the requirement; the C# is the tiebreaker. Copy behavior, constants, prompts, and formats exactly. Layout and visuals are new; flows and capabilities are not removed.
2. Fix confirmed bugs from the spec's section 7 as you port, each with a regression test. Do not copy a bug for fidelity, except on-disk format compatibility. Do not port dead code; note it.
3. Every parity item goes in `docs/port/parity/<module>.md` with status `done`, `improved`, `dropped` (reason), or `pending-real-validation` (what is needed). Nothing is left silent.
4. Test first where a deterministic test exists: observe RED, then GREEN. Port the xUnit cases listed in section 6 of the spec.
5. All user text goes through i18n keys (`en`, `es`), reusing the existing keys and translations.
6. Conventional commits by work unit, tests with behavior. No attribution lines in commit messages. No push.
7. `pnpm check` (typecheck, lint, unit tests) must pass before each commit.

## Known unverified after the spikes

Windows 10; real Teams, Zoom, and browser calls and their root PID; device hot-swap and long-session drift in capture; Sortformer diarization on v0.3.0; Gemma 4 GGUF templates and 12B on 8 GB; orphan `llama-server` after a parent crash; multi-monitor docking and mixed DPI; toast activation; signed and packaged builds of native addons; calendars that appear only for packaged callers (the spike's unpackaged read found 1 calendar and 0 upcoming events).

## Spike code

Working proofs to reuse, under `spikes/` in the session scratchpad until the port absorbs them: `audio`, `asr`, `llm`, `calendar`, `window`. pnpm 12 skips install scripts, so builds must be allow-listed and Electron's binary fetched explicitly.
