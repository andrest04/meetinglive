# Parity ledger: settings-i18n (domain and integration half)

Spec: `docs/port/specs/settings-i18n.md`. Section 8 has 126 items; every one is below. The Settings page itself (screens, dialogs, animation) is the UI half and is not built yet.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`, and `open-ui` (the logic, data and strings exist; the screen that shows it is the UI half). A note after `open-ui` says what is already there.

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
| Real-window checks | `apps/desktop/e2e/settings-i18n.spec.ts` |

## Decisions

- **No new Rust.** Nothing in this module needs the OS beyond what Node has. RAM comes from `os`. The GPU comes from one PowerShell query (`powershell.exe`, no shell string from user input), run once per process and cached. `packages/platform/src/settings/system-hardware-probe.ts` reads the 64-bit registry value `HardwareInformation.qwMemorySize` first and falls back to WMI `AdapterRAM`. Observed on this machine through the real probe: 31.6 GB RAM, RTX 3070 Laptop GPU, 8 GB (the WMI field alone says 4 GB), 3.4 s the first time. It runs off the page's critical path.
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
| 1 | open-ui | `SETTINGS_SECTIONS` gives the blocks, their order and owners. Column width, padding and spacing are layout |
| 2 | done | `SettingsPage_Title.Text`, used by the existing route |
| 3 | open-ui | Ring and hidden content before the first reveal. `settings.getPage` is the local phase |
| 4 | open-ui | Later visits call `settings.getPage` again; it is read-only and cheap |
| 5 | open-ui | CSS fade with `prefers-reduced-motion` |
| 6 | done | `SettingsPageService.load` reads settings and hardware together (`Promise.all`). The ring painting first is UI |
| 7 | open-ui | `load` writes nothing and starts nothing, so a load the page abandons has no effect. The page ignores the late answer. The microphone meter belongs to its module |
| 8 | open-ui | One snapshot object carries every section's data, so order of apply is a rendering choice |
| 9 | done | The network phase is its own request (`settings.xai.refresh`), single flight, and a failure is a value in the view, never a rejection. Calendar loading belongs to its module |
| 10 | improved | B18. A failed read rejects with the message; the UI shows `Ui_SettingsLoadFailed` and clears the ring in `finally` |
| 11 | improved | The commands ignore a value equal to the current one, so an echo from a programmatic load cannot save anything or show feedback. No suppression flag is needed on the domain side |
| 12 | open-ui | Microphone meter and ASR backend observation belong to the audio and transcription modules |

### App UI language

| # | Status | Notes |
| --- | --- | --- |
| 13 | open-ui | `UI_LANGUAGE_OPTIONS`: `en-US`, `es`, endonym keys `Settings_LanguageEnglish`, `Settings_LanguageSpanish` that read the same in both languages |
| 14 | open-ui | Keys exist and are checked in both locales |
| 15 | open-ui | `i18n.getLocale` and `settings.getPage.uiLanguage` give the answer. The renderer provider still reads `localStorage` and `navigator.languages`; it must take the first paint from `i18n.getLocale` |
| 16 | done | `getPage.uiLanguage` is the saved tag or the OS match by primary subtag; nothing is saved on load (tested) |
| 17 | done | `setUiLanguage` of the shown language returns `ignored: unchanged` |
| 18 | open-ui | Main saves, then switches its own locale and pushes `i18n.localeChanged`. The renderer must listen and switch |
| 19 | open-ui | Four `SettingsLanguageRestart_*` keys exist. Default button Restart now |
| 20 | open-ui | Nothing to do on the domain side |
| 21 | done | `app.restart` asks the exit gate first; refusal returns `refused` and relaunches nothing (`page-service.test.ts`, `settings-handlers.test.ts`) |
| 22 | pending-real-validation | Failure is returned as `failed` with the message (B10). A real relaunch, and the new process getting the single-instance lock, were not exercised: doing it in a test would start a second real app. Needs one manual restart |
| 23 | open-ui | Main applies the saved or OS language before the first window (`resolveStartupLanguage`; read failure and blank leave the OS language; e2e observed the saved `es`). The renderer locale still has to start from it |
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
| 28 | open-ui | Provider names and label keys exist. Brand icons are gap 1 in `_gaps.md` and belong to the UI half |
| 29 | improved | B2. Only the four exact names; everything else is `Local` |
| 30 | done | `setSummaryProvider` of the current provider is `ignored` |
| 31 | open-ui | Saves the exact name. The immediate UI update is the page's |
| 32 | open-ui | The page calls `settings.xai.refresh` after selecting xAI |
| 33 | open-ui | Keys exist |
| 34 | open-ui | `getPage.cliStatus` is set only for Claude Code and Codex |
| 35 | open-ui | `CLI_STATUS_KEYS`; both strings exist in both locales |
| 36 | done | `PathCliProbe` (`settings-adapters.test.ts`): PATHEXT, default `.EXE;.CMD;.BAT`, plain name elsewhere, blank entries skipped, directories do not count. Asynchronous |
| 37 | done | `cliExecutableName` throws `RangeError` for other kinds |
| 38 | open-ui | The page shows blocks by `provider` |

### Claude Code and Codex options

| # | Status | Notes |
| --- | --- | --- |
| 39 | done | `CLAUDE_MODELS`, default `sonnet` |
| 40 | done | `CLAUDE_EFFORTS`, default `low` |
| 41 | done | `CODEX_MODELS`, default `gpt-5.6` |
| 42 | done | `CODEX_EFFORTS`, default `low` |
| 43 | done | `setCliOption` ignores blank, unchanged and unknown values and saves one field. The loading flag is covered by the no-op on unchanged |
| 44 | open-ui | The saved outcome carries `feedback: Xai_FeedbackModel` with `<model> · <effort>`; the bar and its 4 s timer are UI |
| 45 | open-ui | Expanders, headers, descriptions and icons |
| 46 | done | Resolvers return the defaults for blank values (`settings.test.ts`, `page-service.test.ts`) |

### Local models

| # | Status | Notes |
| --- | --- | --- |
| 47 | done | `SUMMARY_MODELS`: names, URLs, sizes, RAM, keys, ascending order |
| 48 | open-ui | Rows carry display name, speed, quality and use-case keys, `fileSizeGb`, `fit`; `formatModelSize` gives `0.8`, `3.1`, `5`, `7.1` (`7,1` in Spanish) |
| 49 | open-ui | `rateFor` and its boundaries are tested. Badge colors are UI |
| 50 | open-ui | `downloaded` is in the row |
| 51 | open-ui | `downloaded` and `downloading` are in the row |
| 52 | open-ui | Same |
| 53 | improved | `LocalModelsService.download`: percent 0 to 100, flags cleared on every outcome, `cancel` added. The file is written as `.part` and moved into place only when complete |
| 54 | open-ui | B5. The failure is a value and a `failed` event with the message; progress is reset. `Ui_ModelDownloadFailed` shows it |
| 55 | done | Downloading does not select (tested) |
| 56 | done | Delete clears `selectedSummaryModelId` only for the active model. A file that cannot be removed returns `failed` and keeps the selection |
| 57 | done | `select` needs a catalog model whose file exists; reselecting is a no-op |
| 58 | improved | B17. Transfers live in the service, `rows()` reports `downloading` and `percent`, and a second download of the same file is refused |
| 59 | open-ui | Keys exist |
| 60 | open-ui | The ids `RadioSelectModel_<file>`, `BtnDownloadModel_<file>`, `BtnDeleteModel_<file>` are for the UI half to keep |

### Grok (xAI)

| # | Status | Notes |
| --- | --- | --- |
| 61 | open-ui | `XaiAccountView` has the title, detail, signed-in flag; the buttons follow `signedIn` and `capabilities.xaiSignIn` |
| 62 | done | Title and detail kinds for OAuth, ApiKey, none; loading-models only until models are loaded for these credentials (`settings-services.test.ts`) |
| 63 | done | `status()` reads only the local store and seeds the saved model |
| 64 | done | `refresh()`: token, models, `resolveXaiModelId`, `mergeModelList`, persist when it differs, ready detail |
| 65 | done | All five spec rows, saved casing, preferred order, listed casing, empty list |
| 66 | done | Removes absent, inserts at index, keeps the resolved id, does not reorder |
| 67 | improved | B14. Title `error`, raw message in the detail, `signedIn` stays true (the credentials are there), models kept, `canRetry` true |
| 68 | done | A signed-out refresh clears the list |
| 69 | open-ui | Disable the combos when `signedIn` is false |
| 70 | done | `none, low, medium, high, xhigh`, default `low` |
| 71 | done | `setCliOption` for xAI; `status()` rebuilds the ready detail from the saved values |
| 72 | open-ui | Masked input with peek and the Save enable rule |
| 73 | open-ui | `saveApiKey` trims, hands it to the port, refreshes, returns `Xai_FeedbackApiKey`. Clearing the box is UI. Storing the key replaces OAuth credentials: the port's job |
| 74 | done | `signOut` returns `Xai_FeedbackSignedOut` and a refreshed signed-out view |
| 75 | pending-real-validation | `settings.xai.signIn` is wired and tested with a double. The device code flow and a real account belong to the xAI module |
| 76 | open-ui | Bar, close, 4 s timer. The three providers produce `feedback` |
| 77 | open-ui | Key exists |

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
| 85 | open-ui | Description key exists. The English headings invariant belongs to the summaries module |
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
| 105 | done | Test compares every key and text of both `.resw` files and both `.resx` files with the JSON catalogs (604 and 43, merged) |
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
| 117 | done | B16. `Ui_MicLevelName`, `Ui_EngineDownloadProgressName`, `Ui_SpeakerDownloadProgressName` in both languages. The modules that own those bars use them |
| 118 | improved | B21. A test fails if the code asks for a key that does not exist, and if a hand-written `Ui_` key is unused. "Every key is referenced" cannot hold until all modules are ported, so it is not asserted for the converted keys |

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
| 124 | open-ui | `SETTINGS_SECTIONS` names each slot and owner; other modules write through `settings.update` (one lock). Mounting is UI |
| 125 | done | `SettingsRuntime.exitGates.register(gate)`; `RestartService` asks it. The recording module registers its gate |
| 126 | done | `HardwareProbe`, `LocalModelStore`, `XaiAccountPort`, `CliPathProbe` in `settings/ports.ts`, with adapters and doubles. The note template store is passed to `noteTemplateOptions` |

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

**UI half of this module**
- Build the Settings blocks listed as `built` in `SETTINGS_SECTIONS` and mount slots for the others. Every `open-ui` row above says what to call.
- Start the renderer language from `i18n.getLocale`, listen to `i18n.localeChanged`, and call `app.restart` from the prompt; show a failed restart with `Ui_RestartFailed`. The provider today reads `localStorage` and `navigator.languages`.
- Show `getPage.notices` (recovered settings), a `getPage` rejection (`Ui_SettingsLoadFailed`), model failures and `Ui_ModelMissing` when `missingActiveId` is set.
- Subscribe to `settings.modelEvent` for download progress. Offer Cancel (`settings.models.cancel`) and decide whether delete needs a confirmation (the WinUI page had none).
- Offer the xAI controls only when `capabilities.xaiAccount` is true, and the sign in button only when `capabilities.xaiSignIn` is true.
- Call `settings.detectCli` for a Check again control (`Ui_CliCheckAgain`).
- Brand icons (gap 1 in `_gaps.md`).

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
- Spanish rendering of the page (no UI yet).
