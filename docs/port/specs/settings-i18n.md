# Module spec: settings-i18n

Scope: the Settings page shell and its sections owned by this module (app UI language, summary provider, local summary models, meeting and summary language), the persisted settings blob (`AppSettings` + `AppSettingsService`), UI-language resolution (`UiLanguageResolver`), and the two string systems (`AppStrings` over `Resources.resw`, `CoreStrings` over `CoreStrings.resx`). Settings sections owned by other modules (TypeSafe, Microphone, Transcription engine, Calendar, Data folder) appear here only as layout slots and as the AppSettings fields they read and write.

Sources read in full: `MeetingLive.App/SettingsPage.xaml`, `SettingsPage.xaml.cs`, `AppStrings.cs`, `Strings/en-us/Resources.resw`, `Strings/es/Resources.resw`, `ViewModels/{SettingsPageViewModel, SettingsSectionViewModelBase, LanguageSectionViewModel, UiLanguageOption, UiLanguageSectionViewModel, LocalModelSectionViewModel, ModelOption, NoteTemplateOption, SummaryProviderSectionViewModel}.cs`, `MeetingLive.Core/Services/UiLanguageResolver.cs`, `Strings/CoreStrings.cs`, `Strings/CoreStrings.resx`, `Strings/CoreStrings.es.resx`. Followed into: `Models/AppSettings.cs`, `Services/AppSettingsService.cs`, `Models/SummaryProviderKind.cs`, `Models/TranscriptionLanguageOption.cs`, `Models/InferenceCatalog.cs`, `Models/SummaryModelInfo.cs`, `Models/HardwareProfile.cs`, `Services/ModelCatalog.cs`, `Services/NoteTemplateCatalog.cs`, `Services/NemotronLanguageMapper.cs`, `Services/XaiApiClient.cs` (ResolveModelId), `Services/XaiAuthSession.cs`, `Services/CliProcessRunner.cs`, `App/Services/CliProviderResolver.cs`, `App/App.xaml.cs` (startup language, exit gate).

---

## 1) Purpose

Settings is the single page for app configuration. This module covers:

1. Choosing the language of the app's own screens (English or Spanish), independent of the meeting and summary content languages.
2. Choosing where summaries are generated: Local (GGUF in process), Claude Code CLI, Codex CLI, or Grok (xAI HTTP), plus per-provider model and reasoning-effort settings, xAI sign-in/sign-out/API key, and download/delete/select of local GGUF models.
3. Choosing the meeting (transcription) language and the summary language.
4. Persisting all of this, and every other app preference, in one JSON blob (`settings.json`), loaded and saved through one service.
5. Localization infrastructure: two resource sets (604 UI strings in `Resources.resw`, 43 core strings in `CoreStrings.resx`), each in English and Spanish, and the logic that resolves which language is active.

---

## 2) User-facing features

### 2.0 Page shell and load sequence

Layout (top to bottom inside a vertical scroll, content column `MaxWidth` 720, padding 24, spacing 24; horizontal scrollbar disabled):

| # | Block | Owner module | Heading key | Cards |
|---|---|---|---|---|
| 0 | Title | this | `SettingsPage_Title.Text` | n/a (TitleTextBlockStyle) |
| 1 | App language | this | `Settings_Language.Text` | `Settings_LanguagePicker` |
| 2 | Summary provider | this | `Settings_SummaryProvider.Text` | `Settings_SummaryProviderCard`, `Settings_ClaudeOptions`, `Settings_CodexOptions`, `Settings_SummaryModels`, `Settings_XaiAccount`, success InfoBar |
| 3 | TypeSafe (Jev) | other | `Settings_TypeSafe.Text` (with TypeSafe icon) | `Settings_TypeSafeEnabled`, status card, `Settings_TypeSafeApiKey`, InfoBar |
| 4 | Microphone | other | `Settings_Microphone.Text` | `Settings_RecordingDevice`, level meter (`Settings_MicLevel.Text`) |
| 5 | Meeting language | this | `Settings_MeetingLanguage.Text` | `Settings_TranscriptionLanguage`, `Settings_SummaryLanguage` |
| 6 | Transcription engine | other | `Settings_Transcription.Text` | `Settings_NemotronCard`, download progress, acceleration caption, ASR fallback InfoBar, live-drops caption and InfoBar, `Settings_SpeakerLabels`, speaker download progress |
| 7 | Recording | other | `Settings_Recording.Text` | `Settings_LiveTranscription` |
| 8 | Calendar | other | `Settings_Calendar.Text` | `Settings_CalendarNotifications`, `Settings_MeetingPopup`, `Settings_Calendars` expander (per-calendar toggles, hidden when no calendars), status text |
| 9 | Data | other | `Settings_Data.Text` | `Settings_MeetingsLocation` (description = meetings folder path, button `Settings_OpenFolder.Content`), `Settings_AppDataLocation` (description = app data path, no action icon) |
| 10 | About | other | n/a | `Settings_About` (header "Vozella", description = app version, no action icon) |

The page is navigation-cached (`NavigationCacheMode=Required`): one instance and one view model live for the app session.

Load behavior (`SettingsPageViewModel.LoadAsync`, started from `OnNavigatedTo`, fire-and-forget):

1. `_isPageVisible = true`; `IsInitialLoading = !_hasRevealed` (true only before the first successful reveal); `IsLoading = true`; microphone `BeginLoad()`.
2. `await Task.Yield()` so the progress ring paints before disk/WMI/WASAPI work.
3. Start `Settings.LoadAsync()`; in parallel run `CollectLoadSnapshot` on a worker thread: detect hardware, for every catalog model compute `(info, RateFor(hardware), IsModelDownloaded)`, transcription-engine readiness, diarization model presence, expected ASR backend, list of microphones.
4. If the page was left meanwhile (`_isPageVisible` false) abort without applying anything.
5. Local phase, applied in one synchronous run in this order: UiLanguage, LocalModel, SummaryProvider, TypeSafe, Language, TranscriptionEngine (+ start observing backend), Microphone devices, Calendar settings.
6. Reveal: `_hasRevealed = true`, `IsInitialLoading = false`, `IsLoading = false`, microphone `EndLoad()`. Content is laid out but at opacity 0 and not hit-testable until reveal (so bindings are realized and defaults never paint); a 32x32 progress ring (`ProgressSettingsLoading`) shows meanwhile. On reveal content fades in over 150 ms unless the OS has animations disabled (then no transition).
7. After reveal, at low dispatcher priority, restart the microphone level meter only if the page is still visible.
8. Network phase (single-flight via `_isNetworkLoadRunning`): `Task.WhenAll(SummaryProvider.LoadXaiAccountAsync(), Calendar.LoadAsync(settings))`; any exception is swallowed.
9. `finally`: if the local phase never completed, clear `IsLoading` and end microphone load; always set `IsInitialLoading = false` (never leave the page behind the ring, even when `settings.json` could not be read).
10. `IsLoading` changes are mirrored into SummaryProvider and Microphone (`SetLoading`) so that combo `SelectionChanged` events raised by the programmatic load are ignored.

On navigate away (`OnNavigatedFrom`): `StopLevelMeter()` sets `_isPageVisible=false`, stops observing the ASR backend, and stops the microphone meter.

### 2.1 App UI language

- Control: ComboBox (`ComboUiLanguage`, min width 200, display member `DisplayName`) inside card `Settings_LanguagePicker` (icon glyph U+E775). Header `Settings_LanguagePicker.Header` ("App language" / "Idioma de la aplicación"); description `Settings_LanguagePicker.Description`.
- Options, fixed, in this order. Display names are endonyms and are intentionally not translated per UI language:

| Index | Tag | DisplayName source | en value | es value |
|---|---|---|---|---|
| 0 | `en-US` | `Settings_LanguageEnglish` | English | English |
| 1 | `es` | `Settings_LanguageSpanish` | Español | Español |

- Initial selection (view model constructor, synchronous): the first entry of the OS-resolved application language list (`ApplicationLanguages.Languages[0]`), matched to an option by primary subtag; fallback option 0. Prevents the picker flashing English.
- On load (`ApplyLoadedSettings`): effective tag = `settings.uiLanguage` if non-blank, else `ApplicationLanguages.Languages[0]`. Option = option whose tag equals `MatchPrimarySubtag(effectiveTag, [en-US, es])`; fallback option 0. Nothing is written on load.
- On user selection (`SelectionChanged` -> `ApplyLanguageAsync(option)`):
  - If `option.tag == SelectedOption.tag`: return false, nothing happens (this also swallows the programmatic selection echo on load).
  - Else: set `SelectedOption`, set `ApplicationLanguages.PrimaryLanguageOverride = option.tag`, save `uiLanguage = option.tag` via load-mutate-save, return true.
  - When true, show the restart prompt.
- Restart prompt (a confirm dialog): title `SettingsLanguageRestart_Title` ("Restart required" / "Reinicio necesario"), content `SettingsLanguageRestart_Content` ("The language will apply once Vozella restarts. Restart now?" / "El idioma se aplicará al reiniciar Vozella. ¿Deseas reiniciar ahora?"), primary button `SettingsLanguageRestart_RestartNow` ("Restart now" / "Reiniciar ahora"), close button `SettingsLanguageRestart_Later` ("Later" / "Más tarde"); default button is Primary.
  - Later (or dismiss): nothing further; language applies on next launch.
  - Restart now: run the exit gate (`App.TryPrepareForExitAsync`). The gate returns true immediately when there is no work to protect; otherwise it asks to save/confirm the active recording. If it returns false (user kept the recording, a close is already in progress, or the gate threw) the restart is cancelled silently. If true, call the platform restart (`AppInstance.Restart("")`); on success the process is torn down and relaunched. The return value is discarded; a failure to initiate restart leaves the app running with no message.
- Startup (`App.OnLaunched` -> `ApplyPersistedUiLanguageAsync`, before the window and before any resource use):
  1. Load settings; on any exception stop (use whatever the OS resolved).
  2. If `uiLanguage` is blank: stop (follow the OS).
  3. Re-assert `ApplicationLanguages.PrimaryLanguageOverride = uiLanguage` (idempotent; settings.json is the source of truth, not the platform override).
  4. `ResolveCulture(uiLanguage)`; if null stop. Else set `CurrentUICulture`, `CurrentCulture`, `DefaultThreadCurrentUICulture`, `DefaultThreadCurrentCulture` to it. Effect: core strings, number formatting and date formatting all follow the chosen UI language, not the Windows regional settings.
- The two systems (resw via the platform override, and .NET culture) do not sync on their own; hence step 4.

### 2.2 Summary provider selection

- Four mutually exclusive radios in a `RadioButtons` group (`RadioSummaryProvider`), each with an icon and a label; the radio's `Tag` is the enum name and `IsChecked` is bound one-way to the view model:

| Tag (enum name) | AutomationId | Label key | en | es | Icon |
|---|---|---|---|---|---|
| `Local` | `RadioProviderLocal` | `Settings_ProviderLocal.Text` | Local (on this device) | Local (en este dispositivo) | glyph U+E950 |
| `ClaudeCode` | `RadioProviderClaudeCode` | `Settings_ProviderClaude.Text` | Claude Code CLI | CLI de Claude Code | Claude icon |
| `Codex` | `RadioProviderCodex` | `Settings_ProviderCodex.Text` | Codex CLI | CLI de Codex | Codex icon |
| `Xai` | `RadioProviderXai` | `Settings_ProviderXai.Text` | Grok (xAI) | Grok (xAI) | Grok icon |

- Card header `Settings_SummaryProviderCard.Header`, description `Settings_SummaryProviderCard.Description`.
- Default selection when `selectedSummaryProvider` is null, blank, or unparseable: `Local`.
- On `Checked` of a radio: parse the tag; run `SelectProviderAsync(kind)`:
  - `kind == SelectedProviderKind`: return (this swallows the echo from programmatic `IsChecked` updates).
  - Else set `SelectedProviderKind = kind` (this recomputes the four `Is*Selected` flags, `ShowCliProviderStatus`, and `CliProviderStatusText`), save `selectedSummaryProvider = kind.ToString()`, and if `kind == Xai` run `RefreshXaiAccountAsync()`.
- CLI detection text (below the radios, visible only for ClaudeCode and Codex; caption style, AutomationId `TxtCliProviderStatus`): computed whenever the selected kind changes. Kind is ClaudeCode or Codex -> if executable `claude`/`codex` is found on PATH then `Status_CliOnPath` ("Detected on PATH." / "Detectado en el PATH.") else `Status_CliMissing` ("Not found on PATH — install it before recording." / "No se encontró en el PATH: instálalo antes de grabar."). Other kinds -> empty string.
- PATH probe algorithm (`CliProcessRunner.IsOnPath(fileName)`): read env `PATH`; on Windows extensions = env `PATHEXT` split on `;`, default `.EXE;.CMD;.BAT`; elsewhere a single empty extension. For each non-blank PATH directory (split on the OS path separator) and each extension, true if `File.Exists(dir/fileName+ext)`.
- Executable names: ClaudeCode -> `claude`, Codex -> `codex`; any other kind throws `ArgumentOutOfRangeException` ("Only ClaudeCode and Codex are CLI-backed providers.").

Visibility of the provider-specific blocks (all bound one-way):

| Block | Visible when | Expanded |
|---|---|---|
| `Settings_ClaudeOptions` (AutomationId `ExpanderClaudeOptions`) | ClaudeCode selected | always `IsExpanded=True` |
| `Settings_CodexOptions` (`ExpanderCodexOptions`) | Codex selected | always |
| `Settings_SummaryModels` (`ExpanderLocalSummaryModels`) | Local selected | bound to Local selected |
| `Settings_XaiAccount` (`ExpanderXaiAccount`) | Xai selected | always |

All blocks sit below the radios so the radios never jump.

### 2.3 Claude Code and Codex options

Each has two combo boxes inside a settings expander, bound to string lists from `InferenceCatalog`.

| Setting | Control AutomationId | Items (in order) | Default | AppSettings field |
|---|---|---|---|---|
| Claude model | `ComboClaudeModel` (min width 200) | `sonnet`, `opus`, `haiku`, `fable` | `sonnet` | `selectedClaudeModelId` |
| Claude effort | `ComboClaudeEffort` (min width 160) | `low`, `medium`, `high`, `xhigh`, `max` | `low` | `selectedClaudeEffort` |
| Codex model | `ComboCodexModel` (200) | `gpt-5.4`, `gpt-5.5`, `gpt-5.6`, `gpt-5.6-sol` | `gpt-5.6` | `selectedCodexModelId` |
| Codex effort | `ComboCodexEffort` (160) | `low`, `medium`, `high`, `xhigh` | `low` | `selectedCodexEffort` |

Card text keys: `Settings_ClaudeOptions.Header/Description`, `Settings_ClaudeModel.Header`, `Settings_ClaudeEffort.Header/Description` ("low, medium, high, xhigh, or max."), `Settings_CodexOptions.Header/Description`, `Settings_CodexModel.Header`, `Settings_CodexEffort.Header/Description` ("low, medium, high, or xhigh."). Item values are shown raw (not localized).

Commit rule for all four (`Select{Claude|Codex}{Model|Effort}Async(value)`): ignore when page `_isLoading`, or `_suppressCliInferenceCommit` is set (set only inside `ApplyLoadedSettings`), or the value is null/whitespace, or equals the current value. Otherwise set the property, save the single field (load-mutate-save), and show the shared success InfoBar with `Xai_FeedbackModel` formatted with `"<model> · <effort>"` (middle dot U+00B7 with spaces), e.g. `Saved. Using sonnet · low.`
Resolution on load: a null/blank stored value resolves to the default (`Resolve*` methods). The stored value is otherwise taken verbatim, even if not in the list (see bug 7.13).

### 2.4 Local summary models

Visible when Local is selected. Expander `Settings_SummaryModels` (icon U+E945) with header and description keys `Settings_SummaryModels.Header/Description`, a progress ring bound to page `IsLoading`, and one row per catalog model, in catalog order.

Catalog (`ModelCatalog.SummaryModels`, order is ascending `MinRamGb`; all Q4_K_M GGUF; `FileName` is the persisted id and the on-disk file name):

| FileName | DisplayName | Download URL | FileSizeGb | MinRamGb | Speed key | Quality key | UseCase key |
|---|---|---|---|---|---|---|---|
| `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | Llama 3.2 1B Instruct | `https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf` | 0.81 | 4 | `ModelSpeedVeryFast` | `ModelQualityGood` | `ModelUseCaseModestPcs` |
| `gemma-4-E2B-it-Q4_K_M.gguf` | Gemma 4 E2B Instruct | `https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf` | 3.11 | 6 | `ModelSpeedFast` | `ModelQualityVeryGood` | `ModelUseCaseRecommendedDefault` |
| `gemma-4-E4B-it-Q4_K_M.gguf` | Gemma 4 E4B Instruct | `https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf` | 4.98 | 8 | `ModelSpeedMedium` | `ModelQualityExcellent` | `ModelUseCasePc16GbOrGpu` |
| `gemma-4-12b-it-Q4_K_M.gguf` | Gemma 4 12B Instruct | `https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf` | 7.12 | 16 | `ModelSpeedSlowWithoutGpu` | `ModelQualityExcellent` | `ModelUseCaseGpuOnly` |

Speed/Quality/UseCase strings come from `CoreStrings` (section 4.4) and are resolved once, at first access of the static catalog (see bug 7.9). `UseCase` is not shown on the Settings page (it is used by the first-run model setup dialog, another module).

Row content (a settings card per model):
- Header: `Info.DisplayName` (always the plain name; the `Model_Downloaded` "(downloaded)" decoration exists in `ModelOption.DisplayName` but is used only by the setup dialog).
- Description (`SpeedQualityLabel`): `Model_SpeedQuality` formatted with `(Speed, Quality, FileSizeGb)` -> `"{0} · Quality {1} · {2:0.#} GB download"` / `"{0} · Calidad {1} · {2:0.#} GB de descarga"`. The size uses the .NET custom format `0.#` in the current culture: 0.81 -> `0.8`, 3.11 -> `3.1`, 4.98 -> `5`, 7.12 -> `7.1`.
- Fit badge: rounded border, text `RatingLabel`, caption style, white-on-accent text. Label keys: `Fit_Recommended` (Recommended / Recomendado), `Fit_MayBeSlow` (May be slow / Puede ser lento), `Fit_NotRecommended` (Not recommended / No recomendado). Colors: Recommended -> system success fill, MayBeSlow -> system caution fill, anything else -> system critical fill.
- Indeterminate 16x16 progress ring active while `IsDownloading`. (No percent bar is shown here; see bug 7.5.)
- "Active" radio (`Settings_Active.Content`, group `SummaryModelSelection`, checked = `IsActive`, enabled only when `IsDownloaded`; AutomationId `RadioSelectModel_<FileName>`).
- "Download" button (`Settings_Download.Content`; visible when not downloaded; disabled while downloading; id `BtnDownloadModel_<FileName>`).
- "Delete" button (`Settings_Delete.Content`; visible when downloaded; id `BtnDeleteModel_<FileName>`). No confirmation.

Fit rating algorithm (`SummaryModelInfo.RateFor(hardware)`), with `HardwareProfile(TotalRamGb, GpuName?, GpuVramGb?)` and `HasDedicatedGpu = GpuVramGb > 0`:
1. `Recommended` if `TotalRamGb >= MinRamGb` OR (`HasDedicatedGpu` AND `GpuVramGb >= MinRamGb / 2`).
2. else `MayBeSlow` if `TotalRamGb >= MinRamGb * 0.75`.
3. else `NotRecommended`.

Behavior:
- `ApplyLoadedModels(snapshot, selectedId)`: remember the selected id, clear the collection, add a fresh `ModelOption` for every catalog entry with `IsActive = (FileName == selectedId)` and `IsDownloaded` from disk. `IsActive` is set even when the file is missing (see bug 7.7).
- Download: set `IsDownloading=true`; call `DownloadModelAsync(info, progress)` where progress writes `DownloadProgressPercent` (0-100 double); on success `IsDownloaded=true`; always `IsDownloading=false` in `finally`. No error is caught or shown. Downloading does not select the model.
- Delete: delete the file via the model service, set `IsDownloaded=false`; if that model was active: `IsActive=false`, remembered id = null, save `selectedSummaryModelId = null`.
- Select (radio `Checked`): ignore if not downloaded or if its `FileName` equals the remembered id; otherwise set `IsActive` true on this option and false on all others, remember the id, save `selectedSummaryModelId = FileName`.
- Page-level hardware text lines `Hardware_WithGpu` / `Hardware_NoGpu` belong to the setup dialog, not to Settings.

### 2.5 Grok (xAI) account and model

Visible when xAI is selected. Expander `Settings_XaiAccount` (header "Grok (xAI)"; description `Settings_XaiAccount.Description`). Items, in order:

1. Status card (`CardXaiStatus`): header = `XaiStatusText`, description = `XaiStatusDetail`, a check glyph (U+E73E) visible only when signed in; on the right: an indeterminate 16x16 ring while `IsXaiBusy`, a button `Settings_XaiSignIn.Content` ("Sign in with SuperGrok") shown only when signed out (`BtnXaiSignIn`), a button `Settings_XaiSignOut.Content` ("Sign out") shown only when signed in (`BtnXaiSignOut`).
2. API key card (`Settings_XaiApiKey`, vertical layout; header "API key"; description "Optional. For people who prefer a key from console.x.ai."): a password box width 240, reveal mode Peek, placeholder `Settings_XaiApiKeyBox.PlaceholderText` ("xAI API key"; id `BoxSettingsXaiApiKey`) and a Save button `Settings_XaiSaveApiKey.Content` ("Save"; id `BtnXaiSaveApiKeySettings`) enabled only when the draft is not blank.
3. Model card (`Settings_XaiModel`, header "Model"): combo (`ComboXaiModel`, min width 200, placeholder `ComboXaiModel.PlaceholderText` "Choose a Grok model") enabled only when signed in.
4. Effort card (`Settings_XaiEffort`, header "Effort", description "How hard Grok thinks. Low is faster; high is slower and more thorough."): combo (`ComboXaiEffort`, 160) with `none, low, medium, high, xhigh`; default `low`; enabled only when signed in.

A shared success InfoBar (`InfoXaiFeedback`) follows the expander, outside it, so it also serves the Claude and Codex pickers. `ShowXaiFeedback(message)` sets the message, opens the bar, restarts a single non-repeating 4 second timer that closes it. The bar is also user-closable (two-way `IsOpen`).

Status computation `ApplyXaiCredentialStatus()` (reads only the local credential store, no network): `CredentialKind` is one of `OAuth`, `ApiKey`, or null.
- `IsXaiSignedIn = kind != null`.
- `XaiStatusText`: OAuth -> `Xai_StatusSuperGrok` ("Signed in with SuperGrok" / "Sesión iniciada con SuperGrok"); ApiKey -> `Xai_StatusApiKey` ("API key saved" / "Clave de API guardada"); null -> `Xai_StatusSignedOut` ("Not signed in" / "Sesión no iniciada").
- Not signed in: models-loaded flag cleared; detail = `Xai_StatusSignedOutDetail` ("Sign in with SuperGrok, or paste an API key below." / "Inicia sesión con SuperGrok, o pega una clave de API abajo.").
- Signed in and (models not yet loaded for these credentials, or detail empty): detail = `Xai_StatusLoadingModels` ("Loading your Grok models…" with U+2026 / "Cargando tus modelos de Grok…"). Otherwise the existing detail is kept (avoids flashing "loading" on re-refresh).

`ApplyLoadedSettings` (no network): sets the provider kind; suppresses xAI commits; if provider is Xai: apply credential status, and if signed in with an empty model list and a saved model id, seed the list with that id (so the combo keeps its selection); then set `SelectedXaiModelId` (raw stored value, may be null) and `SelectedXaiEffort` (resolved, default `low`); lift suppression; then with CLI suppression set the four Claude/Codex values; lift.
If provider is not Xai the xAI status properties keep their initial empty values until xAI is selected (which triggers a refresh).

`LoadXaiAccountAsync()` (page load, network phase): no-op unless Xai is the selected provider; otherwise `RefreshXaiAccountAsync()`.

`RefreshXaiAccountAsync()` algorithm:
1. `ApplyXaiCredentialStatus()`.
2. Not signed in: with suppression on, clear the model list; return.
3. `IsXaiBusy = true`. `token = XaiAuth.GetAccessTokenAsync()` (refreshes OAuth if near expiry; returns key for ApiKey), `models = XaiApi.ListModelsAsync(token)` (already filtered to text chat models by `IsSummaryChatModel`), reload settings, `resolved = XaiApiClient.ResolveModelId(settings.selectedXaiModelId, models)`.
4. With suppression on: `MergeXaiModels(models, resolved)`, set `SelectedXaiModelId = resolved` if different (ordinal compare), lift suppression.
5. If the persisted `selectedXaiModelId` differs from `resolved` (ordinal), save `selectedXaiModelId = resolved` (self-healing: a vanished or never-set model is replaced and persisted).
6. Mark models loaded; `UpdateXaiReadyDetail()`.
7. Any exception: models-loaded false; `XaiStatusText = Xai_StatusErrorTitle` ("Could not reach Grok" / "No se pudo conectar con Grok"); `XaiStatusDetail = exception.Message` (raw, not localized). The signed-in flag and model list are left as they were.
8. `finally`: `IsXaiBusy=false`, suppression off.

`XaiApiClient.ResolveModelId(selected, listed)`:
1. If `selected` is non-blank and `listed` contains it, ignoring case (ordinal-ignore-case): return `selected` as given (original casing of the saved value).
2. If `listed` is empty: return `"grok-4.6"` (`DefaultModelId`).
3. For each preferred id in order `grok-4.6`, `grok-4.7`, `grok-4.3`, `grok-4.5`, `grok-4-fast`: return the listed entry matching it ignoring case (listed casing).
4. Return `listed[0]`.

`MergeXaiModels(models, resolved)` (in-place reconcile so the combo never blanks): target = `models` plus `resolved` appended if absent. Remove from the observable list every entry not in target (iterating from the end). Then for `i` in `0..target.Count-1`: skip if `list[i] == target[i]`; otherwise if `target[i]` is not already in the list insert it at `min(i, list.Count)`. (Order of already-present entries that are out of place is not corrected.)

Commits:
- `SelectXaiModelAsync(id)`: ignore when page loading, xAI suppression on, id blank, or id equals the current; else set, save `selectedXaiModelId`, `UpdateXaiReadyDetail()`, feedback `Xai_FeedbackModel` with `"<model> · <effort>"`.
- `SelectXaiEffortAsync(effort)`: same guards (uses the xAI suppression flag); save `selectedXaiEffort`; update detail; feedback.
- `UpdateXaiReadyDetail()`: only when signed in and a model is set: detail = `Xai_StatusReady` ("Ready. Using {0}." / "Listo. Usando {0}.") with `"<model> · <effort>"`.
- `SaveXaiApiKeyAsync()`: no-op if the draft is blank; `XaiAuth.SaveApiKey(draft)` (throws on blank; otherwise trims and stores `ApiKey` credentials, replacing any OAuth credentials, under a lock and bumping a credentials version); clear the draft; `RefreshXaiAccountAsync()`; feedback `Xai_FeedbackApiKey` ("API key saved." / "Clave de API guardada."). The page then clears the password box text and the draft.
- `SignOutXaiAsync()`: `XaiAuth.SignOut()` (clears the store); refresh (which now clears the model list); feedback `Xai_FeedbackSignedOut` ("Signed out of Grok (xAI)." / "Sesión cerrada en Grok (xAI).").
- Sign in with SuperGrok: open the xAI auth dialog (another module; device-code flow). If it returns true: refresh, then feedback `Xai_FeedbackSignedIn` ("Signed in with SuperGrok." / "Sesión iniciada con SuperGrok.").
- Password box `PasswordChanged` copies the text into the draft; `CanSaveXaiApiKey = !IsNullOrWhiteSpace(draft)`.

Other strings of the xAI auth dialog are in the `XaiAuth_*` group (13 keys); they belong to the auth module.

### 2.6 Meeting language and summary language

Two cards under heading `Settings_MeetingLanguage.Text`:

1. Transcription language (`Settings_TranscriptionLanguage`, icon U+E775; combo `ComboMeetingLanguage`; item template shows `DisplayName`). Catalog `TranscriptionLanguageCatalog.Languages`, in order:

| Code | Key | Persisted | Nemotron locale (`NemotronLanguageMapper`) |
|---|---|---|---|
| `auto` | `LanguageAutoDetect` | yes | `auto` |
| `en` | `LanguageEnglish` | yes | `en-US` |
| `es` | `LanguageSpanish` | yes | `es-US` |
| `pt` | `LanguagePortuguese` | yes | `pt-BR` |
| `fr` | `LanguageFrench` | yes | `fr-FR` |
| `de` | `LanguageGerman` | yes | `de-DE` |
| `it` | `LanguageItalian` | yes | `it-IT` |
| `nl` | `LanguageDutch` | yes | `nl-NL` |
| `ja` | `LanguageJapanese` | yes | `ja-JP` |
| `zh` | `LanguageChinese` | yes | `zh-CN` |

   Default when `transcriptionLanguage` is null/blank: `"es"` (rationale in the code: lower Spanish WER with an explicit locale than with auto). The mapper trims and lowercases its input, maps blank to `auto`, and maps any unknown code to `auto`.
2. Summary language (`Settings_SummaryLanguage`, icon U+E8D2; combo `ComboSummaryLanguage`). Catalog `SummaryLanguageCatalog.Languages`: `es` (`LanguageSpanish`) first, `en` (`LanguageEnglish`). Default when null/blank: `"es"`. Description says markdown headings stay in English so the app can parse them (invariant that the summary module must keep).

Display names come from `CoreStrings` (en: Auto (detect), English, Spanish, Portuguese, French, German, Italian, Dutch, Japanese, Chinese; es: Automático (detectar), Inglés, Español, Portugués, Francés, Alemán, Italiano, Neerlandés, Japonés, Chino) and, being static, are frozen at first access of the catalog.

On load: selection = first catalog entry whose `Code` equals the resolved code with ordinal, case-sensitive equality; else `Languages[0]` (so `auto` for transcription, `es` for summary). On user change: ignore if the code equals the current one; else set and save the single field (`transcriptionLanguage` / `summaryLanguage`). Header/description keys: `Settings_TranscriptionLanguage.Header/Description`, `Settings_SummaryLanguage.Header/Description`.

Consumers of these values (cross-module): `RecordingPageViewModel`, `RecordingPipelineOrchestrator`, `SessionPageViewModel`, `SummaryPageViewModel`, `PersonalTasksDialogViewModel` read `ResolveTranscriptionLanguage()` and `ResolveSummaryLanguage()` from freshly loaded settings, so a change applies to the next recording or summary with no restart.

### 2.7 Note template options (used by Summary page, assigned here)

`NoteTemplateOption.LoadAsync()` builds the template picker list:
1. Five built-ins in this order, `Id` -> display key: `auto` -> `NoteTemplate_Auto` (Auto / Automático), `one-on-one` -> `NoteTemplate_OneOnOne` (1:1 / 1:1), `standup` -> `NoteTemplate_Standup` (Standup / Reunión diaria), `sales` -> `NoteTemplate_Sales` (Sales / Ventas), `user-interview` -> `NoteTemplate_UserInterview` (User interview / Entrevista de usuario).
2. If the stored custom template exists and its `Name` is not blank, append `Id = "custom"`, `DisplayName = Name.Trim()`.
Note-template instruction texts (`NoteTemplateCatalog.InstructionsFor`, trimmed id, null for `auto`, `custom`, blank and unknown), verbatim, since they are prompts:
- `one-on-one`: "Shape the enhanced notes as a 1:1. Include decisions, feedback, and commitments that were actually stated. Omit a heading if that content is not in the sources."
- `standup`: "Shape the enhanced notes as a standup. Include yesterday, today, and blockers that were actually stated. Omit a heading if that content is not in the sources."
- `sales`: "Shape the enhanced notes as a sales call. Include pain, decision process, next step, and objections that were actually stated. Omit a heading if that content is not in the sources."
- `user-interview`: "Shape the enhanced notes as a user interview. Include what they tried, quotes, and jobs-to-be-done. Quotes must be taken from the transcript or the raw notes. Do not invent quotes."
`NormalizeId`: blank -> null; trimmed value equal to `auto` ignoring case -> null; otherwise the trimmed value.

### 2.8 Settings field inventory (every `AppSettings` field)

JSON names are camelCase (Web defaults). Owner = module that edits the field.

| JSON field | Type | Default when absent/null | Effect | Edited by |
|---|---|---|---|---|
| `selectedSummaryModelId` | string? | null (no active local model) | `FileName` of the active local GGUF; Local summaries need it (otherwise the setup wizard appears) | this |
| `selectedSummaryProvider` | string? | null -> `Local` | Enum name `Local`/`ClaudeCode`/`Codex`/`Xai`; picks the summary engine | this |
| `selectedXaiModelId` | string? | null -> resolved at refresh (`grok-4.6` default) | xAI chat model | this |
| `selectedXaiEffort` | string? | null -> `low` | xAI `reasoning_effort` (`none/low/medium/high/xhigh`) | this |
| `selectedClaudeModelId` | string? | null -> `sonnet` | Claude CLI `--model` alias | this |
| `selectedClaudeEffort` | string? | null -> `low` | Claude CLI `--effort` | this |
| `selectedCodexModelId` | string? | null -> `gpt-5.6` | Codex CLI `-m` | this |
| `selectedCodexEffort` | string? | null -> `low` | Codex `model_reasoning_effort` | this |
| `transcriptionLanguage` | string? | null -> `es` | meeting language code for ASR | this |
| `summaryLanguage` | string? | null -> `es` | language of summary body and action items | this |
| `uiLanguage` | string? | null -> follow OS | UI language tag (`en-US` or `es`) | this |
| `selectedMicrophoneDeviceId` | string? | null/empty -> OS default input | microphone for recording | microphone |
| `recordMicrophoneKind` | string? | null (Settings mic applies) | Record-page mic memory: `None`/`SystemDefault`/`Device` | record page |
| `recordMicrophoneDeviceId` | string? | null | device id for kind `Device` | record page |
| `recordOutputKind` | string? | null | `System` or `App` | record page |
| `recordAppExePath` | string? | null | exe path of the remembered app (reselected only if it is playing audio) | record page |
| `recordAppName` | string? | null | display name, informational | record page |
| `liveTranscriptionEnabled` | bool | `true` | live Nemotron preview during recording; final transcript always re-runs on the WAV | transcription engine |
| `speakerDiarizationEnabled` | bool | `false` | Sortformer speaker labels (Speaker 1-4); model downloaded separately | transcription engine |
| `typeSafeEnabled` | bool | `true` | Jev checks action items after summary when a key is saved | TypeSafe |
| `calendarNotificationsEnabled` | bool | `true` | one-minute-before reminder | calendar |
| `meetingPopupEnabled` | bool | `true` | floating "Start recording" popup on Zoom/Teams/Meet | calendar |
| `disabledCalendarIds` | string[] | `[]` | calendars hidden from Coming up and reminders; compared ordinal; blank entries dropped when converted to a set | calendar |
| `navigationPaneLength` | number? | null -> 280 | nav pane width in DIPs, clamped to 200..480 on resolve | shell |
| `liveCopilotPillX`, `liveCopilotPillY` | int? | null | legacy; no longer read (kept so old files round-trip) | none |
| `liveCopilotPillEdge` | string? | null -> `Right` | docked edge name; unrecognized string -> `Right` | live copilot |
| `liveCopilotPillAlong` | number? | null -> 0.5 | position along the edge, clamped 0..1; NaN/non-finite -> 0.5 | live copilot |

Constants: `DefaultNavigationPaneLength=280`, `MinNavigationPaneLength=200`, `MaxNavigationPaneLength=480`.

---

## 3) Domain rules

### 3.1 Constants and defaults
- Provider enum: `Local`, `ClaudeCode`, `Codex`, `Xai` (ordinal 0..3). Stored as its name string.
- `InferenceCatalog.DefaultEffort="low"`, `DefaultClaudeModel="sonnet"`, `DefaultCodexModel="gpt-5.6"`; lists in 2.3 and 2.5. `XaiApiClient.DefaultModelId="grok-4.6"`; preferred order `grok-4.6, grok-4.7, grok-4.3, grok-4.5, grok-4-fast`.
- Language defaults `es`/`es`; UI language option tags `en-US`, `es` (`UiLanguageResolver.English`, `.Spanish`).
- Feedback bar auto-dismiss: 4 seconds, non-repeating, restarted on each message.
- Fit thresholds: `RAM >= Min`; `GPU VRAM >= Min/2` with a dedicated GPU (`VRAM > 0`); `RAM >= 0.75 * Min`.
- Fade-in on reveal: 150 ms, skipped when OS animations are disabled.

### 3.2 `resolve*` rules
- Every `Resolve*` string method treats `null`, empty and whitespace-only as unset and returns the default; any other value is returned untrimmed and unvalidated.
- `ResolveSummaryProviderKind`: `Enum.TryParse<SummaryProviderKind>(value)`; success returns the value, failure returns `Local`. See bug 7.2 for the leniency of this parse.

### 3.3 `UiLanguageResolver`
- `ResolveCulture(tag)`: blank/null -> null; try to get the culture by name; `CultureNotFoundException` -> null (null means "leave the thread culture alone").
- `MatchPrimarySubtag(candidate, available)`: candidate blank/null -> null. `candidatePrimary = candidate.Split('-')[0]`. Iterate `available` in order; for each, `availablePrimary = tag.Split('-')[0]`; the first with `OrdinalIgnoreCase` equality is returned (the available tag as written, e.g. `es-ES` + `[en-US, es]` -> `es`; `en-GB` -> `en-US`; `ES-es` -> `es`). No match -> null.

### 3.4 Settings persistence discipline
- Every section change uses load-mutate-save: `LoadAsync()` fresh blob, apply one mutation, `SaveAsync(blob)` (whole-file overwrite). Sections must never construct a fresh `AppSettings` (it would reset unrelated fields).
- A single process-wide async lock (semaphore of 1) serializes each Load and each Save separately (not the read-modify-write pair; see bug 7.1).

### 3.5 Language-dependent rules to preserve
- Summary headings remain English regardless of summary language (see description text).
- UI language, meeting language and summary language are three independent settings.
- Only UI language needs a restart; the other two apply on next use.

---

## 4) Persistence and wire formats

### 4.1 `settings.json`
- Path today: `%LOCALAPPDATA%\MeetingLive\settings.json` (`AppPaths.RootDirectory` + `settings.json`). Directory is created on save. Electron should place it under its own user-data directory; migration from the legacy path belongs to the data/migration module. This spec does not touch real user data.
- Serializer: System.Text.Json, `JsonSerializerDefaults.Web` (camelCase names on write; case-insensitive names on read; numbers may be read from strings; unknown properties ignored) with `WriteIndented=true` (2-space indent). No null-ignore condition: null properties are written as `null`. Encoding UTF-8 without BOM. Load: missing file -> new defaults; JSON `null` -> new defaults; malformed JSON throws (not caught; see 7.4).
- Example with provider and language set:

```json
{
  "selectedSummaryModelId": "gemma-4-E2B-it-Q4_K_M.gguf",
  "selectedSummaryProvider": "Codex",
  "selectedXaiModelId": null,
  "selectedXaiEffort": null,
  "selectedClaudeModelId": null,
  "selectedClaudeEffort": null,
  "selectedCodexModelId": "gpt-5.6",
  "selectedCodexEffort": "medium",
  "transcriptionLanguage": "es",
  "summaryLanguage": "en",
  "selectedMicrophoneDeviceId": null,
  "recordMicrophoneKind": null,
  "recordMicrophoneDeviceId": null,
  "recordOutputKind": null,
  "recordAppExePath": null,
  "recordAppName": null,
  "liveTranscriptionEnabled": true,
  "speakerDiarizationEnabled": false,
  "typeSafeEnabled": true,
  "calendarNotificationsEnabled": true,
  "meetingPopupEnabled": true,
  "disabledCalendarIds": [],
  "uiLanguage": "es",
  "navigationPaneLength": null,
  "liveCopilotPillX": null,
  "liveCopilotPillY": null,
  "liveCopilotPillEdge": null,
  "liveCopilotPillAlong": null
}
```
- Compatibility facts the port must keep (all covered by tests): `{}` loads to defaults with `typeSafeEnabled=true`, `calendarNotificationsEnabled=true`, `meetingPopupEnabled=true`, `speakerDiarizationEnabled=false`, empty `disabledCalendarIds`; removed keys such as `selectedChatProvider`, `selectedLiveAnswerProvider` are ignored and `selectedSummaryProvider: "Codex"` still resolves to Codex; negative `liveCopilotPillX` round-trips.
- Secrets are never in this file: the xAI credentials and the TypeSafe key live in separate OS-encrypted stores (DPAPI on Windows; see other modules). The TypeSafe card text says so ("Stored on this PC with Windows encryption. Never written to settings.json.").

### 4.2 UI-language wire values
- Persisted `uiLanguage`: `"en-US"` or `"es"` when chosen in the picker; older or hand-edited values such as `"es-ES"` are tolerated: the picker matches by primary subtag, and startup passes the raw value to the platform override and `ResolveCulture`.

### 4.3 `Resources.resw` structure (604 strings) and automatic JSON conversion

Both locales: `Strings/en-us/Resources.resw` and `Strings/es/Resources.resw`. Each is a .NET resx 2.0 XML file with the standard `resheader` block (resmimetype, version 2.0, reader, writer) followed by `<data name="KEY" xml:space="preserve"><value>TEXT</value></data>` elements, one per line. Verified by script:

- Exactly 604 `data` entries in each file; identical key sets and identical order; no duplicate keys; no `<comment>` elements; no empty values; no leading/trailing whitespace in values; no XML entities in en values (the XML parser unescapes normally).
- Key shape: 271 "plain" keys (no dot; looked up from code by `AppStrings.Get(name)`) and 333 dotted keys (`<Uid>.<Property>`; consumed by `x:Uid` in XAML). The first dot separates uid from property; the property part can itself contain a dot (`AutomationProperties.Name`, `ToolTipService.ToolTip`; 88 keys have two dots). No plain key equals any uid. 244 distinct uids; 85 of them have more than one property.
- Dotted property suffixes (count): `Text` 88, `AutomationProperties.Name` 64, `Header` 47, `Content` 37, `ToolTipService.ToolTip` 24, `Title` 22, `Description` 21, `PlaceholderText` 19, `CloseButtonText` 6, `Message` 3, `PrimaryButtonText` 2.
- Code lookup quirk: for a dotted name `AppStrings.Get("A.B")` replaces `.` with `/` before calling the loader (the platform stores `Uid.Property` as `Uid/Property`). A missing key returns an empty string (no exception, no key echo).
- Placeholders: .NET composite format `{0}`, `{1}`, `{2}`. 62 values contain placeholders: 54 use only `{0}`, 5 use up to `{1}`, 3 up to `{2}`. Placeholder index sets are identical between en and es for every key. None of the dotted (x:Uid) keys contains a placeholder; placeholder strings are all plain keys formatted in code with `string.Format(CurrentCulture, ...)`.
- Format specifiers present (7 occurrences in 4 keys): `Model_SpeedQuality` `{2:0.#}`; `Download_ModelProgress` `{1:0}`; `ComingUp_TimeRange` `{0:t}` and `{1:t}`; `ComingUp_TimeRangeOtherDay` `{0:ddd, MMM d}`, `{1:t}`, `{2:t}`. These take numbers or dates from code and need locale-aware formatters in the port; `:t` is the culture short time pattern (en-US `h:mm tt`, es `H:mm`), `ddd, MMM d` uses culture abbreviations. `MeetingTitleDateFormat` is the value `d MMM, HH:mm` (identical in both locales) applied to a date by `AppStrings.MeetingTitle`, then inserted in `MeetingTitleFormat` ("Meeting {0}" / "Reunión {0}"). It is a .NET custom date format string, not display text.
- One value contains a newline: `MigrationFailed_Content`. 19 en values contain non-ASCII (U+00B7 middle dot, U+2026, U+2014 em dash, U+2013 en dash). 26 keys have identical en and es values (brand names, "Grok (xAI)", "English", "1:1", "Vozella").
- Group inventory by first token of the key (split on `_` or `.`), 65 groups: Settings 89, RecordPage 65, Chat 62, Status 30, LiveCopilot 30, SessionPage 22, Error 21, Setup 20, SummaryPage 19, RecordingSetup 19, Xai 13, XaiAuth 13, PersonalTasks 13, ComingUp 11, CustomTemplate 9, AppClose 9, Cli 8, MeetingPrompt 7, SessionRetranscribe 7, Record 7, Library 7, Nav 6, HistoryDelete 6, TypeSafe 6, SessionRename 5, TranscriptPage 5, HistoryRow 5, LibraryDeleteFolder 5, LibraryPersonality 5, NoteTemplate 5, RecordDiscard 4, SummaryRegenerate 4, SettingsLanguageRestart 4, EngineSetup 4, LibraryNewFolder 4, NotesMode 4, CallPrompt 3, HistoryPage 3, CliSetup 3, Warning 3, Fit 3, LibraryContext 3, LibraryRenameFolder 3, LibraryMove 3, SessionSuggestTitle 2, ComboRecordMicrophone 2, Model 2, Hardware 2, MigrationFailed 2, LibraryFolderName 2, and one each: AppTitleBar, ListRecordAudioSource, History, SettingsPage, CalendarReminder, ErrorPrefix, MeetingTitleFormat, MeetingTitleDateFormat, NoSummariesYet, NoTranscriptsYet, Microphone, ComboMicrophoneDevice, Download, Dialog, ComboXaiModel. Settings-page-owned groups: `Settings_*`, `SettingsPage_*`, `SettingsLanguageRestart_*`, `Fit_*`, `Model_*`, `NoteTemplate_*`, `Xai_*`, `Status_Cli*`, `Hardware_*`, `Microphone_*`.

Recommended conversion (deterministic, lossless, scriptable):
1. Parse each resw as XML; for each `data` element take `name` and the text of its `value` child.
2. Emit one flat JSON object per locale, key = the original `name` unchanged, value = the string. Locale files: `en.json` (from `en-us`) and `es.json`. Preserve order. Example: `{"Settings_Language.Text": "Language", "Settings_ProviderLocal.Text": "Local (on this device)", "Model_SpeedQuality": "{0} · Quality {1} · {2:0.#} GB download"}`.
3. In the port, drop the platform `/` remapping. Look up code strings by the exact key and XAML-derived UI text by `<Uid>.<Property>`. (Optionally derive `{uid: {property: text}}` by splitting at the first dot; both forms are reversible.)
4. Placeholders: keep positional `{n}` verbatim, and implement one `format(template, ...args)` that supports `{n}`, `{n:0}`, `{n:0.#}`, `{n:t}`, `{n:ddd, MMM d}`. If an ICU-based library is adopted instead, a transform from `{n}` to the library syntax must be applied by script and verified against this list of 4 specifier keys.
5. Fallback chain must differ from today's: current behavior returns `""` for a missing app string and the key name for a missing core string (bug 7.8). The port should fall back selected locale -> `en` -> key and log a warning.
6. Add an automated test asserting equal key sets, equal placeholder index sets, and no empty values across `en.json` and `es.json` (these hold today).

### 4.4 `CoreStrings` (43 keys)
- Files `Strings/CoreStrings.resx` (neutral = English) and `Strings/CoreStrings.es.resx`; same resx structure; 43 plain keys in each, same order, no dotted keys. Loaded by `ResourceManager("MeetingLive.Core.Strings.CoreStrings")` for `CurrentUICulture`; `Get(name)` returns the key name when missing; `Format` uses `CurrentCulture`.
- Key families: `Sample_Greeting` (Hello / Hola; test fixture); `CliFailure*` x6 (NotInstalled, NotSignedIn, SubscriptionInactive, TimedOut, EmptyOutput, Unknown; each uses `{0}` for the CLI name); `Chat*` x7 (LiveTranscriptEmpty, MeetingNotFound, TranscriptEmpty, FolderNotSelected, FolderNotFound, NoMeetingsInFolder, NoMeetingsSaved); `Recipe*Name` x8 (Discussed, ActionItems, FollowUpEmail, NextSteps, ProjectPlan, FeatureRequests, RecurringThemes, WeeklyUpdate); `ModelSpeed*` x4 (VeryFast, Fast, Medium, SlowWithoutGpu); `ModelQuality*` x3 (Good, VeryGood, Excellent); `ModelUseCase*` x4; `Language*` x10 (AutoDetect, English, Spanish, Portuguese, French, German, Italian, Dutch, Japanese, Chinese). Count check: 1 + 6 + 7 + 8 + 4 + 3 + 4 + 10 = 43.
- Values for the keys shown on the Settings page: Speed: Very fast / Muy rápido, Fast / Rápido, Medium / Medio, Slow without GPU / Lento sin GPU. Quality: Good / Buena, Very good / Muy buena, Excellent / Excelente. Language names in 2.6.
- The same flat-JSON conversion applies. These strings are consumed from backend/core logic, so in the port the core layer needs its own locale-aware lookup (or must receive the active locale explicitly rather than reading a thread-global culture).

### 4.5 Startup language state
- Two independent runtime values must be kept in sync by the port at startup: (a) the renderer i18n locale (replaces the resw override) and (b) the main-process/core locale used for core strings and for number and date formatting (replaces `CurrentUICulture` and `CurrentCulture`). Both derive from `settings.uiLanguage` if set, otherwise from the OS preferred language list matched by primary subtag against `[en-US, es]`, fallback `en-US`.

---

## 5) Native and OS dependencies

| Item | Windows-only or portable | Port note |
|---|---|---|
| `ApplicationLanguages.PrimaryLanguageOverride`, `ApplicationLanguages.Languages` | Windows-only (WinRT) | Replace with renderer i18n locale plus main-process locale; OS preferred languages from `app.getPreferredSystemLanguages()` |
| `ResourceLoader` / `x:Uid` binding / `.resw` | Windows-only runtime, portable data | Convert data to JSON (4.3); no x:Uid |
| `ResourceManager` / `.resx` satellite assembly | .NET-only runtime, portable data | Convert to JSON |
| `CultureInfo` thread culture sync | .NET-only | Replace with explicit locale passed to formatters |
| `AppInstance.Restart` | Windows-only | `app.relaunch()` + `app.exit(0)` after the exit gate |
| Exit gate `TryPrepareForExitAsync` | portable logic, depends on recording module | Keep as a callable "may exit?" in main |
| `UISettings.AnimationsEnabled` | Windows-only | CSS `prefers-reduced-motion` |
| PATH probing with `PATHEXT` | portable with branching | On macOS no `PATHEXT`; also consider GUI-launched apps lacking the shell PATH (Electron on macOS) |
| `settings.json` in `%LOCALAPPDATA%` | path Windows-only | Use per-OS user-data dir; atomic write |
| JSON `Web` serializer behavior | portable | camelCase names, nulls written, tolerant read |
| Hardware detection for fit ratings (WMI, RAM, VRAM) | Windows-only (WMI) | Other module; contract is `HardwareProfile(totalRamGb, gpuName?, gpuVramGb?)` |
| Local GGUF download/delete/exists, `IsModelDownloaded` | portable logic, other module | Needs a progress callback 0-100 and a thrown error on failure |
| xAI credential store (DPAPI), TypeSafe key store | Windows-only encryption | Use Electron `safeStorage`; other module |
| xAI OAuth dialog, `ListModelsAsync`, `GetAccessTokenAsync` | portable network logic | Other module |
| Segoe MDL2 glyph icons (U+E775, E950, E945, E73E, E8D2 ...) and brand SVG paths (Claude, Codex, Grok, TypeSafe) | Windows font glyphs | Replace with an icon set; brand SVGs are in the XAML if needed |
| Settings expander/card/RadioButtons/InfoBar controls | WinUI Community Toolkit | Rebuild in the new design system |

---

## 6) Existing test coverage (MeetingLive.Core.Tests) and cases to carry over

No test touches any App view model, `AppStrings`, or the Settings page. Coverage exists only for Core pieces:

`UiLanguageResolverTests` (all must carry over, same inputs and outputs):
- `ResolveCulture_English_ReturnsEnglishCulture`: `en-US` -> name `en-US`.
- `ResolveCulture_Spanish_ReturnsSpanishCulture`: `es` -> name `es`.
- `ResolveCulture_WhenNullOrBlank_ReturnsNull`: null, "", "   ".
- `ResolveCulture_WhenUnrecognizedTag_ReturnsNull`: `xx-99-INVALID!`.
- `MatchPrimarySubtag_WhenCandidateHasRegion_MatchesAvailablePrimaryOnly`: `es-ES` vs `[en-US, es]` -> `es`.
- `MatchPrimarySubtag_WhenAvailableHasRegion_MatchesCandidatePrimaryOnly`: `en-GB` -> `en-US`.
- `MatchPrimarySubtag_IsCaseInsensitive`: `ES-es` -> `es`.
- `MatchPrimarySubtag_WhenCandidateNullOrBlank_ReturnsNull`: null, "", "   ".
- `MatchPrimarySubtag_WhenNoMatch_ReturnsNull`: `fr-FR`.

`AppSettingsTests` (cases relevant here; the remaining cases belong to other modules but live in the same class and defaults table):
- `ResolveTranscriptionLanguage_WhenUnset_ReturnsSpanish`; `..._WhenSet_ReturnsPinnedCode` for `en`, `auto`, `es`.
- `ResolveSummaryLanguage_WhenUnset_ReturnsSpanish`; `ResolveSummaryLanguage_WhenEnglish_ReturnsEnglish`.
- `ResolveNavigationPaneLength_WhenUnset_ReturnsDefault`; `..._ClampsToAllowedRange` (150->200, 200->200, 320->320, 600->480).
- `SpeakerDiarizationEnabled_WhenUnset_DefaultsFalse`; `..._WhenJsonOmitsField_DefaultsFalse`.
- `TypeSafeEnabled_WhenUnset_DefaultsTrue`; `..._WhenJsonOmitsField_DefaultsTrue`; `TypeSafeEnabled_RoundTripsFalse`.
- `CalendarNotificationsEnabled_WhenUnset_DefaultsTrue`; `..._WhenJsonOmitsField_DefaultsTrue`; `..._RoundTripsFalse`.
- `MeetingPopupEnabled_WhenUnset_DefaultsTrue`; `..._WhenJsonOmitsField_DefaultsTrue`; `..._RoundTripsFalse`.
- `DisabledCalendarIds_WhenUnsetOrJsonOmitsField_IsEmpty`; `DisabledCalendarIds_RoundTripsNonEmptyAndDropsBlanks` (list preserved as written, set drops blanks and de-duplicates).
- `Deserialize_WhenJsonHasRemovedProviderKeys_LoadsAndIgnoresThem` (Codex still resolves).
- `LiveCopilotPillPosition_WhenUnsetOrJsonOmitsField_IsNull`; `LiveCopilotPillPosition_RoundTripsIncludingNegativeCoordinates`.
- `LiveCopilotPillDock_WhenUnsetOrJsonOmitsFields_IsNullAndResolvesToMidRight`; `LiveCopilotPillDock_RoundTrips`; `ResolveLiveCopilotPillAlong_ClampsOutOfRangeValues` (-2->0, 3.5->1, NaN->0.5); `ResolveLiveCopilotPillEdge_WhenUnrecognized_FallsBackToRight`.

`CoreStringsTests`: `Get_UnderEnglishCulture_ReturnsEnglishText` (`Sample_Greeting` -> "Hello"), `Get_UnderSpanishCulture_ReturnsSpanishText` ("Hola"). Carry over as "lookup honors the requested locale"; keep the `Sample_Greeting` fixture or replace it with an equivalent.

`ModelCatalogTests`: `SummaryModels_ContainsAllFourCuratedEntries`, `SummaryModels_AreOrderedByAscendingMinRam`, `SummaryModels_AllHaveHttpsDownloadUrlsAndPositiveFileSize`.
`SummaryModelInfoTests`: `RateFor_WhenRamMeetsMinimum_ReturnsRecommended`, `RateFor_WhenRamBelowMinimumButOver75Percent_ReturnsMayBeSlow`, `RateFor_WhenRamFarBelowMinimum_ReturnsNotRecommended`, `RateFor_WhenGpuVramCoversHalfTheMinimum_ReturnsRecommended`.
`NoteTemplateCatalogTests`: `InstructionsFor_AutoAndUnknown_ReturnNull`, `InstructionsFor_BuiltIns_NameTheRequiredShape`, `NormalizeId_OmitsAutoAndBlank`.
`XaiApiClientTests`: `ResolveModelId_PicksSavedThenPreferredThenFirst` with rows (null, [4.3, 4.6]) -> 4.6; ("", [4.3]) -> 4.3; ("grok-4.3", [4.3, 4.6]) -> 4.3; ("grok-imagine-image", [4.6]) -> 4.6; (null, []) -> 4.6.
`NemotronLanguageMapperTests` (other file in the same area): mapper table in 2.6.

New tests the port should add (no coverage today): settings service concurrency and atomicity (7.1, 7.3), strict provider-kind parse (7.2), picker/engine agreement for case and whitespace variants of language codes (7.6), MergeXaiModels behavior, section commit-suppression during load, the resw conversion parity checks (4.3 item 6), format specifier rendering for the four specifier keys in both locales, fit-rating boundaries (exact `0.75 * Min`, VRAM exactly `Min/2`, `GpuVramGb = 0`, null), `0.#` size formatting.

---

## 7) Bugs, races, and uncovered cases

Status key: confirmed = reproducible from the code as read; suspected = depends on runtime behavior not verifiable by reading.

1. **Lost updates in settings read-modify-write** (confirmed). `SettingsSectionViewModelBase.cs:17-22` does `LoadAsync` then `SaveAsync` with the lock taken separately inside each call (`AppSettingsService.cs:18-31`, `34-47`). Two sections saving at once (or the xAI refresh at `SummaryProviderSectionViewModel.cs:288-298` racing a user commit, or any other view model's own read-modify-write) can overwrite each other's field with a stale blob. Port: one serialized `update(mutator)` operation that holds the lock across read and write.
2. **Provider enum parse accepts numbers and undefined values** (confirmed from .NET semantics). `AppSettings.cs:50` uses `Enum.TryParse` without a defined-value check: `"1"` parses as `ClaudeCode`, `"99"` parses as an undefined value (no radio is checked, provider branches fall through), and leading/trailing spaces are tolerated; matching is case-sensitive (`"codex"` falls back to `Local`). Port: accept only the four exact names, else `Local`.
3. **Non-atomic settings write** (confirmed). `AppSettingsService.cs:40` truncates the file (`File.Create`) before writing; a crash or power loss mid-write leaves a truncated file. Port: write to a temp file in the same directory, flush, rename over the target.
4. **Corrupt settings.json is unhandled** (confirmed). `AppSettingsService.cs:25` throws on malformed JSON. `App.ApplyPersistedUiLanguageAsync` catches it, but `SettingsPageViewModel.LoadAsync` (`SettingsPageViewModel.cs:68-70`) does not: the page then reveals with unapplied defaults and no message, and other callers may crash. Port: on parse failure keep the bad file as a backup, start from defaults, and tell the user.
5. **Local model download has no error handling, no cancel, and no percent display** (confirmed). `LocalModelSectionViewModel.cs:36-49`: a failed download throws out of the command with a `finally` that only clears `IsDownloading`; no message is shown and `DownloadProgressPercent` is not reset. The Settings template (`SettingsPage.xaml:169`) shows only an indeterminate ring; `DownloadProgressPercent` is written but never bound on this page. `DeleteModel` (`:54`) also has no error handling (a file locked by an in-use model would throw) and deletes without confirmation.
6. **Language picker can disagree with the effective language** (confirmed). `LanguageSectionViewModel.cs:26,30` match codes with ordinal case-sensitive equality; stored `"ES"` or `" en "` falls back to `auto` (transcription) or `es` (summary) in the picker, while `AppSettings.ResolveTranscriptionLanguage` returns the raw value and `NemotronLanguageMapper` trims and lowercases it (so the engine uses the pinned language the picker does not show). For the summary language the raw uppercase/unknown value is passed to the summarizer unchanged (whether the summarizer tolerates it is unverified: suspected).
7. **Active model flag set when the file is missing** (confirmed). `LocalModelSectionViewModel.cs:30` sets `IsActive` from the id alone; if the GGUF was deleted outside the app the radio is checked but disabled and Local summaries would need the setup wizard. Also an id that is no longer in the catalog yields no active row silently.
8. **Inconsistent missing-string behavior** (confirmed). `AppStrings.cs:12` returns `""` for unknown keys (blank UI text, invisible failure) whereas `CoreStrings.cs:10` returns the key name.
9. **Static catalogs freeze localized text** (confirmed). `TranscriptionLanguageOption.cs:17-29,36-40` and `ModelCatalog.cs:16-54` call `CoreStrings.Get` in static initializers, so they capture the culture at first touch; changing language later does not relabel them until restart. Today this is hidden by the mandatory restart; in the port compute names at render time.
10. **Restart failure is silent** (confirmed). `SettingsPage.xaml.cs:81` discards the result of the restart call; if the platform refuses, the user sees nothing, even though the exit gate may already have saved or closed work.
11. **Partial live language switch** (suspected). `UiLanguageSectionViewModel.cs:71` sets the live override before saving and before restart; until restart, XAML `x:Uid` text for views created after the change may resolve in the new language while `AppStrings` (process-lifetime cached loader, `AppStrings.cs:9`) and `CoreStrings` (thread culture) stay in the old one, giving a mixed-language UI. Also, if the save at `:72` throws, the override and `settings.json` diverge.
12. **Unprotected async-void handlers** (suspected). `SettingsPage.xaml.cs:129-143` (`XaiSaveApiKey_Click`, `XaiSignOut_Click`) await commands whose bodies call the credential store without a try/catch (`SummaryProviderSectionViewModel.cs:241,250`); an I/O or DPAPI failure would propagate out of `async void` and can terminate the app. `XaiSignIn_Click` has the same shape through the dialog and refresh.
13. **Claude/Codex stored values are not validated against the lists** (confirmed). A hand-edited `selectedClaudeModelId: "gpt-9"` is bound as `SelectedItem` outside `ItemsSource`, the combo shows blank, and the value is still passed to the CLI. Same for efforts and for `selectedXaiEffort` (e.g. `"max"` is valid for Claude but not xAI/Codex).
14. **xAI refresh error leaves misleading state** (confirmed). `SummaryProviderSectionViewModel.cs:303-308`: the status title becomes "Could not reach Grok" but `IsXaiSignedIn` stays true (check glyph and Sign out button remain), the old model list stays, and the detail is the raw exception message (not localized, may contain technical text). No retry control other than re-selecting the provider.
15. **CLI detection is a one-shot synchronous filesystem probe on the UI thread** (confirmed that it is synchronous, `SummaryProviderSectionViewModel.cs:379-383`; the cost is suspected). It runs on load and on provider change only; installing the CLI while Settings is open does not update the "Not found" text until the user toggles providers. PATH entries on slow network drives could stall the UI.
16. **Hard-coded English accessibility names** (confirmed). `SettingsPage.xaml:327` ("Microphone level"), `:385` ("Transcription engine download progress"), `:436` ("Speaker model download progress") bypass the resource system, so screen readers read English in Spanish.
17. **Cached page re-applies state over live objects** (confirmed). On every revisit `LocalModel.ApplyLoadedModels` (`LocalModelSectionViewModel.cs:25-32`) discards the old `ModelOption` objects: a download still running loses its UI state (button re-enabled, ring gone) and a second concurrent download of the same file can be started. `LoadAsync` is also re-entrant (no guard on the local phase, `SettingsPageViewModel.cs:56`), so a quick leave-and-return can run two loads that apply in either order.
18. **Unobserved task when the snapshot fails** (confirmed). `SettingsPageViewModel.cs:68-69` starts `settingsTask` before awaiting the snapshot; if the snapshot throws, the settings task is never awaited and the command fault is dropped because `OnNavigatedTo` ignores the result (`SettingsPage.xaml.cs:36`). The page shows defaults (e.g. summary provider Local, language `auto` before apply) with no error.
19. **TypeSafe description contradicts the default** (confirmed). `Settings_TypeSafeEnabled.Description` says "Off by default until you save a key." while `AppSettings.cs:106` defaults `typeSafeEnabled=true` (and `AppSettingsTests.TypeSafeEnabled_WhenUnset_DefaultsTrue` enforces it). The doc says "Key presence is the real gate". Fix the string or the default when porting, and decide which is intended (needs product decision).
20. **Underscore tags do not match** (suspected, low). `UiLanguageResolver.cs:54,58` split only on `-`; a tag written `es_ES` is treated as primary `es_ES` and does not match. Also, resolving an unknown but well-formed name such as `xx` depends on the platform: the Windows culture API throws (so null), while ICU-based platforms can return a synthetic culture, which would change `ResolveCulture` results off Windows.
21. **Resource-string ownership is untracked** (confirmed gap). Nothing verifies that every `resw` key is referenced, nor that every `x:Uid` or `AppStrings.Get` name exists; 604 keys are checked only by manual review. Add a script that cross-checks.
22. **Effort and model values are shown raw** (confirmed, cosmetic). English tokens (`low`, `xhigh`, `sonnet`) appear in the Spanish UI; acceptable because they are CLI arguments, but the descriptions are partially translated while the tokens are not.
23. **`Xai_StatusError` (value `{0}`) is defined but not referenced** by the assigned code (confirmed unused in these sources; other modules were not searched).
24. **Pill X/Y legacy fields** are serialized but unused (confirmed): harmless; keep for round-trip.

---

## 8) Parity checklist

Tick each item when the Electron implementation matches.

Page shell and load
1. Settings page renders the ten blocks in the order of table 2.0 with column max width 720, padding 24, spacing 24.
2. Page title uses `SettingsPage_Title.Text`.
3. First visit shows a centered 32x32 progress ring and keeps content laid out at opacity 0 and non-interactive until the local phase finishes.
4. After the first reveal, later visits do not show the ring and refresh silently.
5. Reveal fades content in over 150 ms, and not at all when the OS requests reduced motion.
6. Settings JSON and hardware snapshot load in parallel; the UI paints the ring before heavy work.
7. If the user leaves before load completes, loaded values are not applied and nothing is started (microphone meter stays closed).
8. Local-phase application order is UiLanguage, LocalModel, SummaryProvider, TypeSafe, Language, TranscriptionEngine, Microphone, Calendar.
9. Network phase (xAI account and calendar list) runs after reveal, single-flight, and its failures never fault the page.
10. The ring is always cleared even if loading throws (and, improving on today, an error is shown).
11. Page-level loading state suppresses commits from combo events raised by the programmatic load.
12. Leaving the page stops the microphone meter and ASR-backend observation.

App UI language
13. Picker has exactly two options in order `en-US` ("English"), `es` ("Español"), endonym labels that do not change with the UI language.
14. Card header "App language" / description about restart, with the Spanish equivalents.
15. Initial selection comes from the effective OS/app language by primary subtag, fallback English, with no flash.
16. On load, selection comes from `uiLanguage` if set, else the effective language, matched by primary subtag; nothing is saved on load.
17. Selecting the already selected option does nothing.
18. Selecting a different option updates the live locale override and saves `uiLanguage` as `en-US` or `es`.
19. A successful change opens the restart confirm dialog with the four strings, default button "Restart now".
20. "Later" leaves the app running; the language is fully applied at next launch.
21. "Restart now" first runs the exit gate; if the gate refuses, no restart happens.
22. If the gate allows, the app relaunches itself; failure to relaunch must be surfaced (improvement over silent).
23. On startup, before creating any window, persisted `uiLanguage` is applied to both the renderer locale and the core/main locale; a read failure leaves OS defaults; blank leaves OS defaults.
24. Culture used for number and date formatting follows the UI language, not the OS regional settings.

Locale resolution
25. `resolveCulture` returns null for null, empty, whitespace, and unrecognized tags; returns a locale for `en-US` and `es`.
26. `matchPrimarySubtag` returns null for blank candidate; matches primary subtag case-insensitively; returns the available tag as written; first match wins; null when none.
27. Fallback to `en-US` when nothing matches.

Summary provider
28. Four radios in order Local, Claude Code CLI, Codex CLI, Grok (xAI), with labels, icons and AutomationIds from 2.2.
29. Default provider is Local when unset, blank, or unrecognized (and strict name parsing, bug 7.2).
30. Selecting the current provider is a no-op.
31. Selecting another provider updates the UI immediately and saves `selectedSummaryProvider` as the exact enum name.
32. Selecting Xai triggers an account refresh.
33. Card header and description match the strings.
34. Claude/Codex show a PATH detection caption; Local and Xai show none.
35. Detection text is "Detected on PATH." or "Not found on PATH — install it before recording." (and Spanish).
36. PATH probe follows the algorithm in 2.2 (PATHEXT on Windows, plain name elsewhere, skip blank entries).
37. Executable names `claude` and `codex`; other kinds are rejected.
38. Provider-specific blocks show/hide per table in 2.2 and sit below the radios.

Claude Code and Codex options
39. Claude model list `sonnet, opus, haiku, fable`, default `sonnet`.
40. Claude effort list `low, medium, high, xhigh, max`, default `low`.
41. Codex model list `gpt-5.4, gpt-5.5, gpt-5.6, gpt-5.6-sol`, default `gpt-5.6`.
42. Codex effort list `low, medium, high, xhigh`, default `low`.
43. Each picker saves only its own field, ignoring blank, unchanged, loading, and load-suppressed events.
44. Each save shows the success bar "Saved. Using <model> · <effort>." (and Spanish).
45. Both expanders always expanded when visible, with the described headers, descriptions, brand icons.
46. Stored blank/null values resolve to the defaults (Claude model, Claude effort, Codex model, Codex effort, xAI effort).

Local models
47. Catalog contains the four models with exact file names, display names, URLs, sizes, RAM minimums, and localized speed/quality/use-case strings, in ascending RAM order.
48. Row shows display name, description `"<speed> · Quality <quality> · <size> GB download"` with size formatted `0.#`, fit badge, spinner, Active radio, Download or Delete.
49. Fit rating follows the three-step algorithm and exact thresholds in 2.4; badge colors success, caution, critical.
50. Active radio is enabled only when the model is downloaded.
51. Download button visible only when not downloaded, disabled while downloading.
52. Delete button visible only when downloaded.
53. Download sets the busy state, reports 0-100 progress, marks downloaded on success, clears busy on any outcome.
54. Download failure shows an error and resets progress (improvement over silent).
55. Downloading does not change the active model.
56. Delete removes the file and marks not downloaded; if it was active, clears active and saves `selectedSummaryModelId=null`.
57. Selecting a downloaded model marks only it active and saves its file name; reselecting the active model does nothing.
58. Load marks active by file name; model state is not discarded for downloads in progress on revisit (improvement over bug 7.17).
59. Expander header "Summary models" and its description; ring bound to page loading; expanded when Local is selected.
60. Automation ids `RadioSelectModel_<file>`, `BtnDownloadModel_<file>`, `BtnDeleteModel_<file>` preserved for UI tests.

Grok (xAI)
61. Status card header/description/check glyph/busy ring/sign-in and sign-out buttons follow 2.5 visibility rules.
62. Credential status text for OAuth, ApiKey, and none; signed-out detail; loading-models detail shown only while models are not yet loaded.
63. On load with xAI selected, status reflects the local credential store immediately, with the saved model seeded in the list.
64. Refresh algorithm: token, list models, resolve model id, merge list in place, persist the resolved id if it differs, set ready detail.
65. `resolveModelId` rules: saved (case-insensitive match, returns saved text), default `grok-4.6` when the list is empty, preferred order, first listed.
66. `mergeXaiModels` removes absent entries, inserts missing ones at their index, always keeps the resolved id.
67. Refresh failure sets the title "Could not reach Grok" and the exception text as detail and always clears busy.
68. Signed-out refresh clears the model list.
69. Model and effort combos are disabled when signed out.
70. Effort list `none, low, medium, high, xhigh`, default `low`.
71. Model and effort commits ignore loading, suppressed, blank, and unchanged values; save their own field; update the "Ready. Using <model> · <effort>." detail; show the feedback bar.
72. API key box masks input with peek; Save is enabled only for a non-blank draft.
73. Saving a key stores a trimmed key replacing any OAuth credentials, clears the draft and the box, refreshes, and shows "API key saved."
74. Sign out clears credentials, refreshes, shows "Signed out of Grok (xAI)."
75. Successful SuperGrok sign-in refreshes and shows "Signed in with SuperGrok."
76. Feedback bar: success severity, user-closable, auto-closes after 4 s, timer restarted per message, shared by Claude, Codex, and xAI.
77. Model placeholder "Choose a Grok model".

Meeting and summary language
78. Transcription catalog: auto, en, es, pt, fr, de, it, nl, ja, zh in that order, with localized names.
79. Summary catalog: es, en in that order.
80. Defaults: transcription `es`, summary `es`, when null/blank.
81. Picker shows the matching entry, else first entry; case and whitespace variants must agree with the engine mapping (improvement over bug 7.6).
82. Selecting the current entry does nothing; otherwise saves only that field.
83. Changes take effect on the next recording or summary without a restart.
84. Mapper table code -> Nemotron locale (including trim, lowercase, blank -> auto, unknown -> auto).
85. Description text states summary headings remain English; that invariant is preserved by the summary module.
86. Names are computed per active locale at render time.

Note templates
87. Option list: Auto, 1:1, Standup, Sales, User interview, then the custom template if it has a non-blank name (trimmed).
88. Built-in ids `auto, one-on-one, standup, sales, user-interview`; custom id `custom`.
89. Instruction prompts quoted verbatim in 2.7; null for auto, custom, blank, unknown; id trimmed first.
90. `normalizeId` rules (blank -> null, `auto` ignoring case -> null, else trimmed).

Settings persistence
91. One JSON file with the field set, camelCase names and defaults in 2.8.
92. Nulls are written as null; unknown keys are ignored on read; names are read case-insensitively; missing file -> defaults; JSON null -> defaults.
93. Missing booleans: `liveTranscriptionEnabled` true, `speakerDiarizationEnabled` false, `typeSafeEnabled` true, `calendarNotificationsEnabled` true, `meetingPopupEnabled` true.
94. `disabledCalendarIds` defaults to empty and to-set drops blank entries and duplicates.
95. `navigationPaneLength` null -> 280, clamped 200..480.
96. `liveCopilotPillAlong` null/non-finite -> 0.5, clamped 0..1; edge unknown/null -> Right; legacy X/Y kept and unused.
97. Removed legacy keys in old files do not break loading and do not alter provider resolution.
98. Every section change loads fresh, mutates one field, saves the whole blob (no fresh blob construction).
99. Read-modify-write is atomic across load and save (improvement over bug 7.1).
100. Writes are atomic via temp file and rename (improvement over bug 7.3).
101. Corrupt file handling: back up, defaults, user notice (improvement over bug 7.4).
102. No secrets in settings.json.
103. Provider kind parsed strictly from the four names (bug 7.2).
104. Stored model/effort strings are used verbatim but the UI handles values missing from the lists without a blank control (bug 7.13).

Strings and i18n data
105. `en.json` and `es.json` generated from the two resw files with 604 keys each, original key names, original order, values unchanged.
106. Key sets, placeholder index sets, and non-empty values are verified equal across locales by a test.
107. 271 plain and 333 dotted keys are preserved; dotted keys keep the first-dot uid/property split semantics.
108. Positional placeholders `{0}`..`{2}` render correctly; 62 values contain placeholders.
109. Format specifiers `{2:0.#}`, `{1:0}`, `{n:t}`, `{0:ddd, MMM d}` render per locale (4 keys).
110. `MeetingTitleDateFormat` (`d MMM, HH:mm`) renders month abbreviations per locale, composed into `MeetingTitleFormat`.
111. The newline in `MigrationFailed_Content` is preserved.
112. Non-ASCII characters (middle dot, ellipsis, em/en dash) are preserved.
113. `CoreStrings` converted to JSON with 43 keys per locale, same checks as items 105-106.
114. Missing key falls back selected -> `en` -> key and logs a warning (improvement over bug 7.8).
115. Core/main-process strings use an explicit locale, not a global.
116. Catalog display names (languages, speed, quality) resolve in the active locale at use time (bug 7.9).
117. Accessibility names for the three progress bars are localized (bug 7.16).
118. A cross-check script verifies every referenced key exists and every key is referenced (bug 7.21).

Tests
119. All `UiLanguageResolver` test cases in section 6 are ported with identical expectations.
120. All relevant `AppSettings` test cases in section 6 are ported (defaults, round trips, clamps, legacy keys).
121. `CoreStrings` lookup-by-locale test is ported.
122. Catalog, fit-rating, note-template, and `resolveModelId` test cases are ported.
123. New tests listed at the end of section 6 are added.

Cross-module interfaces
124. Other Settings sections (TypeSafe, Microphone, Transcription engine, Calendar, Data folder, About) are mounted in the slots of table 2.0 and read/write their fields through the same locked settings update.
125. Exit gate is exposed to the language-restart flow as "may the app exit now?".
126. Hardware profile, local-model service, xAI auth/API, CLI path probe, and note-template store are consumed through interfaces with the contracts named in this spec.
