# Parity ledger: settings-i18n (domain, integration and user interface)

Spec: `docs/port/specs/settings-i18n.md`. Section 8 has 126 items; every one is below. The Settings page is built (user interface half); rows that said `open-ui` now carry their final status.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`. `open-ui` is no longer used: every row has its final status.

## Where things are

| Concern | Code |
| --- | --- |
| Formatting (`{0}`, `{1:t}`, `{2:0.#}`, `d MMM, HH:mm`), lookup with fallback and warning, meeting title | `packages/core/src/i18n/format.ts`, `translator.ts` |
| `resolveCulture`, `matchPrimarySubtag`, `resolveUiLanguage`, picker options | `packages/core/src/i18n/ui-language.ts` |
| Language catalogs, engine locale mapper, strict resolvers | `packages/core/src/settings/languages.ts` (used by `library/settings.ts` resolvers) |
| Summary model catalog, fit rating, size label | `settings/summary-models.ts` |
| Claude, Codex, xAI lists and defaults, `optionsIncluding` | `settings/inference-options.ts` |
| xAI `resolveXaiModelId`, `mergeModelList` | `settings/xai.ts` |
| Note templates | `settings/note-templates.ts` |
| CLI executable names | `settings/cli-providers.ts` |
| Checked commands (language, provider, CLI options, meeting language) | `settings/commands.ts` |
| Local models (rows, download, cancel, select, delete) | `settings/local-models.ts` |
| xAI account view and actions | `settings/xai-account.ts` |
| Page snapshot (local phase) | `settings/page-service.ts` |
| Exit gate and restart | `settings/exit-gate.ts` |
| Notices, section frame, new message keys | `settings/notices.ts`, `settings/sections.ts` |
| Ports | `settings/ports.ts` |
| Adapters: PATH probe, hardware probe, file model store, download | `packages/platform/src/settings/` |
| Doubles | `packages/platform/src/fakes/fake-settings-ports.ts` |
| Wiring | `packages/platform/src/settings/settings-runtime.ts` |
| Channels | `packages/contracts/src/settings.ts` |
| Handlers, locale state, startup language, single instance | `apps/desktop/src/main/ipc/settings-handlers.ts`, `main/i18n/`, `main/bootstrap/single-instance.ts`, `main/index.ts` |
| Catalog checks (counts, placeholders, specifiers, references) | `apps/desktop/src/main/i18n-catalog-checks.test.ts` |
| Real-window checks (services) | `apps/desktop/e2e/settings-i18n.spec.ts` |
| Page state: one snapshot, checked commands, download events, feedback timer | `apps/desktop/src/renderer/features/settings/use-settings-page.ts` |
| Page and blocks | `features/settings/SettingsRoute.tsx`, `LanguageSection.tsx`, `ProviderSection.tsx`, `LocalModels.tsx`, `XaiAccount.tsx`, `MeetingLanguageSection.tsx`, `ProviderMark.tsx` |
| First paint language, live switch | `main.tsx` (`i18n.getLocale`), `i18n/I18nProvider.tsx` (`i18n.localeChanged`) |
| Kit additions | `ui/RadioGroup.tsx` (`layout="rows"`, `trailing`), `ui/layout.tsx` (`SectionHeader compact`, smaller level 3) |
| Component tests | `features/settings/SettingsRoute.test.tsx` (10 cases) |
| Real-window UI checks, axe in both themes | `e2e/settings-ui.spec.ts` (8 cases); `e2e/shell.spec.ts` language test updated |
| Screenshots (opt in with `VOZELLA_SCREENSHOTS=1`) | `e2e/settings-screens.spec.ts` to `docs/port/screens/settings-i18n/` |

## Decisions

- **No new Rust.** Nothing in this module needs the OS beyond what Node has. RAM comes from `os`. The GPU comes from one PowerShell query (`powershell.exe`, no shell string from user input), run once per process and cached. `packages/platform/src/settings/system-hardware-probe.ts` reads the 64-bit registry value `HardwareInformation.qwMemorySize` first and falls back to WMI `AdapterRAM`. Observed on this machine through the real probe: 31.6 GB RAM, RTX 3070 Laptop GPU, 8 GB (the WMI field alone says 4 GB), 3.4 s the first time. Second audit fix: it did not run off the page's critical path, because `SettingsPageService.load` awaits it. `SettingsRuntime.warmUp()` now starts it when the app is ready, so the first visit normally finds it cached (`settings-runtime.test.ts`). A visit in the first seconds can still wait for the rest of the query. Decision: the badges are not drawn late, because the page would need a second load phase for a rating that is usually ready.
- **Language change applies live and still offers the restart.** The settings are saved first; only then does the main process switch its locale and push `i18n.localeChanged` to every window (B11). Strings are looked up when drawn (B9), so a live switch is consistent; the restart prompt stays because spec items 19 to 22 ask for it and later modules (tray, toast text) may build strings once. The UI half decides whether the prompt appears; the channels support both.
- **Restart** is `app.relaunch` then `app.quit`, so the normal quit path (library writes, audio worker) still runs. A relaunched process carries `--vozella-relaunched` and retries the single-instance lock for up to 8 s, so the old process shutting down does not make the new one quit. A refused gate returns `refused`; a failed relaunch returns `failed` with the message (B10).
- **Strict values.** The checked commands accept only the four provider names, the two UI tags, the catalog codes, the listed Claude and Codex models and efforts, and the five xAI efforts. An xAI model is any non-blank id up to 200 characters, because that list comes from the network. A stored value outside a list counts as the current value (so choosing it again is a no-op) and the page option lists include it (B13).
- **Language codes (B6).** Case and spaces are ignored. A code the transcription catalog does not know resolves to `auto`, like the engine mapper. A code the summary catalog does not know resolves to `es`. The picker and the engine now always agree. Recorded as a behavior change: before, a hand-edited `fr` summary language went to the summarizer unchanged; the summarizer's tolerance for it was never verified.
- **Active model (B7).** A model is `active` only while its file exists. A saved id with no file, or not in the catalog, is returned as `missingActiveId` and nothing is written, so the page can say why none is active.
- **Settings read failure (B18).** `settings.getPage` rejects when `settings.json` cannot be read (a damaged file is a different case: it is set aside and defaults are used, with a notice). The UI shows `Ui_SettingsLoadFailed` instead of showing defaults as if they were loaded.
- **xAI.** The credential store, token refresh, model listing and SuperGrok sign in belong to the xAI module. This module defines `XaiAccountPort` and drives it. With no port registered the page reports `xai.available: false` and `capabilities.xaiAccount: false`, and offers no account controls. `capabilities.xaiSignIn` is false until the xAI module passes `xaiSignIn` to the handlers. In the fake native build a `FakeXaiAccount` is registered so the section can be exercised without a network or a real account.
- **No fake controls.** `SETTINGS_SECTIONS` lists the page blocks in spec order with their owner and whether they are `built` or `slot`. The frame draws nothing for a slot.
- **Settings update channel.** The generic `settings.update` of the library module is unchanged because other modules edit their own fields through it. Everything this page owns goes through the checked `settings.set*` commands. `settings.update` still accepts any value for those fields; a later pass could refuse them there.
- **TypeSafe description (7.19), product decision made without a user.** The default stays `typeSafeEnabled = true` (a test enforces it, and the key is the real gate). The wrong sentence `Settings_TypeSafeEnabled.Description` ("Off by default until you save a key.") is converted data, so it is not edited. The TypeSafe module should use a new `Ui_` key with the corrected sentence: en "On by default. It only runs when a key is saved." / es "Activado por defecto. Solo se ejecuta si hay una clave guardada."
- **Merged catalogs.** `en.json` and `es.json` hold the 604 app strings and the 43 core strings together (the converter did this before this module), which is 647 keys per locale. The checks read the original `.resw` and `.resx` files and compare text key by key.
- **TDD note.** RED was observed (module missing) for the commands, local models, xAI account, page service, exit gate and notices tests. For the i18n core, the catalogs, the platform adapters, the contracts and the handlers, the tests were written together with or just after the code and were green on first run. The regression tests below were written against the fixed behavior.

## Parity items

### Page shell and load

| # | Status | Notes |
| --- | --- | --- |
| 1 | done | Blocks follow `SETTINGS_SECTIONS` inside the 720 px shell column, `gap-8` between blocks, hairline rows (`features/settings/SettingsRoute.tsx`) |
| 2 | done | `SettingsPage_Title.Text`, used by the existing route |
| 3 | improved | A skeleton of text lines under the page title (name `Ui_SettingsLoading`) instead of a 32 px ring, and no content is drawn until the first answer, so defaults never paint (`SettingsRoute.test.tsx`) |
| 4 | improved | The route is not cached: each visit mounts the page, which reads `settings.getPage` again. Decision: with no view model to keep alive, a fresh read is the simpler way to show what is saved |
| 5 | done | The loaded content fades in over 150 ms (`animate-fade-in`, ease-out opacity, stack.md Motion). The global reduced-motion rule shrinks it to 0.01 ms, so it is off for that setting (`SettingsRoute.test.tsx`) |
| 6 | done | `SettingsPageService.load` reads settings and hardware together (`Promise.all`). The ring painting first is UI |
| 7 | done | `alive` ref: an answer that arrives after the page unmounted changes nothing. The load writes nothing (e2e: no `settings.json` after opening) |
| 8 | done | One `SettingsPageDto` in state; every block draws from it in one render |
| 9 | done | The network phase is its own request (`settings.xai.refresh`), single flight, and a failure is a value in the view, never a rejection. Calendar loading belongs to its module |
| 10 | improved | B18. A failed read rejects with the message; the UI shows `Ui_SettingsLoadFailed` and clears the ring in `finally` |
| 11 | improved | The commands ignore a value equal to the current one, so an echo from a programmatic load cannot save anything or show feedback. No suppression flag is needed on the domain side |
| 12 | dropped | Not this module: the microphone meter and the ASR backend belong to audio-capture and transcription, which mount in their slots. Nothing is drawn for them here |

### App UI language

| # | Status | Notes |
| --- | --- | --- |
| 13 | done | `LanguageSection`: Select with the two endonyms, English then Español (`settings-ui.spec.ts`) |
| 14 | done | Header and description keys used as is; Spanish rendering seen in `settings-es-light.png` |
| 15 | done | `main.tsx` asks `i18n.getLocale` before the first render and passes it to `I18nProvider`; `localStorage` no longer holds the language. A window with no bridge falls back to the OS language (component tests only) |
| 16 | done | `getPage.uiLanguage` is the saved tag or the OS match by primary subtag; nothing is saved on load (tested) |
| 17 | done | `setUiLanguage` of the shown language returns `ignored: unchanged` |
| 18 | done | `I18nProvider` listens to `i18n.localeChanged` and switches every string at once (e2e: html `lang` and the headings turn Spanish without a restart) |
| 19 | done | Dialog with the four keys; Restart now takes focus (e2e). It opens after the switch, so it is already in the new language |
| 20 | done | Later closes the dialog and calls nothing; the language already applies (`SettingsRoute.test.tsx`) |
| 21 | done | `app.restart` asks the exit gate first; refusal returns `refused` and relaunches nothing (`page-service.test.ts`, `settings-handlers.test.ts`) |
| 22 | pending-real-validation | Second audit: kept as pending. A real relaunch ends the process Playwright drives, so it cannot be asserted from a test without a second app and a launcher outside the suite. Needs one manual restart. Failure is returned as `failed` with the message (B10). A real relaunch, and the new process getting the single-instance lock, were not exercised: doing it in a test would start a second real app. Needs one manual restart |
| 23 | done | Main applies the saved language before the first window (earlier) and the renderer now starts from it |
| 24 | done | Every formatter takes an explicit locale; nothing reads a machine culture |

### Locale resolution

| # | Status | Notes |
| --- | --- | --- |
| 25 | improved | `ui-language.test.ts`. B20: underscore tags work and a well-formed tag for no real language gives null on every platform |
| 26 | improved | Same file; B20 for `es_ES` |
| 27 | done | `resolveUiLanguage` falls back to `en-US` |

### Summary provider

| # | Status | Notes |
| --- | --- | --- |
| 28 | done | `ProviderMark.tsx`: Claude, Codex and Grok paths copied verbatim from the XAML, 16 px, `aria-hidden`. Local uses a lucide Cpu so the four labels align. Decision: Claude keeps `#D97757` as the one brand color on the page (gap 1 asks for it); Codex and Grok use the text color; forced colors turn all three into `CanvasText` |
| 29 | improved | B2. Only the four exact names; everything else is `Local` |
| 30 | done | `setSummaryProvider` of the current provider is `ignored` |
| 31 | done | A radio change calls `settings.setSummaryProvider` and then reads the page, so every control matches what is saved |
| 32 | done | Choosing Grok calls `settings.xai.refresh` after the save. A page that opens with Grok chosen and signed in refreshes once (`SettingsRoute.test.tsx`) |
| 33 | done | Keys used |
| 34 | done | The status line shows only when `cliStatus` is not null (Claude Code and Codex) |
| 35 | done | e2e: Claude Code `Detected on PATH.`, Codex `Not found on PATH` |
| 36 | done | `PathCliProbe` (`settings-adapters.test.ts`): PATHEXT, default `.EXE;.CMD;.BAT`, plain name elsewhere, blank entries skipped, directories do not count. Asynchronous |
| 37 | done | `cliExecutableName` throws `RangeError` for other kinds |
| 38 | done | `ProviderSection` draws the block of the chosen provider below the radios |

### Claude Code and Codex options

| # | Status | Notes |
| --- | --- | --- |
| 39 | done | `CLAUDE_MODELS`, default `sonnet` |
| 40 | done | `CLAUDE_EFFORTS`, default `low` |
| 41 | done | `CODEX_MODELS`, default `gpt-5.6` |
| 42 | done | `CODEX_EFFORTS`, default `low` |
| 43 | done | `setCliOption` ignores blank, unchanged and unknown values and saves one field. The loading flag is covered by the no-op on unchanged |
| 44 | improved | The saved outcome's `feedback` shows in a Notice under the provider section, closable, and a 4 s timer (`FEEDBACK_MS`) closes it. e2e sees `Saved. Using opus · low.`. The timer is tested with fake timers: the bar stays, a newer message restarts the single timer, and it closes 4 s after the last one (`SettingsRoute.test.tsx`; the test fails if `FEEDBACK_MS` changes) |
| 45 | improved | No expander: a small heading and its description sit above the rows, always open. Decision: the expanders were always expanded in WinUI, so the chevron had no use |
| 46 | done | Resolvers return the defaults for blank values (`settings.test.ts`, `page-service.test.ts`) |

### Local models

| # | Status | Notes |
| --- | --- | --- |
| 47 | done | `SUMMARY_MODELS`: names, URLs, sizes, RAM, keys, ascending order |
| 48 | done | Name, fit badge, `Model_SpeedQuality` with the size (`3.1 GB`, `3,1 GB` in Spanish seen in `settings-restart-prompt-es-light.png`) |
| 49 | improved | Fit badges are an outline with the word; no green, amber or red fill. Decision: stack.md allows color only for tokens, and the word already carries the meaning |
| 50 | done | The radio is disabled until the file exists; Delete shows for a downloaded model |
| 51 | done | Download is replaced by Cancel download while it runs |
| 52 | done | Same |
| 53 | improved | `LocalModelsService.download`: percent 0 to 100, flags cleared on every outcome, `cancel` added. The file is written as `.part` and moved into place only when complete |
| 54 | done | A failed download shows `Ui_ModelDownloadFailed` with the model name and the message (`SettingsRoute.test.tsx`); progress resets |
| 55 | done | Downloading does not select (tested) |
| 56 | done | Delete clears `selectedSummaryModelId` only for the active model. A file that cannot be removed returns `failed` and keeps the selection |
| 57 | done | `select` needs a catalog model whose file exists; reselecting is a no-op |
| 58 | improved | B17. Transfers live in the service, `rows()` reports `downloading` and `percent`, and a second download of the same file is refused |
| 59 | done | Keys used |
| 60 | improved | The AutomationIds do not exist in a web page. The radio, Download and Delete are reached by role and name (`settings-ui.spec.ts`) |

### Grok (xAI)

Audit fix: these rows were `done` because the double passes them, but a real build registers no `XaiAccountPort`, so the account block is not reachable there. The rows marked `pending-xai-module` are verified against `FakeXaiAccount` only. Decision: the Grok radio is drawn only when `capabilities.xaiAccount` is true, or when Grok is already the saved choice (so a saved value is never hidden). A real build therefore does not offer a control that does nothing. Second audit: the real build now registers `FileXaiAccount` (`packages/platform/src/settings/file-xai-account.ts`), so the radio, the account block, the API key box, the model and effort pickers and Sign out are reachable. The key is encrypted with Electron `safeStorage` into `xai-credentials.safe.bin` in the app data folder, a different name from the WinUI `xai-credentials.bin`, so a shared folder is never overwritten and the WinUI DPAPI file is not read (an old SuperGrok or key login must be done again). Models come from `https://api.x.ai/v1/models` with the C# text chat filter and preferred order; tests use a local fake, never the network or a real key. Decision, rejected part of the finding: the SuperGrok button stays hidden (`xaiSignIn` false) because the device code flow is the xAI sign in dialog of the summaries module (spec 2.8) and needs a real account to prove. The signed-out line that mentions SuperGrok is the spec text, kept. Rows 61, 62, 64, 67, 68, 69, 71 to 74 are now reachable in a real build and `done` for API key accounts; 75 and OAuth accounts stay `pending-xai-module`. The xAI card now shows a busy bar (`Progress`, indeterminate, `aria-busy`) while a refresh, save, sign in or sign out runs.

| # | Status | Notes |
| --- | --- | --- |
| 61 | done | `XaiAccount.tsx`: status row with title, detail, a check when signed in, Sign in or Sign out. Sign in only when `capabilities.xaiSignIn` |
| 62 | done | Title and detail kinds for OAuth, ApiKey, none; loading-models only until models are loaded for these credentials (`settings-services.test.ts`) |
| 63 | done | `status()` reads only the local store and seeds the saved model |
| 64 | done | `refresh()`: token, models, `resolveXaiModelId`, `mergeModelList`, persist when it differs, ready detail |
| 65 | done | All five spec rows, saved casing, preferred order, listed casing, empty list |
| 66 | done | Removes absent, inserts at index, keeps the resolved id, does not reorder |
| 67 | done | B14. Title `error`, raw message in the detail, `signedIn` stays true (the credentials are there), models kept, `canRetry` true |
| 68 | done | A signed-out refresh clears the list |
| 69 | done | Model and effort Selects are disabled while signed out (e2e) |
| 70 | done | `none, low, medium, high, xhigh`, default `low` |
| 71 | done | `setCliOption` for xAI; `status()` rebuilds the ready detail from the saved values |
| 72 | done | Password input with a Show key and Hide key button (peek) and Save, disabled while blank (e2e) |
| 73 | done | Save clears the box on success, refreshes the models and shows `Xai_FeedbackApiKey`. The key never reaches `settings.json` (e2e asserts it) |
| 74 | done | `signOut` returns `Xai_FeedbackSignedOut` and a refreshed signed-out view |
| 75 | pending-xai-module | `settings.xai.signIn` is wired and tested with a double. The device code flow and a real account belong to the xAI module |
| 76 | done | The same Notice serves Claude, Codex and Grok |
| 77 | done | Key used |

### Meeting and summary language

| # | Status | Notes |
| --- | --- | --- |
| 78 | done | `TRANSCRIPTION_LANGUAGES` |
| 79 | done | `SUMMARY_LANGUAGES` |
| 80 | done | Defaults `es` and `es` |
| 81 | improved | B6. `getPage` returns the code the engine uses, so the picker cannot disagree |
| 82 | done | `setMeetingLanguage` ignores the current code and saves only its own field |
| 83 | done | The resolvers read the freshly loaded settings, with no cache |
| 84 | done | `engineLocaleFor` table, trim, lowercase, blank and unknown give `auto` |
| 85 | done | Description shown with the picker. The English headings invariant stays with the summaries module |
| 86 | improved | B9. The catalog holds keys, not text |

### Note templates

| # | Status | Notes |
| --- | --- | --- |
| 87 | done | `noteTemplateOptions(custom)`. The custom template store belongs to summaries; it passes its record in |
| 88 | done | Built-in ids and `custom` |
| 89 | done | Four prompts verbatim; null for auto, custom, blank, unknown; id trimmed |
| 90 | done | `normalizeTemplateId` |

### Settings persistence

| # | Status | Notes |
| --- | --- | --- |
| 91 | done | Library-storage: `settings.ts` and `json-settings-store.ts` |
| 92 | done | Same |
| 93 | done | Same |
| 94 | done | Same |
| 95 | done | Same |
| 96 | done | Same |
| 97 | done | Same |
| 98 | done | Every command is a patch applied to the fresh file; a fresh blob is never built. Tested with unknown keys and other fields present |
| 99 | improved | B1. One locked read-modify-write; three parallel commands from different sections all land (`settings-services.test.ts`, `settings-runtime.test.ts`) |
| 100 | improved | Atomic temp-and-rename (library-storage) |
| 101 | improved | B4. The damaged file is set aside, defaults are used, and `getPage.notices` carries `settings-recovered` with where it was kept until dismissed. `Ui_SettingsRecovered` shows it; e2e observed this in the real app |
| 102 | done | Tested: a saved xAI key never reaches `settings.json` |
| 103 | improved | B2 |
| 104 | improved | B13. Option lists include the stored value |

### Strings and i18n data

| # | Status | Notes |
| --- | --- | --- |
| 105 | done | The JSON catalogs keep the source order (app strings, then the core ones not already present) since the third audit; the converter no longer sorts and a test checks the order. Test compares every key and text of both `.resw` files and both `.resx` files with the JSON catalogs (604 and 43, merged) |
| 106 | done | Same key sets, placeholder index sets, no empty values, per file and merged |
| 107 | done | 271 plain, 333 dotted, 244 uids, counted from the sources |
| 108 | done | 62 values with placeholders; positional rendering tested |
| 109 | done | The four specifier keys render in both locales |
| 110 | done | `MeetingTitleDateFormat` through `formatCustomDate` and `meetingTitle` |
| 111 | done | Newline kept |
| 112 | done | Middle dot, ellipsis, em dash kept |
| 113 | done | 43 keys, same checks |
| 114 | improved | B8. Selected locale, then English, then the key; each miss is reported (`MissingKeyReport`). The renderer logs a miss once to the main log |
| 115 | done | `LocaleState` and `createLookup` take the locale; nothing is global |
| 116 | improved | B9. Names are keys resolved at use |
| 117 | done | B16. `Ui_MicLevelName`, `Ui_EngineDownloadProgressName`, `Ui_SpeakerDownloadProgressName` in both languages. The bars are named by `Settings_MicLevel.Text` and the `Status_*` labels; the three `Ui_` keys exist for the owning modules and are not rendered by Settings |
| 118 | improved | B21. A test fails if the code asks for a key that does not exist, and if a hand-written `Ui_` key is unused. "Every key is referenced" cannot hold until all modules are ported, so the second audit added the assertion for the groups Settings uses (`Settings_*`, `SettingsPage_*`, `SettingsLanguageRestart_*`, `Xai_*`, `Hardware_*`, `Fit_*`, `Model_*`). Keys of the hardware, microphone, engine, recording, calendar and TypeSafe sections, the setup dialog (`Hardware_*`, `Model_Downloaded`) and the recording caption (`Xai_ProviderName`) are an explicit list for their modules. `Xai_StatusError` and `Settings_XaiStatus.Header` are listed as unused by decision (7.23), and a second test fails if a listed key becomes used, so the list cannot go stale |

### Tests

| # | Status | Notes |
| --- | --- | --- |
| 119 | done | `ui-language.test.ts` carries all nine `UiLanguageResolverTests` cases with the same inputs and outputs |
| 120 | done | Defaults, round trips, clamps, legacy keys: `settings.test.ts` (library-storage) plus the language cases here |
| 121 | done | `format.test.ts` and `i18n-catalog-checks.test.ts` (`Sample_Greeting`) |
| 122 | done | Catalog, ordering, `RateFor` (four cases and the boundaries), note templates, `ResolveModelId` (five rows) |
| 123 | done | Concurrency and atomicity, strict provider, picker and engine agreement, merge, resw parity, specifier rendering, fit boundaries, `0.#` sizes. Section commit suppression is covered by the no-op rule |

### Cross-module interfaces

| # | Status | Notes |
| --- | --- | --- |
| 124 | partial | TypeSafe, Recording and Calendar are `slot` entries that draw nothing until their modules land; Microphone, Transcription, Data and About are mounted. The page draws the blocks marked `built` in order and nothing for a `slot`; a module adds its block to `SettingsRoute` at the position `SETTINGS_SECTIONS` gives it |
| 125 | done | `SettingsRuntime.exitGates.register(gate)`; `RestartService` asks it. The recording module registers its gate |
| 126 | done | `HardwareProbe`, `LocalModelStore`, `XaiAccountPort`, `CliPathProbe` in `settings/ports.ts`, with adapters and doubles. `noteTemplateOptions` takes a plain `{name}` value and nothing in production calls it yet: the note template store port belongs to the notes module, which will pass its store here |

## Bugs fixed (section 7)

Each has a regression test; the test name starts with the bug id where the test is about it.

| Bug | Fix | Test |
| --- | --- | --- |
| 7.1 | Patch updates under one lock; sections cannot overwrite each other | `settings-services.test.ts` (B1), `settings-runtime.test.ts` (B1) |
| 7.2 | Exact provider names only | `settings-services.test.ts` (B2), `settings.test.ts` (B18 of library-storage) |
| 7.3 | Atomic write (library-storage) | `atomic-write.test.ts` |
| 7.4 | Damaged file kept, defaults, notice | `settings-adapters.test.ts` (item 101), `settings-runtime.test.ts` (B4), `settings-i18n.spec.ts` |
| 7.5 | Download errors, cancel, percent, delete errors returned as values | `settings-services.test.ts` (B5), `settings-adapters.test.ts` (B5), `settings-handlers.test.ts` (B5) |
| 7.6 | One rule for the picker and the engine | `catalogs.test.ts` (B6) |
| 7.7 | Active only while the file exists; missing id reported | `settings-services.test.ts` (B7) |
| 7.8 | Fallback chain with a report; never empty | `format.test.ts` (B8), `translate.test.ts` (B8) |
| 7.9 | Catalogs hold keys | `i18n-catalog-checks.test.ts` (B9) |
| 7.10 | Restart failure returned | `page-service.test.ts` (B10), `settings-handlers.test.ts`, `single-instance.test.ts` (B10) |
| 7.11 | Save first, then switch; failed save switches nothing | `settings-handlers.test.ts` (B11) |
| 7.12 | Commands and xAI actions return failures as values | `settings-services.test.ts` (B12 and failures) |
| 7.13 | Option lists include the stored value; stored value is the current one | `catalogs.test.ts` (B13), `settings-services.test.ts` (B13), `page-service.test.ts` (B13) |
| 7.14 | Error view stays signed in, keeps models, offers retry | `settings-services.test.ts` (B14), `settings-handlers.test.ts` (B14) |
| 7.15 | Asynchronous probe that reads PATH every time; `settings.detectCli` | `settings-adapters.test.ts` (B15), `page-service.test.ts` (B15) |
| 7.16 | Localized names for the three progress bars | `i18n-catalog-checks.test.ts` (B16) |
| 7.17 | Transfers kept in the service; second download refused | `settings-services.test.ts` (B17) |
| 7.18 | A failed read is an error, not defaults | `page-service.test.ts` (B18) |
| 7.20 | Underscore tags; unknown tags are null everywhere | `ui-language.test.ts` (B20) |
| 7.21 | Reference check | `i18n-catalog-checks.test.ts` (B21) |

Decided, not a code change: 7.19 (see Decisions). Not changed on purpose: 7.22 (tokens are CLI arguments), 7.24 (legacy fields kept). 7.23 `Xai_StatusError` is still unused; the page uses `Xai_StatusErrorTitle` plus the raw message.

## Left for other modules

**UI half of this module (done)**
- The blocks marked `built` are drawn in `SETTINGS_SECTIONS` order. Slots draw nothing until their module adds its block to `SettingsRoute`.
- The renderer language starts from `i18n.getLocale`, follows `i18n.localeChanged`, and `app.restart` runs from the prompt; a failed restart shows `Ui_RestartFailed`, a refused one changes nothing.
- Notices, a failed read with Try again, model failures, `Ui_ModelMissing`, the Cancel download button, delete busy, the xAI controls behind `capabilities`, Check again, and the brand marks are all in.
- Decision: Delete asks no confirmation, as in the WinUI page. The file can be downloaded again, and the choice returns to none, which the page says.
- Data root note: choosing a folder is unchanged from library-storage. A production build with no `VOZELLA_DATA_ROOT` accepts any folder, including an existing MeetingLive one, and the Data block shows `Ui_LibraryFolderShared` when it does; dev, test and the env override refuse it. No run here touched a MeetingLive folder.

Audit, rejected: the Claude mark keeps `#D97757`. _gaps.md section 1 asks for it explicitly, and it is the one documented brand color on the page.

**xAI module**: implement `XaiAccountPort` (credential store with `safeStorage`, token refresh, model list, API key replacing OAuth credentials), pass it as `xaiAccount` to `SettingsRuntime`, and pass `xaiSignIn` to `registerSettingsHandlers`.

**Recording module**: register an exit gate with `settings.exitGates.register` so a restart or quit does not drop an active recording.

**TypeSafe module**: the corrected description string (see Decisions).

**Audio, transcription, calendar modules**: mount their sections in the slots; use the three `Ui_` accessible names.

**Summaries module**: read the language and provider fields with the resolvers (`resolveSummaryLanguage`, `resolveTranscriptionLanguage`, `resolveSummaryProviderKind`); keep summary headings in English; use `instructionsFor`, `normalizeTemplateId` and `noteTemplateOptions`; reuse `downloadToFile` for other model downloads.

**Not verified**
- A real relaunch from the language prompt, including the new process taking the single-instance lock (22).
- A real download from Hugging Face. Tests use a local HTTP server and the fake store; the 3 GB files were not fetched.
- A real xAI account, token refresh and device code sign in (75).
- Real `claude` and `codex` on PATH. The probe is tested with temporary folders and a fake PATH, not with the user's installs.
- The GPU registry value on other machines (Intel only, AMD, no GPU). The parser handles numbers, byte arrays and missing values in tests.
- Chromium's own UI language (native context menus, spell check) still follows the OS; the app draws its own menus.
- Spanish rendering was seen in a screenshot, not read by a Spanish speaker.
- An in-flight download in the real window: the fake store finishes at once, so the progress bar and Cancel are covered by a component test with a held request and an injected event, not by a screenshot.
- Forced-colors rendering of the page, screen readers, and a high-DPI window. axe reports no serious or critical issue in both themes; the Claude mark colour and the radio rows in forced colors were not looked at.
- A real relaunch from the prompt (22), a real Hugging Face download, a real xAI account and real CLIs on PATH, as before.

## Audit round 3

Fixed, each with a test:

- Overlapping `settings.getPage` answers: a sequence guard lets only the newest apply (7.17). Revisits keep the last snapshot and refresh without the skeleton (8.4, row 4 is now `done`, no longer `improved`).
- The skeleton label was dropped by `SkeletonText`; it now takes `label` (role status). Tests cover the first-visit skeleton (8.3), table order and title (8.1, 8.2), leaving before the first answer (8.7), no writes on open (8.8, 8.11), the 150 ms reveal and the reduced motion rule (8.5).
- Data and About now render inside the revealed content, in `SETTINGS_SECTIONS` order.
- Leaving the page stops the mic preview and the engine subscription, now asserted (8.12).
- A refused restart now shows `Ui_RestartRefused`; the thrown path is tested. The relaunch closure moved to `relaunchApp` with a unit test. Still not observed: a real relaunched process taking the lock (row 22 stays `pending-real-validation`, it would end the Playwright process).
- Claude Code and Codex option blocks carry their brand mark again (row 45).
- `XaiAccountService`: a refresh that began before a key change or sign out cannot publish its models (generation counter), tested.
- Tests added for choosing Grok refreshing the account (32), a remounted page with a download in flight (58), catalog URLs, sizes and keys (47), OAuth replaced by a saved key (73), duplicates and round trips for calendar ids and the pill dock, legacy provider keys, the nav clamp boundaries, `Ui_` key parity, and the missing string report once per key.

Decisions:

- SuperGrok sign in (75, OAuth half of 61, 62, 74): stays `pending-xai-module`. It needs the device code flow against a real account, which is out of scope here. The false copy is fixed: without the sign in the Grok card says `Paste an API key below.` and the section text names only the key (new keys `Ui_XaiSignedOutApiKeyOnly`, `Ui_XaiAccountApiKeyOnly`, en and es). The reused summary card text still mentions SuperGrok.
- 117: the three dedicated progress bar keys are not used; the bars use equivalent localized keys (`Settings_MicLevel.Text`, `Status_*`). Rejected as a defect, the dedicated keys are kept for the owning modules.
- 59: no progress ring in the Local models block; page loading is the skeleton. Decision: quiet document tool.
- 118, 106, 112: the cross-check stays a vitest test; `Ui_` parity is now asserted. Counting keys beyond the sources is rejected: the merged 647 file is intended.
- Bug 1 narrow read then write windows in `refresh` self heal and `LocalModelsService.select/delete`: recorded, not changed. The store has no mutator form; a fix needs a store API change.
- Spec 7.1 B1 core test uses an unlocked store; the locking proof is `settings-runtime.test.ts`. Unchanged.
- Bug 19 replacement key, item 101 notice placement, 87 to 90 and 126 callers, 125 gates: owned by later modules, as already recorded.
- MeetingLanguageSection renderer test, item 83 language change between starts: covered indirectly, not added.

Third audit:

- Fixed: a load that fails on a revisit or right after a command now draws the load error with Try again over the kept snapshot (8.10). A data folder change (`library.changed` with reason `location`) drops the kept snapshot and reads again behind the skeleton (8.4). The fade now runs only on the first reveal (8.5). A refresh that lost to a newer one no longer writes its model id over the new account's choice (xai-account self heal). `convert-strings.mjs` keeps source order (105).
- Tests added: parallel start of the settings and hardware reads (8.6); provider radio order, labels in both languages and marks (28); Spanish detection text and Check again (35); block visibility per provider (38); Claude and Codex block mark and description (45); SuperGrok sign in and failure in the renderer (75, 61); Grok model placeholder (77); disabled effort and model when signed out and the Close button on the saved bar (69, 76); legacy pill X/Y round trip (96, bug 24); stale refresh keeps the saved model id (B12).
- Row 22 stays `pending-real-validation`: a real relaunch has not been observed. Driving it needs a launcher outside the Playwright process in an unattended run; not attempted.
- Rejected: all four models carrying `Recommended` is the hardware fit rating, true on a 16 GB machine and informative on a smaller one. The `API key saved.` bar is the transient confirmation the C# page shows after saving and closes itself after 4 s. The em dash in the English `Settings_SummaryModels.Description` and `Status_CliMissing` comes from the C# resource strings reused as is; changing them would break the converter parity check. `Ui_` names for 114 (log level `error` for a missing key) differ from the spec wording only in severity; no behavior depends on it. Unlocalized refresh error text is what spec 2.5 asks for. The generic `settings.update` channel accepting any value stays as recorded (reads are strict). Bug 13 stays as recorded: an out of list value shows and is passed on as saved.
- 75 stays `pending-xai-module`: the shipped build has no SuperGrok sign in; the renderer path is now tested with a double.

## Audit round 4 decisions

Fixed with tests: item 36 (PATHEXT is split on `;` with no filter, so an empty or trailing-`;` value also tries the plain name, as C# does); item 13 (option order, tags and identical labels in both locales asserted; stale doc comment fixed); item 46 (blank and whitespace values for model, effort and provider); item 31 (the provider radio moves at once and snaps back if the save is refused); items 28/33/38 (card description text and the Grok block below the radios asserted).

Rejected or deferred, with reason:
- Item 22 relaunch and exit gates: a real second process cannot be observed in an unattended run; stays pending-real-validation. No production module registers an exit gate yet (recording owns that).
- Item 75 and the OAuth halves of 61/62/64: SuperGrok device-code sign in and token refresh belong to the xai module; the button stays hidden by decision (row 60).
- Bug 19 TypeSafe copy, item 124 slots, item 126 note-template port: owned by the jev-typesafe, recording, calendar-detection and notes modules.
- Item 117 progress-bar names and item 118 key cross-check breadth: the Ui_*Name keys are consumed by the owning modules; the speaker bar is not drawn here. Left as recorded.
- Row 12 is stale only in wording; behavior is asserted.
- Design notes (gap-8 spacing, em dash in a reused key, Ui_SettingsSaveFailed wording on refresh failure): follow the document-column direction; reused keys are not new copy.
