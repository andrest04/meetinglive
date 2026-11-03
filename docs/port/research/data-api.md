# Application architecture, data and API layer for the Electron port

Scope: IPC, process split, repository layout, meeting search, credentials, calendar, meeting and audio-session detection, CLI spawning, streaming HTTP, Electron security. Windows first, macOS later.

Conventions. **[V]** verified in a primary source or by running something this session (URL or command given). **[A]** assumption or design proposal, not verified. Versions were read from the npm registry and crates.io on 2026-11-02/03. No user data was read; only repository source files and public documentation.

## 1. Recommendation (short)

| Concern | Choice |
|---|---|
| Typed IPC | **tRPC v11 + zod 4 over Electron IPC**, using `electron-trpc` 1.0.0 as transport. Router and zod schemas live in a `contracts` package; the transport is replaceable by a custom link. Preload exposes one narrow bridge, never `ipcRenderer`. |
| Process split | Main = composition root, windows, tray, IPC router, credentials, settings. `utilityProcess` for: native Windows module (audio, calendar, window/session scan), search index, inference/transcription workers. CLI tools are spawned from a worker, not from a renderer. |
| Layout | pnpm workspace, feature-first ("screaming") core packages with ports; platform adapters in separate packages (`adapters-win32`, later `adapters-darwin`); dependency direction enforced by lint. |
| Search | Markdown files stay the source of truth. **better-sqlite3 13.x** with FTS5 as a derived, rebuildable index, behind a `SearchIndexPort`. `node:sqlite` is the documented swap-in once verified inside Electron. |
| Credentials | **`safeStorage` async API** for new secrets. One-time migration of legacy .NET DPAPI files by reading them with a CurrentUser DPAPI call (`@primno/dpapi` or our own Rust call), then re-encrypting. Do not assume `safeStorage` reads raw DPAPI blobs. |
| Calendar | **Rust addon (`windows` crate + napi-rs 3)** calling the same WinRT `AppointmentStore` API, behind `CalendarPort`. It needs package identity plus the `appointmentsSystem` capability, so packaging is the gating risk (spike S1). `@microsoft/dynwinrt` is the closest alternative. |
| Meeting/audio detection | Port `MeetingCallDetector` to a pure TS function with the same tests. Window enumeration and capture-session enumeration (`IAudioSessionManager2`) in the same Rust Windows module. |
| CLI spawning | `child_process.spawn`, `shell: false`, argv as an array, prompt on stdin, explicit timeout and process-tree kill. Resolve `.cmd` shims deliberately because of CVE-2024-27980. |
| Streaming HTTP | `fetch` in a worker with `ReadableStream` plus an SSE line parser; `net.fetch` where system proxy/cert behavior matters. Push chunks to the UI over tRPC subscriptions or a MessagePort. |

## 2. Findings

### 2.1 Secure IPC and typed contracts

- **[V]** Context isolation has been the default since Electron 12, sandbox since Electron 20, `nodeIntegration` off since 5. The checklist says to validate the sender of every IPC message by origin (not URL; `senderFrame` may be null), and not to expose raw `ipcRenderer.on` through preload. https://www.electronjs.org/docs/latest/tutorial/security
- **[V]** The IPC guide: use `ipcRenderer.invoke` with `ipcMain.handle`; do not expose the whole `ipcRenderer`; wrapping `ipcRenderer.on` callbacks avoids leaking `event.sender`; errors thrown in `handle` reach the renderer with only `message`; payloads use structured clone (no class instances, no `WebContents`). https://www.electronjs.org/docs/latest/tutorial/ipc
- **[V]** Current stable is Electron 45.2.1 (Chromium 156.0.8078.75, Node 24.22.1, 2026-10-30); 44.10.1 and 43.8.6 are the previous two. https://releases.electronjs.org/ and `npm view electron version` = 45.2.1.
- **[V]** `electron-trpc` 1.0.0 (jsonnull; npm modified 2026-10-30). Peer deps: `electron >=35`, `@trpc/client ^11.10`, `@trpc/server ^11.10`. README: queries, mutations and subscriptions; `createIPCHandler` registers a preload script; an `allow` option checks the sender and rejects with `FORBIDDEN`; `exposeElectronTRPC()` can be called from your own preload. https://github.com/jsonnull/electron-trpc. Older forks are stale: `trpc-electron` 0.1.2 (2025-01-06), `electron-trpc-experimental` 1.0.0-alpha.1 (2025-06-18) per npm.
- **[V]** tRPC 11.23.0 is current. Subscriptions are async generators and can use `tracked()` for resumable event IDs; SSE is the HTTP transport, but any custom link can carry them. https://trpc.io (Context7 `/trpc/trpc` v11.19 docs).
- **[A]** `electron-trpc` 1.0.0 is days old and single-maintainer. I did not verify how it serializes async-generator subscriptions or whether it works with `utilityProcess` ports. The router and zod schemas are the durable asset; a custom link over `ipcRenderer.invoke` plus a `MessagePort` per subscription is roughly a few hundred lines if the package disappoints.

Comparison:

| Option | Pros | Cons |
|---|---|---|
| tRPC + zod + electron-trpc | End-to-end types, input validation at the boundary, subscriptions for progress, transcript and level streams | Young transport package; extra dependency surface in the preload |
| Hand-rolled `invoke` + zod map | No dependency, full control of the preload surface | Subscriptions, cancellation and error mapping must be written and tested by us |
| Plain `ipcMain.handle` with TS types only | Smallest | No runtime validation; types lie at the boundary |

High-rate streams (microphone level, partial transcripts) should not go through request/response IPC. **[V]** `utilityProcess` supports `postMessage` with transferred `MessagePortMain`; the child receives them on `process.parentPort`. **[A]** Main creates a `MessageChannelMain`, hands one end to the worker and the other to the renderer window.

### 2.2 Main versus utilityProcess

- **[V]** `utilityProcess.fork()` starts a Node-enabled child through Chromium's Services API; options include `env`, `execArgv`, `cwd`, `stdio` (default `inherit`), `serviceName`; stdin is not configurable; `exit` and `spawn` events; a `session` option controls the network context (default: system network context, no HTTP cache). https://www.electronjs.org/docs/latest/api/utility-process
- **[V]** `net` is available in main and utility processes; custom protocols are not supported in utility; `net.fetch` uses Chromium's network stack, unlike Node `fetch`; usable only after `ready`. https://www.electronjs.org/docs/latest/api/net
- **[V]** Sibling report `audio-native.md` already recommends a Rust napi-rs capture module inside a `utilityProcess`.
- **[A]** Rule: anything that can crash natively, block for seconds, or hold large memory goes in a utility process (native Windows module, search index, inference, CLI runner). Main keeps only orchestration and secrets. The renderer holds no secrets and no Node.

### 2.3 Hexagonal / Screaming layout in a pnpm monorepo

**[A]** Proposed shape (names are placeholders):

```
packages/
  core/                  pure TS, no Electron, no Node fs
    src/library/         meetings, folders, markdown layout    {domain, app, ports}
    src/capture/         recording session, readiness
    src/transcription/   live + file transcription use cases
    src/summaries/       providers, prompts, polish
    src/calendar/        events, matching, reminders           (ports: CalendarPort)
    src/search/          SearchIndexPort
    src/settings/        AppSettings, credentials port
  contracts/             zod schemas + tRPC router type (imported by main and renderer)
  adapters-fs/           Markdown/JSON repositories, atomic writes
  adapters-sqlite/       SearchIndexPort on better-sqlite3
  adapters-win32/        JS side of the Rust module; DPAPI migration; Windows CalendarPort
  adapters-cli/          CliRunnerPort, Claude Code / Codex providers
  adapters-http/         xAI / TypeSafe clients (streaming)
apps/
  desktop/               main process composition root, preload, renderer
native/
  vozella-win/           Rust crate (napi-rs): audio, calendar, window + audio-session scan
```

- The existing C# seams map one to one: `ICalendarStore`, `ICliProcessRunner`, `IXaiCredentialStore`, `IMeetingRepository`, `IFolderRepository` are already ports (observed in `MeetingLive.Core/Services`). The pure helpers (`MeetingCallDetector`, `CalendarJoinUrl`, `CalendarSeriesId`, `CalendarEventFilter`, `ActionItemParser`) are domain code and port directly with their tests.
- Enforce the dependency rule with a lint rule or a graph checker (for example `eslint-plugin-boundaries` or `dependency-cruiser`); I did not evaluate either. `core` may not import `electron`, `node:*`, or any adapter.
- **[V, weak source]** Reports for electron-builder with pnpm say `node-linker=hoisted` is the reliable setting and native `.node` files need `asarUnpack`; only forum and commit-message sources found (Signal-Desktop commit "Use node_linker=hoisted in npmrc to fix electron-builder with pnpm"). Treat as a known friction point to test early, not as settled.

### 2.4 Meeting search index

Observed: `MeetingLibraryLayout` enumerates `*.md` recursively; Markdown and WAV for a meeting share a stem. Markdown is the source of truth.

| Option | Facts | Assessment |
|---|---|---|
| None (scan on demand) | Works for tens to hundreds of notes | Linear cost per query; no ranking; becomes slow with large transcripts |
| better-sqlite3 13.0.3 | **[V]** 13.0.0 moved to N-API (node-addon-api), removed `prebuild-install`; release notes say prebuilt binaries "should theoretically work across different versions of Node.js and Electron"; 13.0.2 bundles SQLite 3.53.4; 12.11.2 added Electron v43 prebuilds. `engines.node >=22`. https://github.com/WiseLibs/better-sqlite3/releases | Mature, synchronous, fast. FTS5 is a compile-time SQLite option (https://sqlite.org/fts5.html); I did not find FTS5 stated in better-sqlite3 pages I read, so **[A]** verify in spike S3. |
| `node:sqlite` | **[V]** Stability 1.2 "release candidate", added v22.5.0, no flag needed since v23.4.0/v22.13.0; extension loading needs `allowExtension`; no FTS5 mention in docs. https://nodejs.org/api/sqlite.html. **[V, local]** Node 24.18.0 here: FTS5 with `tokenize="trigram"` works, SQLite 3.53.1. | Zero native dependency if Electron exposes it. **[A]** Not verified inside Electron 45; a Vite report says bundlers may externalize it incorrectly. |

Recommendation: better-sqlite3 in a utility process, FTS5 table with `unicode61 remove_diacritics` for words plus an optional trigram table for substring matches (Spanish and English content). The DB lives under the app data directory, holds path, mtime, size, title, body; reindex when mtime or size changes; on corruption or version bump, delete and rebuild from Markdown. The index never holds data that is not in a Markdown file. Revisit `node:sqlite` when it leaves release-candidate status and passes S3.

### 2.5 Credential storage and legacy DPAPI

Observed in `FileDpapiXaiCredentialStore`: JSON of `XaiCredentials` encrypted with `ProtectedData.Protect(..., optionalEntropy: null, DataProtectionScope.CurrentUser)`, written as a raw file; class names indicate `FileDpapiTypeSafeCredentialStore` uses the same pattern (not read).

- **[V]** `safeStorage` on Windows: keys generated via DPAPI (sync API) or protected via DPAPI (async API); protects from other users on the machine, not from other apps in the same userspace. The sync API (`isEncryptionAvailable`, `encryptString`, `decryptString`) is deprecated from 45 and "will be removed in Electron 46"; use `isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync` (returns `{ shouldReEncrypt, result }`). Data from the deprecated `encryptString` can be read by `decryptStringAsync`. The docs do not say the output is a raw DPAPI blob. https://www.electronjs.org/docs/latest/api/safe-storage
- **[V, via search summary of Chromium source]** Chromium's `os_crypt_win.cc`: values are `"v10"` + 12-byte nonce + AES-256-GCM ciphertext; the AES key sits in Local State under `os_crypt.encrypted_key`, DPAPI-protected; decrypt falls back to plain DPAPI when the prefix is absent. I could not open the file directly (googlesource returned 404/502/503). Electron 45's async path uses `os_crypt_async`, whose behavior I did not verify.
- **Consequence**: new secrets written by `safeStorage` are not readable by the old .NET `ProtectedData.Unprotect`, so migration is one-way. Whether `decryptStringAsync` accepts a legacy raw blob is **unverified**; do not design around it.
- **[V]** `@primno/dpapi` 2.0.1 (npm modified 2025-01-12): prebuilt N-API x64 and arm64, `protectData`/`unprotectData` with `CurrentUser` or `LocalMachine` scope, node-gyp-build loader, MIT, README does not mention Electron. https://github.com/primno/dpapi. Maintenance is thin (no release in about 10 months).

Recommendation:
1. New secrets: `safeStorage.encryptStringAsync`, stored as a file or in the settings store; never in the renderer.
2. Migration on first run, in main or a worker: if the legacy file exists and the new store is empty, call CurrentUser `CryptUnprotectData` (`@primno/dpapi`, or add `CryptUnprotectData` to our Rust module to avoid a third-party native dependency), parse the JSON, write via `safeStorage`, read it back, then delete or rename the legacy file. Keep the legacy file if any step fails.
3. Test with a synthetic blob generated by a small .NET test, never with the user's real credential files.
4. Fallback if neither route is acceptable: ask the user to sign in again (xAI uses OAuth per `XaiOAuthClient`).

### 2.6 Calendar on Windows

Observed in `WindowsAppointmentCalendarStore.cs`: `AppointmentManager.RequestStoreAsync(AllCalendarsReadOnly)`, `FindAppointmentCalendarsAsync`, per-calendar `FindAppointmentsAsync(rangeStart, rangeLength, options)` with `MaxCount = 512` and `FetchProperties` (subject, location, details, organizer, invitees, busy status, all-day, recurrence, uri, user response, organized-by-user, `RoamingId`, online meeting link); errors are returned as `CalendarStoreFailure`, never thrown. `Package.appxmanifest` declares `runFullTrust` and `appointmentsSystem` (rescap).

- **[V]** `RequestStoreAsync` lists the `appointmentsSystem` app capability as its requirement. https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.appointments.appointmentmanager.requeststoreasync
- **[V]** Unpackaged apps can get package identity through a sparse/external-location package registered by `Add-AppxPackage -ExternalLocation` or `PackageManager.AddPackageByUriAsync`; Windows build 19041 or later; the package must be signed with a trusted certificate (production cert needed on end-user machines); the sample manifest declares `runFullTrust` and `unvirtualizedResources`. https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps
- **[A, unverified]** Whether `appointmentsSystem` (restricted) is honored in a sparse identity package, and whether it needs store or policy approval, is not stated in what I read. This is the key unknown (spike S1).
- **[V]** `winapp` CLI (`@microsoft/winappcli` 0.7.1) is public preview. `winapp node add-electron-debug-identity` gives `electron.exe` a temporary identity for development. Known Windows bug with sparse-packaged Electron: crash or blank window, workaround `--no-sandbox` in dev; "does not affect full MSIX packaging". Requires Windows 11, Node 22.13+, .NET 10, Visual Studio native workload for its tooling. https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/electron-setup
- Sibling report `shell-frontend.md` selects electron-builder with an NSIS target. NSIS is an unpackaged install, so identity would come from registering a sparse package in the installer, or from adding an MSIX target. This choice and S1 must be settled together.

Options for reaching WinRT from Electron:

| Option | Facts | Assessment |
|---|---|---|
| Rust `windows` crate + napi-rs | **[V]** `windows` 0.62.2 has features `ApplicationModel_Appointments` and `Storage` (crates.io API); `napi` 3.16.1 and `@napi-rs/cli` 3.10.10 current. Node-API gives a stable binary ABI across Node versions (https://napi.rs/docs/introduction/getting-started). **[V]** `windows` was last published 2025-10-06. | Best fit: we already need Rust for audio; one crate; typed; no Visual Studio/WinRT projection tooling at runtime. Cost: hand-written bindings for about 15 properties. |
| `@microsoft/dynwinrt` 0.1.0-preview.24 | **[V]** Microsoft; Rust core, Node-API binding; codegen reads `.winmd`; "No app-specific native addon, node-gyp setup, or C++ wrapper is required"; "primarily targets data-style Windows Runtime APIs"; both Electron examples require package identity; extra SDK classes added via `winapp.jsBindings`. https://devblogs.microsoft.com/ifdef-windows/a-new-way-to-bring-native-windows-apis-to-javascript-introducing-dynamic-api-projections-for-node-js/ and https://github.com/microsoft/dynwinrt | Attractive, less code. Preview, pre-1.0 versions; **[A]** Appointments codegen not verified. Re-evaluate if S1 passes with the Rust route and dynwinrt reaches a stable tag. |
| NodeRT | **[V]** README says modules are native addons that must be compiled for Electron, from Electron 14 on only in the main process, Windows 10 SDK required, SDK list stops at build 17134 (2018). https://github.com/NodeRT/NodeRT | Reject: stale, per-SDK packages, build burden. |
| .NET sidecar exe reusing the existing C# | **[A]** Maximum code reuse. Needs a signed second executable and a JSON-RPC channel; identity inheritance by a child process is unverified. | Fallback if S1 shows the addon cannot get identity but a packaged helper can. |
| Provider APIs (Microsoft Graph, Google Calendar, ICS URL) | Not researched here. | Different product behavior (accounts, consent), but the only cross-platform route and a plausible macOS strategy. Keep `CalendarPort` neutral so this can be added. |

Recommendation: `CalendarPort` in `core`; Windows adapter is a Rust napi-rs function set (`listCalendars`, `getEvents(rangeStart, rangeEnd, disabledIds)`) mapping to the existing `CalendarEvent` shape and failure classification (`AccessDenied`, no identity, other). Keep `CalendarJoinUrl`, series-id, and reminder logic in TS (ported with tests). Do not pick the packaging format until S1 passes.

### 2.7 Meeting and audio-session detection

Observed: `MeetingCallDetector.IsMeeting(processName, windowTitle)` is a pure heuristic (Zoom title contains "Zoom Meeting" or "Zoom Webinar"; Teams `teams`/`ms-teams` with "Meeting" or "Call" in title; `cpthost`; browsers with a Meet code `xxx-xxxx-xxx` plus "Meet" in title). `MeetingCallWatcher` polls every 5 seconds, arms and disarms once per call, suppresses while capture is active, and never throws.

- **[V]** `get-windows` 10.0.0 (sindresorhus, published 2026-10-31): `title`, `owner.name/processId/path`, bounds, `openWindows()`; Windows 7+; ESM only; has a `binding.gyp` so it is a compiled addon; macOS needs accessibility and screen-recording permissions for titles/URLs. https://github.com/sindresorhus/get-windows. `active-win` 9.0.0 last published 2024-04-30.
- **[V]** `IAudioSessionManager2` (Windows 7+) enumerates audio sessions on the endpoint it was activated on and can register for session-created notifications; activated from an `IMMDevice`. https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionmanager2. Activating it on the default **capture** endpoint and listing active sessions' process IDs would show which processes hold the microphone. **[A]** Not tested; sessions for the capture endpoint should be confirmed on real Teams/Zoom/Meet runs.
- **[V, weak]** Per-app microphone consent state is under `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone` with `NonPackaged` subkeys keyed by executable path (DFIR sources via search). I could not confirm the `LastUsedTimeStart/Stop` value names; **[A]** use only as a secondary signal.

Recommendation: do both signals in the Rust Windows module (no extra native package): `EnumWindows` for process name and title, and capture-session enumeration for process IDs. TS `MeetingCallDetector` combines them: title match is necessary for known apps; an active capture session for that process raises confidence and removes the "Call"/"Meeting" title false positives while idle. This is a proposed improvement over the current heuristic and needs field testing. Poll at 5 s as today, or react to session-created notifications and poll only windows.

### 2.8 Spawning CLI tools safely

Observed: `ICliProcessRunner.RunAsync(fileName, string arguments, stdin, timeout, ct)`; arguments are one string (shell-quoting risk); stdin is written then closed; timeout throws and kills.

- **[V]** CVE-2024-27980 (April 2024 Node security releases): spawning `.bat`/`.cmd` without `shell: true` now throws `EINVAL` on Windows; with `shell: true` unsanitized arguments allow command injection. https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
- **[V]** Electron fuses such as `runAsNode` and `nodeCliInspect` let external invocations run commands with the app's permissions; disable the unused ones with `@electron/fuses` (2.1.3). https://www.electronjs.org/docs/latest/tutorial/security
- **[A]** npm-installed CLIs (Claude Code, Codex) typically appear on Windows as `.cmd` shims, so naive `spawn('claude', args)` fails. Options: (a) resolve PATH and PATHEXT ourselves; spawn `.exe` directly with `shell: false`; (b) for a `.cmd`, resolve the shim to the underlying script or executable and spawn that; (c) `cross-spawn` 7.0.6 (last published 2024-11-18) to handle `.cmd` quoting. Prefer (a)/(b); use (c) only if tested against the real shims.

Recommended runner contract: `run({ file, args: string[], stdin?, timeoutMs, signal, cwd, env: allowlist })`. Prompts go on stdin, never in argv. No `shell: true`. Validate `file` against a resolved absolute path from a fixed set of known tool names, not from renderer-supplied strings. Kill the tree on timeout (**[A]** `child.kill()` may leave grandchildren on Windows; use `taskkill /pid <pid> /T /F` or a job object from the Rust module). Cap captured output. Never pass the renderer a way to choose the executable or arguments.

### 2.9 Streaming HTTP

Observed: `XaiApiClient` sends with `HttpCompletionOption.ResponseHeadersRead`, reads lines, and consumes `data:` frames until `data: [DONE]`.

- **[V]** `net.fetch` uses Chromium's network stack and works in main and utility processes; Node `fetch` uses Node's HTTP stack. The page does not document streaming bodies or proxy/cert behavior per method.
- **[A]** Both return a WHATWG `Response` whose `body` is a `ReadableStream`, so the SSE parser is the same either way: split on newlines, handle `data:` frames, `[DONE]`, comment lines, partial frames across chunks, `AbortSignal` for cancel. Choose `net.fetch` if corporate proxies or system certificates matter (the C# app used the OS stack); validate in S5.
- Stream results to the renderer as a tRPC subscription (`tracked()` ids for resume) or a MessagePort. Keep API keys in the worker; the renderer receives only deltas.

### 2.10 Electron security checklist (applied)

Source: https://www.electronjs.org/docs/latest/tutorial/security (20 items).

- Context isolation on, sandbox on, `nodeIntegration` off, `webSecurity` on in every window. No remote content; if a link opens, use `shell.openExternal` after parsing the URL and allowing only `https:` (and `mailto:` if needed).
- CSP: `script-src 'self'`, no `unsafe-eval`; set by header via `webRequest.onHeadersReceived` or a custom protocol response. Avoid `file://`: serve the renderer through `protocol.handle` on a custom scheme.
- `will-navigate` prevented; `setWindowOpenHandler` returns `{ action: 'deny' }`; no `<webview>`.
- `setPermissionRequestHandler` default-deny (microphone and display capture only for our own windows and origin).
- Validate sender origin and frame for every IPC handler (`electron-trpc` `allow`). Validate every input with zod; never accept paths, executables or URLs from the renderer without allowlist checks (meeting IDs instead of paths).
- Fuses: disable `runAsNode`, `nodeCliInspect`, and unneeded options with `@electron/fuses`; enable ASAR integrity checks where supported (**[A]** check the fuse list for 45).
- Keep Electron current: the project supports the latest three majors only (https://releases.electronjs.org/); plan a scheduled upgrade, one major at a time.
- Signing: needed both for auto-update and, if sparse packaging is used, for the identity package.

## 3. Risks and open items

| ID | Risk | Mitigation |
|---|---|---|
| S1 | Calendar needs package identity plus restricted `appointmentsSystem`. Sparse-package support for that capability, Electron stability under sparse identity, and NSIS versus MSIX are unverified. Windows bug affects debug identity. | First spike, before UI work: Electron 45 + `winapp node add-electron-debug-identity` + minimal Rust addon calling `RequestStoreAsync`. Then try a signed sparse package and a full MSIX build. Decision gates the installer format. |
| S2 | `electron-trpc` 1.0.0 is new; subscription and utility-process behavior unverified. | Prototype one query, one subscription, and cancellation. If it fails, write a custom link; router is unchanged. |
| S3 | better-sqlite3 FTS5 and Electron 45 load unverified; `node:sqlite` availability in Electron unverified. | Spike: `require('better-sqlite3')` in a packaged build, create an FTS5 trigram table; same for `node:sqlite`. |
| S4 | DPAPI migration: `safeStorage` raw-blob behavior unknown; `@primno/dpapi` thinly maintained and Electron not mentioned. | Fixture-based test with .NET-produced blob; prefer one `CryptUnprotectData` call inside our own Rust module. |
| S5 | CLI shims and process-tree kill on Windows; `net.fetch` vs Node fetch streaming and proxy behavior. | Integration tests against real `claude`/`codex` shims on Windows; stream test through a local SSE server and a proxy. |
| R1 | Single-maintainer packages: `electron-trpc`, `@primno/dpapi`, `wasapi` (sibling report). | Everything behind ports; keep adapters small. |
| R2 | pnpm with electron-builder and native modules has known friction (hoisting, `asarUnpack`). | Test a packaged build in CI from the first week; use `node-linker=hoisted` if needed. |
| R3 | Rust toolchain and per-OS native builds in CI; macOS needs EventKit, CoreAudio taps, and its own sign/notarize flow. | One `native/` workspace, prebuilt artifacts per platform, neutral port interfaces from day one. |
| R4 | Detection heuristics depend on window titles that vendors change. | Keep the detector pure with fixtures; add the audio-session signal; make the popup optional (already a setting). |

## 4. Sources

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
- Electron net: https://www.electronjs.org/docs/latest/api/net
- Electron releases: https://releases.electronjs.org/
- Node.js sqlite: https://nodejs.org/api/sqlite.html
- SQLite FTS5: https://sqlite.org/fts5.html
- better-sqlite3 releases: https://github.com/WiseLibs/better-sqlite3/releases
- electron-trpc: https://github.com/jsonnull/electron-trpc
- tRPC docs (Context7 `/trpc/trpc` v11.19.0): https://trpc.io
- @primno/dpapi: https://github.com/primno/dpapi
- Chromium os_crypt (as summarized by search; direct fetch failed): https://chromium.googlesource.com/chromium/src/+/bcf73217bfaf1adb3b51ba42dbfc9c396e8dc1c7/components/os_crypt/sync/os_crypt_win.cc
- AppointmentManager.RequestStoreAsync: https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.appointments.appointmentmanager.requeststoreasync
- Package identity with external location: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps
- winapp CLI Electron setup: https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/electron-setup
- dynwinrt announcement: https://devblogs.microsoft.com/ifdef-windows/a-new-way-to-bring-native-windows-apis-to-javascript-introducing-dynamic-api-projections-for-node-js/
- dynwinrt repository: https://github.com/microsoft/dynwinrt
- NodeRT: https://github.com/NodeRT/NodeRT
- napi-rs: https://napi.rs/docs/introduction/getting-started
- IAudioSessionManager2: https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionmanager2
- get-windows: https://github.com/sindresorhus/get-windows
- Node CVE-2024-27980: https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
- Versions: npm registry (`npm view`) and crates.io API, read 2026-11-02/03.
- Repository files read: `MeetingLive.Core/Services/WindowsAppointmentCalendarStore.cs`, `FileDpapiXaiCredentialStore.cs`, `ICliProcessRunner.cs`, `MeetingCallDetector.cs`, `MeetingLive.App/Services/MeetingCallWatcher.cs`, `MeetingLive.App/Package.appxmanifest` (capabilities only), `XaiApiClient.cs` (grep), `MeetingLibraryLayout.cs` (grep); sibling reports `audio-native.md`, `shell-frontend.md` (recommendation sections).
