# Testing, packaging and delivery for the Electron port

Research date: 2026-11-02. Scope: testing stack, Windows packaging, signing, auto-update, app identity, and agent skills. No code was changed and nothing was installed.

Legend: **[V]** verified against a primary source (URL given). **[A]** assumption or inference, not verified.

## 1. Summary of the recommendation

1. **Packaging:** electron-builder on the stable v26 line, **NSIS** target, per-user install, with `electron-updater` for auto-update. Do not ship MSIX in the first release.
2. **Signing:** Azure Artifact Signing (formerly Trusted Signing) if the publisher is eligible; otherwise an OV certificate on a cloud HSM/KMS. Sign the installer and every shipped `.exe`, `.dll` and `.node`.
3. **Tests:** Vitest for unit and component tests, Playwright `_electron` for end-to-end tests with real windows, run against a packaged build. Native code sits behind TypeScript ports; each port has a fake adapter and a shared contract test that the real adapter must also pass.
4. **Synthetic audio:** feed audio through the port, not through Chromium flags, for anything captured natively.
5. **Skills:** install a small set (section 7). Most Electron and napi-rs skills on skills.sh have very low install counts and need review before use.

## 2. Verified tool versions (npm registry, 2026-11-02) [V]

Source: `https://registry.npmjs.org/<package>` dist-tags.

| Package | Version |
|---|---|
| electron | 45.2.1 |
| electron-builder | 26.18.0 (`latest`), 26.18.1 (`v26`), 27.0.0-alpha.14 (`next`) |
| electron-updater | 6.8.11 |
| @electron-forge/cli | 8.0.1 |
| @electron-forge/maker-msix | 8.0.1 |
| @playwright/test | 1.64.1 |
| vitest / @vitest/browser | 5.1.0 |
| @napi-rs/cli | 3.10.10 |
| @electron/fuses | 2.1.3 |
| @electron/windows-sign | 2.1.0 |

## 3. Testing

### 3.1 Findings

- **Playwright Electron is experimental** and supports Electron v21+. `_electron.launch({ args, executablePath, env, recordVideo, timeout })` returns an app handle with `evaluate` (main process), `firstWindow` and `close`. Default launch timeout is 30 s. [V] https://playwright.dev/docs/api/class-electron
- Playwright does **not** intercept native dialogs such as `dialog.showOpenDialog`; stub them with `electronApp.evaluate()`. [V] same page.
- If launch times out, the `nodeCliInspect` fuse (`EnableNodeCliInspectArguments`) must not be `false`. [V] same page. Electron's fuse guide says most apps can disable that fuse. [V] https://www.electronjs.org/docs/latest/tutorial/fuses
  Consequence: a hardened release build cannot be driven by Playwright. You need an e2e build variant, or a pipeline that flips the fuse per variant. [A] that the variant is otherwise identical.
- Electron's own guide lists Playwright and WebdriverIO as the third-party options. [V] https://www.electronjs.org/docs/latest/tutorial/automated-testing
- **Vitest 5.1.0 browser mode** needs a provider. `playwright` is the recommended one and is required for CI/headless; `preview` is not suitable for CI. React components are tested with `vitest-browser-react` and `@vitejs/plugin-react`. Use `userEvent` from `vitest/browser` rather than `@testing-library/user-event`. `vi.spyOn` on module exports throws; use `vi.mock(path, { spy: true })`. [V] https://vitest.dev/guide/browser/
- Chromium has fake-media flags (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture=<abs path to wav>`). They need a local absolute path and a compatible WAV (a 44.1 kHz stereo 16-bit file is reported to work). The fake-UI flag also affects screen-sharing permission. [V, secondary sources only] https://testingbot.com/resources/articles/fake-webcam-microphone-chrome . Whether Playwright's Electron launcher forwards these flags was not confirmed. [A] they can be appended in main via `app.commandLine.appendSwitch` before `ready`; not tested here.
- These flags only affect `getUserMedia` in the renderer. They do not affect a native WASAPI/loopback capture module. [A] inferred from how the flags work; verify when the capture design is chosen.

### 3.2 Comparison

| Layer | Option | Pros | Cons |
|---|---|---|---|
| Unit (main process, domain, binding glue) | Vitest, node environment | Fast, same config as UI tests, TS-native | None significant |
| Component (React) | Vitest browser mode + Playwright provider | Real Chromium, real layout, same engine as Electron | Slower than jsdom |
| Component | Vitest + jsdom/happy-dom | Very fast | No real layout; CSS and accessibility issues missed [A] |
| E2E | Playwright `_electron` | Real windows, main-process `evaluate`, video, traces | Experimental; needs the debug fuse on; no native dialog interception |
| E2E | WebdriverIO electron service | Listed in Electron's guide; can mock Electron APIs | Extra stack beside Vitest/Playwright; not evaluated in depth |

### 3.3 Test doubles for native addons and synthetic audio [A, design]

- Define ports in TypeScript (`AudioCapture`, `Transcriber`, `ModelRuntime`, `Diarizer`, and so on). The Rust/napi addon and Windows-specific code are adapters.
- Provide a fake adapter per port. For audio, a `FileAudioCapture` that reads a WAV fixture and emits PCM frames at real or accelerated pace. Select adapters through an env var read in main (for example `VOZELLA_ADAPTERS=fake`), set from `electron.launch({ env })`.
- Write one **contract test suite per port**, run against the fake in every CI job and against the real adapter in a Windows job. This keeps the fakes honest.
- Rust side: `cargo test` for pure logic; the napi layer gets a small Node-level smoke test that loads the built `.node`.
- Real device paths (WASAPI loopback, real microphone) need a Windows machine with an audio endpoint. Hosted CI runners are unlikely to have one [A, not verified]. Plan a manual or self-hosted check for those paths.
- Keep short deterministic WAV fixtures in the repo (known words, silence, two speakers). Assert on transcripts or segment timing with tolerances, not exact floats.
- Tests must not touch the user's real data folders. Point the app at a temp directory through `app.setPath('userData', ...)` or an env override. [A]

## 4. Packaging

### 4.1 Findings

- **electron-builder:** stable is v26; v27 is `next`/alpha. The docs site now describes v27. [V] registry tags above; https://www.electron.build/
- **Auto-updatable targets** in electron-builder: Windows NSIS only. Squirrel.Windows is not supported by electron-updater. MSIX is not on the list. [V] https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/features/auto-update.md
- **MSIX in electron-builder** is a v27 target (`win.target: msix`) labeled **beta**. It needs a modern `winCodeSign` toolset (>= 1.0.0). MSIX auto-updates are handled by the Microsoft Store or an App Installer `.appinstaller` flow, not electron-updater. `runFullTrust` is always added; `microphone` and `webcam` capabilities can be declared. The docs recommend NSIS for self-managed consumer distribution. [V] https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/msix.md
- **Electron Forge:** has an MSIX maker (`@electron-forge/maker-msix`), documented as experimental, added in Forge 7.10. [V] https://www.electronforge.io/config/makers/msix . Forge's documented update paths are Squirrel.Windows with `update-electron-app`/update.electronjs.org or static storage. [V] https://www.electronjs.org/docs/latest/tutorial/updates
- electron-builder's docs recommend building Forge projects with electron-builder directly rather than the Forge NSIS maker. [V, secondary: OpenReplay summary] https://blog.openreplay.com/packaging-distributing-electron-apps/
- **Native addons and sidecars:** Electron's guide says an addon built with node-gyp must be built against the Electron version, and that Forge handles that automatically. napi-rs ships a prebuilt `.node` per target in per-platform npm packages (for example `-win32-x64-msvc`). [V] https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron ; https://napi.rs/docs/introduction/getting-started
  For binaries and CLI tools, electron-builder says to use `extraResources` and read them via `process.resourcesPath`. [V] https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/contents.md
  [A] N-API is ABI-stable, so a napi-rs `.node` should not need a rebuild per Electron version; confirm with a packaged smoke test. [A] `.node` files must end up outside `app.asar` (electron-builder `asarUnpack`); its auto-detection was not verified because the `asarUnpack` docs page could not be fetched.
- **Fuses:** `@electron/fuses` flips them at package time. The guide's per-fuse advice: disable `runAsNode`, `nodeOptions`, `nodeCliInspect` where unused; enable `embeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`, `cookieEncryption`. `cookieEncryption` is one-way. [V] https://www.electronjs.org/docs/latest/tutorial/fuses

### 4.2 Comparison

| | electron-builder 26 + NSIS | electron-builder 27 + MSIX | Forge 8 + Squirrel | Forge 8 + MSIX |
|---|---|---|---|---|
| Maturity | Stable | Beta; v27 still alpha | Stable (Squirrel) | Experimental |
| Auto-update | electron-updater: differential, staged rollouts, signature checks [V] | Store / App Installer only | Squirrel autoUpdater | Not documented (page silent) |
| Package identity | None (classic desktop app) | Yes | None | Yes |
| Store / Intune | Needs a separate MSI or MSIX | Yes | No | Yes |

## 5. Code signing

- **Azure Artifact Signing** (renamed from Trusted Signing). Electron docs call it the cheapest Windows signing option. electron-builder supports it as `win.sign.type: "azure"`, **beta** in the v27 docs. Auth uses `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, or workload identity federation (GitHub Actions OIDC). [V] https://www.electronjs.org/docs/latest/tutorial/code-signing ; electron-builder `features/code-signing/code-signing-win.md`
- **Eligibility is restricted.** Public Trust certificates: organizations in the US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, Israel; individual developers only in the US and Canada. Requires a paid Azure subscription. Identity validation takes 1 to 20 business days. The service does not issue EV certificates. [V] https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart and https://learn.microsoft.com/en-us/azure/artifact-signing/faq
  The publisher's country and legal entity are not known to this research. **Check this first**; it can rule the service out.
- **EV/OV certificates:** electron-builder's docs say that since 2024 EV no longer earns instant SmartScreen reputation and Microsoft treats EV and OV alike for that purpose; EV keys are hardware-bound and not exportable. [V] code-signing-win.md. Electron's page still says OV certificates no longer prevent warnings since June 2023. [V] The two sources differ in emphasis. SmartScreen reputation builds with download history in either case. [V] Artifact Signing FAQ.
- **electron-updater verifies the Authenticode signer** of downloaded NSIS updates against `publisherName` in `app-update.yml`. In the v27 docs the name must be a distinguished name. A certificate renewal that changes the subject needs a transition release. [V] code-signing-win.md.
- **Signed update manifests** (Ed25519) are described in the v27 docs and are required there. [V] `features/signed-update-manifests.md`. Whether v26 has them was not checked. [A] no.
- `@electron/windows-sign` is the shared signing layer for Forge and other Electron tools. [V] Electron code-signing page.

## 6. App identity

- The current WinUI app is an MSIX with package identity `Name="68A4C6A1-6F51-4AFA-85FA-C8840003F1D7"`, `Publisher="CN=AppPublisher"`, and declares `runFullTrust`, `appointmentsSystem` and `systemai:Capability systemAIModels` (`MeetingLive.App/Package.appxmanifest`). [V, read from repo]
- An NSIS-installed Electron app has no package identity. Features tied to it, such as the `appointmentsSystem` capability, `systemAIModels`, and the packaged-app microphone consent entry, may not carry over. [A] Which of these the Electron port needs is not yet known; confirm per feature before dropping MSIX.
- The project rule is to keep internal names `MeetingLive` and not rename data folders (`AGENTS.md`). In Electron, keep `appId`, `productName` and the `userData` folder name stable for the same reason. [A] Changing `appId` changes the NSIS uninstall registry key and the notification AppUserModelID.
- Existing user data lives in Documents\MeetingLive and %LOCALAPPDATA%\MeetingLive. Migration or read-in-place was not investigated and those folders were not touched.
- If MSIX is added later (Store or Intune), keep the NSIS channel and publish MSIX as a second artifact with its own update path.

## 7. Agent skills

Method: `npx skills find <query>` (skills.sh CLI search) and the skills.sh home page. Install counts are from that output on 2026-11-02. Nothing was installed. Third-party skills are arbitrary instructions; read each `SKILL.md` before installing. [A] Individual skill quality was not reviewed.

### 7.1 Already available

| Skill | Location | Use for this project |
|---|---|---|
| `find-skills` | `C:\Users\andres\.agents\skills`, linked from `.claude\skills` | Discover further skills |
| `design-patterns` | `C:\Users\andres\.claude\skills` | Ports/adapters around native code |
| `cognitive-doc-design` | same | Port docs and ADRs |
| `work-unit-commits`, `chained-pr`, `branch-pr` | same | Commit and PR slicing for the port |
| `skill-creator`, `skill-improver`, `skill-registry` | same | Authoring project skills for Electron conventions |
| `judgment-day`, `systemic-issue-triage` | same | Review and triage |
| `design:accessibility-review`, `design:design-system`, `design:design-critique` | session plugins | UI and a11y review |
| `vercel:react-best-practices`, `vercel:shadcn` | session plugins | React and component library guidance |
| `run` | session built-in | Launch Electron apps (has an Electron pattern) |
| Project `.agents/skills/*` (winui-*, csharp-xunit, run-tests, test-anti-patterns, assertion-quality, test-gap-analysis, coverage-analysis, dotnet-pinvoke) | `C:\Code\vozella\.agents\skills` | WinUI/.NET specific; reference while porting. `test-anti-patterns` and `assertion-quality` may transfer in concept [A] |

No installed skill covers Electron, Playwright, Vitest, Rust or napi-rs. `AGENTS.md` routes UI tests to `winui-ui-testing` and says Playwright does not apply; that rule must change for the Electron codebase.

### 7.2 Candidates to install

| Skill | Install | Installs | Why |
|---|---|---|---|
| playwright-best-practices | `npx skills add currents-dev/playwright-best-practices-skill@playwright-best-practices` | 101.6K | Locator, fixture and flakiness rules for the e2e suite |
| vitest (antfu) | `npx skills add antfu/skills@vitest` | 45.6K | Vitest config and mocking patterns |
| vercel-react-best-practices | `npx skills add vercel-labs/agent-skills@vercel-react-best-practices` | 864K | React quality rules; overlaps the session `vercel:react-best-practices`, install only for a persistent copy |
| frontend-design | `npx skills add anthropics/skills` (skill `frontend-design`) | 1.1M | Guards against generic-looking UI; fits the Notion/Granola direction. skills.sh lists the repo command without a skill selector |
| accessibility (Addy Osmani) | `npx skills add addyosmani/web-quality-skills@accessibility` | 66.2K | WCAG checks for the React UI |
| fixing-accessibility | `npx skills add ibelick/ui-skills@fixing-accessibility` | 22.7K | Targeted a11y fixes; a `ui-skills` MCP server is also available in this session |
| rust-best-practices | `npx skills add apollographql/skills@rust-best-practices` | 22.1K | Rust idioms for the native crate |
| rust-testing | `npx skills add affaan-m/ecc@rust-testing` | 13K | Rust test patterns |
| rust-async-patterns | `npx skills add wshobson/agents@rust-async-patterns` | 21K | Audio pump and inference threads |
| shadcn | `npx skills add shadcn/ui` | 271.1K | Only if shadcn/ui is chosen for the renderer; a shadcn MCP server is already available |
| electron-development | `npx skills add mindrally/skills@electron-development` | 1.4K | Low volume; review first |
| electron (partme-ai) | `npx skills add partme-ai/full-stack-skills@electron` | 2.4K | Low volume; review first |
| electron-best-practices | `npx skills add jwynia/agent-skills@electron-best-practices` | 834 | Low volume; review first |
| napi-rs | `npx skills add liangmiqwq/skills@napi-rs` | 21 | Only napi-rs-specific result found; treat as a draft |
| winapp-cli | `npx skills add github/awesome-copilot@winapp-cli` | 8.4K | Related to the current WinUI tooling; likely unnecessary after the port |

Gap: no widely used Electron-specific or napi-rs skill exists. Better to author a project skill with `skill-creator` that records this repo's decisions (ports, fuses, e2e build variant, signing, release steps) once the architecture is settled.

## 8. Recommendation and tradeoffs

**Ship NSIS via electron-builder 26 with electron-updater, signed through Azure Artifact Signing when eligible. Test with Vitest (unit plus browser-mode components) and Playwright `_electron` against a packaged e2e variant. Isolate all native code behind ports with contract-tested fakes.**

Tradeoffs:
- **NSIS over MSIX:** working, signature-verified, differential auto-update now. Costs package identity, and so possibly some Windows integrations the WinUI app has today. Store listing and Intune need an extra artifact later.
- **v26 over v27:** v26 is stable. v27 adds MSIX beta, signed manifests and a stricter `publisherName`, but is still alpha. Revisit at v27 stable; `electron-builder migrate-schema` exists for config changes [V].
- **electron-builder over Forge:** better updater and signing story for Windows NSIS. Forge is the Electron-maintained path, but its Windows updater is Squirrel and its MSIX maker is experimental.
- **Playwright over WebdriverIO:** one browser engine toolchain shared with Vitest browser mode; accepts the "experimental" label and the fuse requirement.
- **Fakes over device tests in CI:** deterministic and fast, but real-audio regressions are caught only by a separate Windows job or manual run.

## 9. Risks

1. **Signing eligibility:** Azure Artifact Signing may be unavailable for the publisher's country or entity. Fallback is a paid OV/EV certificate with cloud signing. Needs an owner decision.
2. **Package identity loss:** features tied to MSIX identity (`appointmentsSystem`, `systemAIModels`, microphone consent behavior) may not work unpackaged. Unverified.
3. **Playwright Electron is experimental** and depends on a fuse that production hardening disables; the e2e build variant must never ship.
4. **electron-builder v27 churn:** the docs site already describes v27; pin versions and read the v26 docs for the shipped line.
5. **Native packaging unverified:** `.node` unpacking, sidecar paths and ASAR integrity need a packaged smoke test on a clean Windows VM early.
6. **SmartScreen:** a signed but new app may still warn until reputation accrues. [V] Artifact Signing FAQ.
7. **Update-signature check depends on PowerShell** (`Get-AuthenticodeSignature`); blocked PowerShell (for example AppLocker) rejects updates. [V] code-signing-win.md.
8. **Skills supply chain:** low-volume third-party skills are unreviewed instructions loaded into the agent.
9. **Audio CI gap:** no verified way to exercise real WASAPI capture on hosted runners.
10. **macOS later:** NSIS, Azure signing and MSIX are Windows-only; macOS signing, notarization and updates were not researched here.

## 10. Sources

- https://playwright.dev/docs/api/class-electron
- https://www.electronjs.org/docs/latest/tutorial/automated-testing
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electronjs.org/docs/latest/tutorial/code-signing
- https://www.electronjs.org/docs/latest/tutorial/updates
- https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron
- https://www.electronjs.org/docs/latest/tutorial/windows-store-guide
- https://www.electronforge.io/config/makers/msix
- https://vitest.dev/guide/browser/
- https://napi.rs/docs/introduction/getting-started
- https://www.electron.build/
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/msix.md
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/features/auto-update.md
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/features/code-signing/code-signing-win.md
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/features/signed-update-manifests.md
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/contents.md
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/migration/whats-new-v27.md
- https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- https://blog.openreplay.com/packaging-distributing-electron-apps/
- https://testingbot.com/resources/articles/fake-webcam-microphone-chrome
- https://skills.sh/ and `npx skills find` output
- https://registry.npmjs.org/ (version checks)
