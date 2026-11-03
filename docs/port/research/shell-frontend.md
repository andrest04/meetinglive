# Electron shell and frontend research

Date of research: 2026-11-02. Scope: Electron build tooling, UI framework, styling and primitives, note editor, state, lists, routing, transparent/always-on-top windows, tray.

Legend: **[V]** verified against a primary source fetched during this research (URL given). **[A]** assumption or judgment, not verified.

## 1. Recommendation (short)

| Concern | Choice |
|---|---|
| Electron | Current stable line (45.x at time of writing), pinned exactly, upgraded on a schedule |
| Dev/build | **electron-vite 6** (Vite 8) |
| Packaging/updates | **electron-builder** (NSIS target, `electron-updater`) |
| UI framework | **React 19** + TypeScript |
| Styling | **Tailwind CSS v4** with CSS variables carrying the Vozella palette |
| Primitives | **Base UI** (`@base-ui/react`), copied-in components in the shadcn style; Radix only where Base UI lacks a part |
| Notes editor | **TipTap 3** (ProseMirror) with `@tiptap/markdown`, Markdown as the stored format |
| State | **Zustand** for UI state; main process owns domain state; no client cache library beyond a thin IPC query layer |
| Lists | **TanStack Virtual** |
| Routing | **TanStack Router** (hash history), or no router for the pill/popup windows |
| Process model | Sandboxed renderers, context isolation, typed IPC through a preload bridge |

## 2. Findings

### 2.1 Electron versions and support
- npm `latest` for `electron` is 45.2.1 (published 2026-10-31); 45.0.0 was published 2026-10-21; 44.0.0 on 2026-08-25; 43.0.0 on 2026-06-30. **[V]** https://registry.npmjs.org/electron
- Electron 45 requires Node `>= 22.12.0` to install the package. **[V]** https://registry.npmjs.org/electron/45.2.1
- Electron 45 ships Chromium 156.0.8078.48, Node 24.22.0, V8 15.6. **[V]** https://www.electronjs.org/blog/electron-45-0
- Support policy: latest three stable majors. **[V]** https://www.electronjs.org/docs/latest/tutorial/electron-timelines (the cached page's example still says 42.x, so the page text is not a reliable currency signal; the npm registry is).
- Electron 45 breaking changes that touch this app: sandboxed preloads lose `Buffer`, `setImmediate`, `events`/`timers`/`url` shims; screen/window capture permission requests arrive as `display-capture` rather than `media`; synchronous `safeStorage` methods are deprecated and removed in 46; ASAR file descriptors work only through Node `fs`. **[V]** https://www.electronjs.org/blog/electron-45-0
- Electron 45 adds an experimental `session.registerLocalAIHandler()` backed by a utility process. Its relevance to local transcription is not evaluated here; local inference is covered by another research track. **[V]** same URL. Treat as experimental. **[A]** that it will not be the inference path.
- ESM: supported in the main process since Electron 28 (`.mjs` or `"type": "module"`); sandboxed preload scripts cannot use ESM and must be bundled to plain JS; ESM preloads must be `.mjs`. **[V]** https://www.electronjs.org/docs/latest/tutorial/esm

### 2.2 Build tooling

| | electron-vite | Electron Forge (+ Vite plugin) | electron-builder |
|---|---|---|---|
| Latest | 6.0.0 (2026-10-14); 5.0.0 was 2025-12-07 **[V]** | CLI/plugin-vite 8.0.1 (2026-09-29) **[V]** | 26.18.0 `latest`; 27.0.0-alpha.14 on `next` **[V]** |
| Role | Dev server, HMR, build for main/preload/renderer | Scaffolding, build, package, make, publish | Packaging, installers, auto-update metadata |
| Vite | peer `^6 \|\| ^7 \|\| ^8`; Node `^20.19 \|\| >=22.12` **[V]** | Vite plugin "marked as experimental" since v7.5.0, minor releases may break **[V]** | n/a |
| Notes | v6 adds Vite 8 (Rolldown) support, bytecode compile option **[V]** https://github.com/alex8088/electron-vite/releases | Official Electron tool; single renderer entries with injected `MAIN_WINDOW_VITE_DEV_SERVER_URL` globals; multiple renderers supported **[V]** https://www.electronforge.io/config/plugins/vite | Node `>=14` engines on 26.x; v27 alpha moves to ESM **[V]** (registry) |

Decision reasoning:
- electron-vite is purpose-built for three-target Vite builds (main, preload, renderer), supports multiple renderer entries (main window, pill, popup, settings) in one config, and tracks Vite closely. **[V]** for Vite range; multi-entry claim is from the v6 release notes ("fixes ... multi-entry builds").
- Forge's Vite plugin is still labelled experimental by its own docs, which is a poor base for a project that must ship Windows installers from the start. **[V]**
- electron-builder has the longer-established NSIS and `electron-updater` path. The only 2026 comparison found (OpenReplay, June 2026) says the same, but it is a single secondary source. **[A]** Re-check NSIS code-signing and per-user install options against current electron-builder docs when the packaging task starts.
- Risk: electron-vite 6 is 18 days old and Vite 8/Rolldown is new. **[A]** Mitigation: pin exact versions; the config surface is small, and Vite 7 remains a supported peer.
- Alternative not chosen: Forge end-to-end. It is the defensible conservative option if the team prefers a single official tool; the cost is the experimental Vite plugin.

### 2.3 UI framework: React vs Svelte vs Solid
npm latest: react 19.3.1, svelte 5.57.3, solid-js 1.9.18. **[V]** registry.

Verified facts are limited to versions. The comparison below is judgment **[A]**:
- Editor ecosystem: TipTap, Lexical, and the shadcn/Base UI component sets are React-first. TipTap has a framework-agnostic core and is usable from Svelte or Solid, but community wrappers add a maintenance dependency.
- Hiring/agent fluency: React has the largest corpus; most agents and contributors produce correct React with less correction.
- Performance: Svelte 5 and Solid have smaller runtimes and fine-grained updates. For a desktop app with one live editor and a virtualized meeting list, the difference is unlikely to be user-visible; Electron startup is dominated by Chromium and main-process work.
- Result: React 19. Svelte 5 would be the second choice if bundle size and reactivity ergonomics outweigh ecosystem reach; Solid has the thinnest component ecosystem for this app's needs.

### 2.4 Styling and primitives
- Tailwind v4 core needs Chrome 111+. Electron 45's Chromium 156 is far above it, so no compatibility fallbacks are needed. **[V]** https://tailwindcss.com/docs/compatibility. tailwindcss npm latest 4.3.4. **[V]**
- Base UI reached v1.0.0 stable on 2025-12-11 with 35 unstyled components; Drawer stable in 1.3.0, OTP Field in 1.6.0; latest v1.9.0 (2026-10-09). **[V]** https://base-ui.com/react/overview/releases. Components include Dialog, Popover, Menu, Context Menu, Tooltip, Toast, Tabs, Select, Combobox, Scroll Area, Toolbar. **[V]**
- shadcn's changelog lists Base UI, React Aria, and Radix as supported bases, with entries "Base UI as the Default" (July 2026) and "Unified Radix UI Package" (February 2026). The excerpt had titles only for those two entries. **[V, partial]** https://ui.shadcn.com/docs/changelog. shadcn CLI npm latest 4.23.0. **[V]**
- Radix maintenance status in 2026: no authoritative statement found. Secondary sources describe maintainer attrition after the WorkOS acquisition and migrations to Base UI. **[A]** Treat Radix as a working but lower-momentum choice.
- Plan: use the shadcn CLI to copy components built on Base UI, then restyle with the Vozella palette tokens (CSS variables) and the Notion/Granola feel: quiet neutrals, hairline borders, small radii, tight type scale. The palette and mark files are in `docs/brand/`. Exact palette values were not read in this research.

### 2.5 Notes editor (meeting notepad, Markdown round trip)
The app already stores each meeting as a `.md` file (`MarkdownMeetingRepository`, per AGENTS.md), so Markdown is the system of record and the editor is a view over it.

| Editor | Version | Markdown | Fit |
|---|---|---|---|
| TipTap 3 (ProseMirror) | core 3.32.2 **[V]** | Official `@tiptap/markdown` 3.32.2, parses with MarkedJS and serializes through per-extension render handlers; `editor.getMarkdown()` and `contentType: 'markdown'` **[V]** https://tiptap.dev/docs/editor/markdown | Strong. Task lists work with `TaskList`/`TaskItem` and `gfm: true`. Docs call it an early release with possible edge cases and list limits: no comments, one child node per table cell. **[V]** |
| Lexical | 0.53.0 **[V]** | `@lexical/markdown` import/export with transformers; docs state no full round-trip guarantee and document no table or task-list transformer in the built-in list **[V]** https://lexical.dev/docs/packages/lexical-markdown | Weaker on Markdown fidelity; pre-1.0 versioning. Strong React integration. |
| Milkdown | 7.23.0 **[V]** | Built on ProseMirror and remark **[A]**, markdown-first | Design docs could not be fetched, so fidelity and maintenance are unverified. |
| Raw ProseMirror + `prosemirror-markdown` | 1.13.9 **[V]** | markdown-it based parser/serializer **[A]** | Maximum control, most work. TipTap already sits on ProseMirror, so this stays available as an escape hatch. |

Recommendation: TipTap 3 with `@tiptap/markdown`. Tradeoffs:
- The Markdown extension is young; round-trip fidelity must be proven by a golden-file test suite against real note shapes (headings, nested lists, task lists, tables, inline code, links, hard breaks) before the editor is accepted. If the suite fails in ways that cannot be patched with custom handlers, fall back to `prosemirror-markdown` under the same TipTap schema. **[A]**
- Store Markdown only; do not store editor JSON. This keeps existing files and the Windows app's files compatible during the port.
- The Granola-style flow (user's raw notes merged with an AI-generated summary) maps to two ProseMirror documents or a marked region; design in the notes-module task, not here. **[A]**

### 2.6 State, lists, routing
Versions: zustand 5.0.16, jotai 3.0.1, @tanstack/react-virtual 3.14.25, @tanstack/react-router 1.170.46, react-router 8.5.1, @legendapp/list 3.7.1. **[V]** registry. Everything below is judgment. **[A]**
- State: the main process is the source of truth for recordings, meetings, and models. The renderer holds view state only. Zustand for UI state (selected meeting, panels, recording status mirror). Subscribe to main-process events through the preload bridge and write them into small stores. Jotai is a fine alternative; no strong reason to prefer it.
- Server-state libraries (TanStack Query) are optional here because IPC is local and cheap; add one only if cache invalidation logic starts to spread.
- Lists: TanStack Virtual for the meeting library and long transcripts. Variable-height transcript rows need `measureElement`; prototype with a 10k-segment transcript.
- Routing: the main window is a few views (library, meeting, settings). TanStack Router with hash history works under `file://` loading. The pill and popup windows are separate renderer entries with no router.

### 2.7 Transparent, always-on-top windows and tray
Verified:
- `setAlwaysOnTop(flag, level)` works on macOS and Windows. Levels `floating` through `status` sit below the taskbar on Windows; `pop-up-menu` and above sit above it. Default level for `true` is `floating`. Unsupported on Wayland. **[V]** https://www.electronjs.org/docs/latest/api/browser-window
- `setIgnoreMouseEvents(true, { forward: true })` gives click-through with mouse-move forwarding on Windows, but forwarding stops temporarily while the active window runs at a higher integrity level (UIPI), for example an elevated Task Manager. **[V]** same URL
- `setContentProtection(true)` on Windows uses `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+; older versions show a black window); effect lands at the next composition. **[V]** same URL. Use this to keep the pill out of screen shares if desired.
- `setSkipTaskbar` and `setFocusable` exist on macOS and Windows. **[V]** same URL
- Transparent windows are not resizable, cannot be maximized by system menu or title-bar double-click, and do not work with DWM disabled on Windows. **[V, via search snippet of the window-customization doc]** https://ayakael.net/mirrors/electron/raw/commit/c8bdd014c87b5c33b77c845f853b7e52bb31de8f/docs/tutorial/window-customization.md (mirror of an older docs revision; confirm against current docs).
- Reported Windows transparency issues exist in the Electron tracker (full-monitor-sized transparent window renders white; a small transparent always-on-top window on Windows 11 rendered fully transparent; stuck frames), none confirmed fixed in a 2026 release in the sources found. **[V that the issues exist]** https://github.com/electron/electron/issues/37088, https://github.com/electron/electron/issues/42169. Current reproducibility on Electron 45 is **[A]** unknown.
- Tray: ICO icons recommended on Windows; `guid` keeps icon position across launches but is tied to the executable path unless the exe is code-signed; `right-click`, `double-click`, `middle-click`, `balloon-*` events and `displayBalloon()` are Windows features. **[V]** https://www.electronjs.org/docs/latest/api/tray

Recommendations **[A]**:
- Build the recording pill as a small frameless transparent window, `alwaysOnTop` at `screen-saver` or `pop-up-menu` level only if it must clear the taskbar; otherwise `floating`. Fixed size, no resize. Never size a transparent window to a full monitor.
- Do the shape and shadow in CSS inside the transparent area; do not use native shadows.
- Make a spike (one day) that opens the pill and a popup on Windows 10 and 11 with GPU on and off, before locking the design.
- Use the tray GUID only once builds are code-signed; unsigned dev builds should omit it.
- Main window: native frame hidden with `titleBarOverlay`, draggable regions via `-webkit-app-region`. Electron 45 adds `ELECTRON_DEBUG_DRAGGABLE_REGIONS` for debugging these. **[V]** blog. `titleBarOverlay` and Mica (`backgroundMaterial`) specifics were not verified: the fetched pages did not cover them. Check the custom title bar page during implementation.

## 3. Risks

1. **TipTap Markdown fidelity** (medium-high): extension is labelled early-release. Mitigation: golden-file round-trip tests first; fallback to `prosemirror-markdown`.
2. **New toolchain majors** (medium): electron-vite 6 and Vite 8/Rolldown are weeks old. Mitigation: exact version pins, Vite 7 as a supported fallback.
3. **Transparent window behavior on Windows** (medium): open tracker issues, no 2026 confirmation. Mitigation: early spike on real hardware; keep a non-transparent opaque-pill fallback design.
4. **Electron upgrade cadence** (medium): a new major roughly every two months and only three supported. Mitigation: plan upgrades per quarter; keep native code behind interfaces in the main process.
5. **Sandboxed preload constraints** (low): no ESM, no Node shims in preload on 45. Mitigation: bundle preload to CJS with electron-vite; expose only a typed API.
6. **Base UI / shadcn drift** (low-medium): copied components diverge from upstream. Mitigation: keep customizations in tokens, not forked logic.
7. **Unverified items**: Radix current maintenance, Milkdown design and maintenance, titleBarOverlay/Mica details, NSIS and `electron-updater` specifics, Electron 45 EOL date. These need checking when their tasks start.
8. **Secondary-source claims**: Forge-vs-builder comparison and Radix status rely on blog posts and discussion threads, not maintainer statements.

## 4. Sources
- https://registry.npmjs.org/electron, https://registry.npmjs.org/electron/45.2.1, https://registry.npmjs.org/electron-vite/latest, https://registry.npmjs.org/@electron-forge/plugin-vite, https://registry.npmjs.org/electron-builder, https://registry.npmjs.org/@tiptap/markdown (versions and dates; also react, svelte, solid-js, tailwindcss, @base-ui/react, shadcn, lexical, @milkdown/core, prosemirror-markdown, zustand, jotai, @tanstack/react-virtual, @tanstack/react-router, react-router, vite)
- https://www.electronjs.org/blog/electron-45-0
- https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- https://www.electronjs.org/docs/latest/tutorial/esm
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/tray
- https://www.electronforge.io/config/plugins/vite
- https://github.com/alex8088/electron-vite/releases
- https://tailwindcss.com/docs/compatibility
- https://base-ui.com/react/overview/releases
- https://ui.shadcn.com/docs/changelog
- https://tiptap.dev/docs/editor/markdown, https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage
- https://lexical.dev/docs/packages/lexical-markdown
- https://github.com/electron/electron/issues/37088, https://github.com/electron/electron/issues/42169
- https://blog.openreplay.com/packaging-distributing-electron-apps/ (secondary)
