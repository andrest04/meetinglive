# Parity ledger: summaries

Spec: `docs/port/specs/summaries.md`. Section 8 is the checklist; each package appends its rows under its own heading and never reorders earlier ones.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`.

## Where things are

| Concern                                                                                                             | Code                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Summary, title, part and merge prompt builders; enhancement context; language names and headings (S01)              | `packages/core/src/summaries/prompt-builders.ts` (tests beside it)                                                  |
| Response splitter (S02)                                                                                             | `packages/core/src/summaries/summary-splitter.ts`                                                                   |
| Action item parser and renderer (S02)                                                                               | `packages/core/src/summaries/action-items.ts`                                                                       |
| Title normalization and placeholder check (S02)                                                                     | `packages/core/src/summaries/suggested-title.ts`                                                                    |
| Provider port, result, default stream, cancellation (S03)                                                           | `packages/core/src/summaries/provider.ts`                                                                           |
| Provider contract test helper, reused by S04 and S11 (S03)                                                          | `packages/core/src/summaries/provider-contract.ts` (`describeSummaryProviderContract`, not exported from the index) |
| CLI failure classification, sanitizer, `CliToolError`, `runRequiredStdout`, `CliProcessRunner` port (S03)           | `packages/core/src/summaries/cli-failure.ts`                                                                        |
| Failure codes, key maps, `formatFailure` (S03)                                                                      | `packages/core/src/summaries/cli-failure-messages.ts`                                                               |
| CLI argv builders, B30 validation, legacy string form (S04)                                                         | `packages/core/src/summaries/cli-invocation.ts`                                                                     |
| CLI provider base, Claude Code and Codex providers, web-search factories (S04)                                      | `cli-provider.ts`, `claude-code-provider.ts`, `codex-provider.ts`                                                   |
| `FakeCliProcessRunner` test double (S04)                                                                            | `packages/core/src/summaries/test-kit.ts` (not exported from the index)                                             |
| Node CLI process runner, `.cmd` wrapper, tree kill (S05)                                                            | `packages/platform/src/summaries/cli-process-runner.ts`; fake CLI fixture `fake-cli-fixture.ts`                     |
| llama-server sidecar: start, health wait, streaming chat, tokenize, idle stop, restart (S09)                       | `packages/platform/src/llama/llama-sidecar.ts`                                                                      |
| Process guard: Job Object guard, watchdog fallback (S09)                                                            | `packages/platform/src/llama/process-guard.ts`; Rust `native/vozella-native/src/job.rs`; fake `fakes/fake-process-job.ts` |
| Local map-reduce, `splitToBudget`, `splitLongLine`, `groupToBudget`, `TokenCounter` (S10) | `packages/core/src/summaries/local-map-reduce.ts` (tests beside it) |
| PATH lookup with `resolve()` (S05, shared with Settings)                                                            | `packages/platform/src/settings/path-cli-probe.ts`                                                                  |
| Provider availability: `isProviderAvailable`, `UNAVAILABLE_SUMMARY_PROVIDERS`, `AvailableSummaryProviderKind` (S07) | `packages/core/src/library/settings.ts`                                                                             |
| Settings page `providerNotice` and the removed-provider notice (S07)                                                | `packages/core/src/settings/page-service.ts`; `apps/desktop/src/renderer/features/settings/ProviderSection.tsx`     |
| Catalog key parity test (S03)                                                                                       | `apps/desktop/src/main/summary-failure-catalog.test.ts`                                                             |

## Decisions

- **Newlines (S01).** Prompts and enhancement blocks use LF only. CRLF inside notes, agenda and template text is converted to LF. The WinUI app used the platform newline (CRLF on Windows) and indented the enhancement tags with 12 spaces; both were artefacts of the C# raw string literals and the model ignores them. The tag lines now start at column 0.
- **Enhancement layout (S01).** Taken from the C# source, not the prose summary: the rules text follows the main prompt after one newline, and every block is a newline, `<tag>`, the trimmed value, `</tag>`, then a newline. So blocks are separated by a blank line and the whole suffix ends with a newline, as in the original.
- **Dates (S01).** `recordedAt` and `endedAt` are `OffsetDate` values (see `library/offset-date.ts`) and are written with `formatOffsetDate(..., 'round-trip')`: seven fraction digits and a numeric offset.
- **Headings by language code (S01, B27).** `SUMMARY_HEADINGS` is keyed by language code and only `es` and `en` are populated, which are exactly the codes the Settings picker offers (`SUMMARY_LANGUAGES`). A test fails if the picker gains a code without headings. Other codes still fall back to Spanish headings and examples while the body language name follows `toEnglishLanguageName`, as in the WinUI app.
- **fr and de (S01).** Not localized. They are not offered in the picker, and a saved `fr` or `de` is reachable only by editing `settings.json`. Such a file still gets a prompt that asks for French or German text under Spanish subheadings, exactly like WinUI. If either is added to the picker later, add a headings entry first; the test enforces it.
- **Persistence parser kept separate (S02).** `library/meeting-markdown.ts` keeps its own strict `- [ ]` regex. Pointing it at the shared parser would not be a pure move: B26 widens the shared one to `*`/`+` bullets and loose spacing, which would change how saved meetings are read. Reading stays byte-compatible with WinUI; only model replies get the tolerant parser.
- **Placeholder patterns are data (S02).** `looksLikePlaceholder` and `resolveTitle` take RegExp patterns built by `placeholderPatternsFromFormats` from the `MeetingTitleFormat` catalog values (`Meeting {0}`, `Reunión {0}`). Core stays pure; the S13 caller must pass both locales' formats. The default is English only.
- **Splitter header tolerance (S02).** Title, Summary and Action Items headers match case-insensitively; `**Action Items**` also starts the action section and ends a title block. A fence is stripped only when the first non-blank line is a bare, `markdown` or `md` fence and the last is a closing fence.
- **Stdout is not evidence (S03, B12).** `classifyFailure` classifies stderr only, in the spec 2.5 order. Stdout is consulted last, for a short list of phrases a CLI prints about itself (`not logged in`, `please run ... login`, `session expired`, `token expired`, `payment required`, `plan expired`); bare words like billing or quota in stdout are ignored. Before the not-installed check, `model ... not found` and `404 ... not found` are removed from stderr.
- **Errors are data (S03, B28).** `CliToolError` and `SummaryError` carry a kind or code plus args. `message` is for logs. `formatFailure(error, translate)` picks the catalog key; the UI keys `Error_Cli*` are used (they carry the Unknown detail suffix); the `CliFailure*` Core keys are exported as `CLI_FAILURE_CORE_KEYS` for callers that want the Core wording. Any other error shows its own message.
- **New keys (S03).** `Ui_SummaryLocalModelMissing`, `Ui_SummaryLocalEmpty`, `Ui_SummaryNotesTooLong`, `Ui_SummaryTranscriptTooLong` (`{0}` parts, `{1}` limit), `Ui_SummaryCannotCondense` in `ui.en.json` and `ui.es.json`; the main catalogs are pinned to the C# resources. The `Cancelled` code reuses `Status_ProcessingCancelled`.
- **Spawn errors (S03).** `ENOENT`, `ENOTDIR`, `EACCES` and `EPERM` all mean the program cannot be run and map to NotInstalled. WinUI mapped only Win32 error 2 and 3; EACCES on a CLI path is the same user action (reinstall or fix the install).
- **Cancellation (S03).** `CancelledError` (name `AbortError`) is thrown for a cancelled signal; `runRequiredStdout` also throws it when the signal fired during the run, whatever the process returned, and `wrapCliError` never wraps it.
- **Argv, not strings (S04, B30).** Providers start `claude`/`codex` with an argument array and no shell. `claudePrintArgs` and `codexExecArgs` build it; `claudePrintLine` and `codexExecLine` keep the WinUI string form for display and the ported tests, and are never used to start a process.
- **Option validation (S04, B30).** A model or effort in the allow-list of `settings/inference-options.ts` passes. Any other stored value passes only if it matches `[A-Za-z0-9][A-Za-z0-9._:-]*`; I added the leading letter or digit so a value like `--tools` cannot look like a flag. Anything else (spaces, quotes, `;`, `$`, newlines) throws `InvalidCliOptionError` before any process starts. The message is English and technical; the UI shows it as any other error. A model with a space is therefore refused, so the WinUI quoting never applies to a real launch.
- **Args built per call (S04).** A bad stored value fails the summary call, not provider construction, so settings loading and the provider factory (S12) never throw on a hand edited file.
- **B31 kept for parity (S04).** Five minute timeout (`CLI_TIMEOUT_MS`) and the whole transcript in one prompt; no chunking for CLI providers, per spec. The timeout is injectable through `timeoutMs`. Very long meetings can still time out and show the TimedOut message.
- **Web search only by factory (S04, item 71).** `createClaudeCodeProvider` and `createCodexProvider` never add search. `create...WebSearchProvider` is for the live-answer path only. Summaries, titles and prompts use the plain ones.
- **Stdin encoding (S04).** The provider passes the prompt as a string; S05's runner must write it as UTF-8 without a BOM (item 58, B24).
- **One PATH lookup (S05).** `PathCliProbe.resolve()` returns the full path and `isOnPath` is `resolve() !== null`; the runner and Settings share it.
- **Runner takes the S03 port shape (S05).** `NodeCliProcessRunner.run(file, args, stdin, timeoutMs, cancel)`, positional as `CliProcessRunner` defines it. `file` is a bare name resolved on PATH.
- **cmd.exe wrapper (S05, B11).** A resolved `.cmd`/`.bat` is launched as `cmd.exe /d /s /c "<quoted list>"` with verbatim arguments. An argument containing `"`, `%`, CR, LF or NUL is refused instead of escaped, because cmd.exe cannot escape them safely. The prompt is on stdin only.
- **Fake CLI (S05).** Tests use a Node script launched through a generated `.cmd` shim and through a copy of `node.exe` as the plain `.exe`, written under `VOZELLA_DATA_ROOT`. No real claude or codex is run.
- **Part and merge prompts (S01)** take the English language name (`toEnglishLanguageName`), as `BuildPartPrompt` and `BuildMergePrompt` do, and are used by S10.

- **Map-reduce is a function over two ports (S10).** `summarizeMapReduce(request, counter, infer, cancel)` takes a `TokenCounter` (`count(text)`, BOS included) and an `InferFunction(prompt, maxTokens, temperature, cancel)`. It returns the raw model text; S11 runs `splitSummaryResponse` on it. Errors are `SummaryError` codes (`NotesTooLong`, `TranscriptTooLong` with `[parts, 64]`, `CannotCondense`); English text stays in the catalog (B28).
- **Whitespace-only long-line pieces dropped (S10).** The spec drops whitespace-only chunks at flush; the pieces of a long line are pushed directly in the C# source. I drop whitespace-only pieces too, so no useless inference runs; no word is lost.
- **Merge exhaustion is almost unreachable (S10).** With the real prompt sizes (final prompt 427 words, merge prompt 69 words, merge room about 3259, final room about 2517) a note that does not fit the final prompt cannot be grouped with another, so the no-progress stop fires first. The pass-8 exit is kept as written and has no test of its own.

## Parity items

### Prompts (S01)

| #   | Item                                                       | Status   | Notes                                                                   |
| --- | ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| 7   | Summary prompt matches 3.1 verbatim, with U+2013 in "3–8"  | done     | Exact-text snapshot test; dash checked on its own.                      |
| 8   | Language name mapping                                      | done     | Blank and unknown give Spanish; trim and lowercase.                     |
| 9   | Subheadings and examples English only for `en`             | done     | Trimmed, case-insensitive.                                              |
| 10  | `<ended_at>` only when an end time exists, round-trip form | done     | Test for both cases, plus the never-say-not-recorded rule.              |
| 11  | `<recorded_at>` always, round-trip form                    | done     | Seven fraction digits and offset.                                       |
| 12  | Enhancement suffix only when something is present          | done     | Blank notes, agenda, instructions and blank-only attendees add nothing. |
| 13  | Rules text; raw-notes line only with raw notes             | improved | LF and no indentation (see Decisions).                                  |
| 14  | Block order, trimming, attendee join                       | improved | LF and no indentation.                                                  |
| 15  | Title-only prompt matches 3.2 verbatim                     | done     | Snapshot test.                                                          |
| 16  | Part prompt matches 3.5 verbatim                           | done     | Snapshot test; used by S10.                                             |
| 17  | Merge prompt matches 3.5 verbatim                          | done     | Snapshot test; used by S10.                                             |

### Splitter, parser and titles (S02)

| #                 | Item                                                                     | Status           | Notes                               |
| ----------------- | ------------------------------------------------------------------------ | ---------------- | ----------------------------------- |
| 18                | CRLF to LF                                                               | done             | Tested.                             |
| 19                | Title block joined by a space, null when empty or absent, not normalized | done             | Quotes kept for `normalizeTitle`.   |
| 20                | Action section at the first action header, else first checkbox line      | improved         | Header case and bold form (B25).    |
| 21                | No action section and no checkbox: whole reply is summary                | done             |                                     |
| 22                | Title block removed, leading `## Summary` dropped, trimmed               | done             | Summary header is case-insensitive. |
| 23                | Item rules per 3.4                                                       | improved         | B26.                                |
| 24                | Text trimmed, done for x and X                                           | done             |                                     |
| 25                | Render `- [x] text                                                       |
| `, empty for none | done                                                                     | Round-trip test. |
| 26                | Splitter tolerates fences and header case                                | improved         | B25.                                |
| 27                | `normalizeTitle` per 3.8                                                 | done             | All listed cases.                   |
| 28                | `titleFromModelResponse`, heading-only gives null                        | done             |                                     |
| 29                | `resolveTitle` replaces only placeholders, blank counts                  | done             |                                     |
| 30                | Every localized auto title recognized                                    | improved         | B10, patterns passed as data.       |

### Provider port and failures (S03)

| #   | Item                                                                              | Status   | Notes                                                        |
| --- | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| 1   | `SummaryProvider` port with summarize, suggestTitle, completePrompt, streamPrompt | done     | Cancel is a `CancelSignal`.                                  |
| 2   | `SummaryResult` shape                                                             | done     |                                                              |
| 3   | Suggested title from the same response, no second inference                       | done     | Contract test counts model calls.                            |
| 4   | `streamPrompt` default yields one chunk; chunks concatenate to the answer         | done     | `withDefaultStream` and the contract test.                   |
| 5   | `ProviderId` is local, claude-code, codex                                         | improved | xAI dropped (S07).                                           |
| 6   | Every provider uses the shared builders and splitter                              | done     | `describeSummaryProviderContract`; S04 and S11 must call it. |
| 72  | Classification order and keyword lists                                            | improved | B12.                                                         |
| 73  | Kind to message key with display name                                             | done     | `CLI_FAILURE_UI_KEYS`, `CLI_FAILURE_CORE_KEYS`.              |
| 74  | Unknown appends a sanitized snippet, never the exit code                          | done     |                                                              |
| 75  | Redaction pattern and 120 character cap                                           | done     |                                                              |
| 76  | UI mapping to `Error_Cli*`; other errors show their message                       | done     |                                                              |
| 77  | Error text localized in the UI layer                                              | improved | B28, new `Ui_Summary*` keys.                                 |
| 188 | Six `CliFailure*` and the `ModelSpeed/Quality/UseCase` keys in both catalogs      | done     | Parity test.                                                 |

### CLI providers (S04)

| #   | Item                                                                           | Status   | Notes                                                          |
| --- | ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------- |
| 55  | Executables `claude`/`codex`, display names, 5 minute timeout                  | done     | Timeout injectable (B31).                                      |
| 56  | Claude argv order `-p`, `--model`, `--effort`, tools                           | improved | Array form; each part only when set; legacy string kept (B30). |
| 57  | Codex argv `--search` before `exec -`, `-m`, `-c model_reasoning_effort="..."` | improved | Array form (B30).                                              |
| 59  | Not on PATH gives NotInstalled before spawn                                    | done     | Tested with the fake runner: no spawn.                         |
| 60  | Non-zero exit classified; empty stdout EmptyOutput                             | done     | Via `runRequiredStdout`.                                       |
| 61  | Cancellation never wrapped                                                     | done     | Tested.                                                        |
| 62  | Other errors wrapped by kind                                                   | done     | Runner timeout gives TimedOut.                                 |
| 70  | B30 model and effort validated, argv items                                     | improved | See Decisions.                                                 |
| 71  | Web search variants only for live answers                                      | done     | Explicit factories.                                            |

Contract: both providers run `describeSummaryProviderContract`. Ported tests: CliInvocationTests (6 cases), CliToolProviderBaseTests and both provider test classes (`cli-invocation.test.ts`, `cli-providers.test.ts`). Items 58, 63 to 69 belong to S05.

Pending-real-validation: S04 ran only against `FakeCliProcessRunner`. The real `claude` and `codex` flags (`--effort`, `--tools`, `--allowedTools`, `--search`, `-c model_reasoning_effort`) were not run against the installed CLIs.

### CLI process runner (S05)

| #   | Item                                                                                     | Status   | Notes                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| 58  | Stdin written as UTF-8 bytes, no BOM, flushed and closed                                 | done     | First bytes checked on the fake child.                                                           |
| 63  | `isOnPath`: PATH split, blank entries skipped, PATHEXT default `.EXE;.CMD;.BAT`          | done     | Shared `PathCliProbe`.                                                                           |
| 64  | `resolveExecutable` returns the full path                                                | improved | New `resolve()`; the resolved path is what is launched (B11).                                    |
| 65  | Stdout, stderr, stdin write and exit awaited together under one deadline                 | done     | 4 MB prompt echoed back, no deadlock.                                                            |
| 66  | Closed stdin is "not delivered"; success with undelivered stdin throws, non-zero returns | done     | Node reports the closed pipe as an EOF error in the end callback, which counts as not delivered. |
| 67  | Spawn ENOENT becomes a not found error (`code` kept)                                     | done     | Classified NotInstalled.                                                                         |
| 68  | Timeout kills the tree and throws `CliTimeoutError`                                      | done     | `taskkill /T /F` on Windows, process group elsewhere. Pid asserted gone, also for a `.cmd`.      |
| 69  | Cancellation kills the tree and rethrows `CancelledError`                                | done     | Also while stdin is blocked.                                                                     |

Real `claude` and `codex` invocation: pending-real-validation.

### Model catalog, hardware and download (S06)

| #   | Item                                                                           | Status   | Notes                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 115 | Hardware profile, `HasDedicatedGpu`, `HasNvidiaGpu` (four tokens)              | done     | `hasNvidiaGpu` tests now cover NVIDIA, GeForce, Quadro, Tesla true and AMD, Intel, bare `RTX`, blank, null false.                                                                                                        |
| 116 | Detected once and cached; failures not cached                                  | improved | B17: a failed GPU query or a rejected read clears the cached promise, so the next call asks again. A machine with no adapter (query succeeded) stays cached.                                                             |
| 117 | Fit rating, 0.75 and half-minimum rules                                        | improved | B17: `rateFor(model, hardware, { gpuOffload })`. With `gpuOffload: false` the VRAM no longer stands in for RAM. Default is true, the old behavior, until S12 passes the chosen llama backend.                            |
| 118 | Four catalog entries, order, minimum RAM, URLs, label keys                     | done     | Pinned in `catalogs.test.ts`.                                                                                                                                                                                            |
| 119 | Labels resolved at render time                                                 | done     | B20: the catalog holds keys only; a test checks the key shapes.                                                                                                                                                          |
| 120 | Model path is `<dir>/<FileName>`; downloaded means the pinned size             | improved | B18: `sizeBytes` per model; `isDownloaded` needs a file of that size.                                                                                                                                                    |
| 121 | Stream to `.part`, percent only with a known length, atomic move, no half file | done     | Plus size check, then SHA-256 when pinned, before the move; a mismatch removes the part.                                                                                                                                 |
| 122 | No download timeout                                                            | done     | `stallTimeoutMs` stays off by default.                                                                                                                                                                                   |
| 123 | True resume, one download per model                                            | improved | B18: the store passes `resume: true`, so a dropped transfer keeps `.part` and continues with a Range request (tested on a local server). `LocalModelsService.download` joins a running transfer and returns its outcome. |
| 124 | Delete removes the file, ignores a missing one                                 | done     | Existing tests.                                                                                                                                                                                                          |
| 125 | Deleting the active model clears the selection                                 | done     | Existing test.                                                                                                                                                                                                           |
| 186 | Models directory and `.part` convention                                        | done     | `<dir>/<FileName>` and `<FileName>.part`.                                                                                                                                                                                |

Sizes (Content-Length from a HEAD on 2026-11-03): 1B 807694464, E2B 3106738272, E4B 4977171584, 12B 7121861440 bytes. SHA-256 is pinned only for the 1B file, taken from the spikes download (a test checks it against that file when present). The other three were never downloaded here, so they have a size and no hash. Decision: the unpinned hashes can be added when someone downloads them.

Decision: a second `download()` for a file already in flight now returns the first call's outcome instead of `ignored: already-downloading`. The contract enum keeps that value; nothing returns it.

### Retire xAI/Grok (S07)

| #       | Item                                                                                                                                                            | Status  | Notes                                                                                                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 142     | xAI gate passes when credentials exist, else opens the sign-in dialog                                                                                           | dropped | owner decision 2026-11-03, may return later. The gate (S12) has no xAI branch.                                                                                                                                                                             |
| 146-171 | Every xAI constant, request, stream, status mapping, model list, `ResolveModelId`, OAuth, refresh, JWT, session, credential store and file format, dialog flows | dropped | owner decision 2026-11-03, may return later. Deleted: `settings/xai.ts`, `settings/xai-account.ts`, `XaiAccountPort`, `file-xai-account.ts`, `FakeXaiAccount`, the four `settings.xai.*` channels and handlers, `XaiAccount.tsx`, the Grok radio and mark. |
| 177-181 | xAI status line, account refresh with model merge, B29 guard, API key and sign out toasts, offline seeding                                                      | dropped | owner decision 2026-11-03, may return later. `Feedback` keeps only `Xai_FeedbackModel`, which the Claude Code and Codex model line still uses.                                                                                                             |
| S07-1   | A `settings.json` that selects `Xai` still loads, with `selectedXaiModelId`, `selectedXaiEffort` and every unknown field, and re-saves without losing them      | done    | `AppSettings` keeps the two Xai fields. Tests: core `settings.test.ts`, platform `settings-runtime.test.ts` (real file store), desktop handler test and e2e `settings-i18n.spec.ts`.                                                                       |
| S07-2   | `resolveSummaryProviderKind` returns `'Xai'` as a known but unavailable value; `isProviderAvailable(kind)`                                                      | done    | `SUMMARY_PROVIDERS` still lists `Xai`; `UNAVAILABLE_SUMMARY_PROVIDERS` and `AvailableSummaryProviderKind` are new. S12 must refuse an unavailable kind and never fall back to Local.                                                                       |
| S07-3   | Settings page DTO field `providerNotice` (`'xai-removed'` or null)                                                                                              | done    | Set when the saved provider is `Xai`. The page shows a notice (`Ui_SummaryProviderXaiRemoved`, en and es) and no selected radio. Picking another provider clears it. `setSummaryProvider('Xai')` is refused.                                               |
| S07-4   | `xaiCredentialsFilePath` stays in `AppPaths` for on-disk compatibility                                                                                          | done    | Nothing reads, writes or deletes `xai-credentials.bin`. A test still pins the path.                                                                                                                                                                        |
| S07-5   | No `settings.xai.*` channel is registered                                                                                                                       | done    | Contract test, handler test (registered handler names) and e2e (the call is refused).                                                                                                                                                                      |

Dropped tests (reason: owner decision 2026-11-03, may return later): `XaiApiClientTests`, `XaiAuthSessionTests`, `XaiOAuthClientTests`, `XaiSummaryProviderTests`, `FileDpapiXaiCredentialStoreTests`, the XaiJwt gap, the xAI dialog view model gap. Ported tests removed with the code: `file-xai-account.test.ts`, the xAI parts of `settings-services.test.ts`, `catalogs.test.ts`, `settings-handlers.test.ts`, `SettingsRoute.test.tsx` and the Grok cases of the three settings e2e specs.

Decisions (S07):

- **Catalog keys are generated.** `en.json` and `es.json` are produced by `scripts/convert-strings.mjs` from the WinUI resources, and a test checks them byte for byte, so the unused `Xai_*`, `XaiAuth*`, `Settings_Xai*`, `Settings_ProviderXai`, `ComboXaiModel` and `Setup_Xai*` keys cannot be deleted from those two files without editing the converter or the WinUI resources. Both are outside this package's edit surface. The keys stay, nothing reads them, and `i18n-catalog-checks.test.ts` lists them in one `REMOVED_PROVIDER_KEYS` pattern. `Xai_FeedbackModel` is still used.
- **Hand written keys removed.** `Ui_XaiSignInFailed`, `Ui_XaiSignedOutApiKeyOnly`, `Ui_XaiAccountApiKeyOnly`, `Ui_ShowKey` and `Ui_HideKey` (only the API key field used them) are gone from `ui.en.json` and `ui.es.json`. `Ui_XaiRetry` stays: the Settings load error and the engine setup dialog use it as a generic retry.
- **Card description.** `Settings_SummaryProviderCard.Description` mentions Grok and is generated, so the page now reads the new `Ui_SummaryProviderCardDescription` (the same sentence without Grok). The old key is in the removed-provider pattern.
- **Contract kept wide.** `summaryProviderSchema` still accepts `Xai` so the page DTO can report a legacy selection; `settings.setCliOption` no longer accepts `xai`.
- **Fake native build.** `apps/desktop/src/main/index.ts` no longer builds an xAI account and no longer imports `safeStorage`.

### llama-server runtime install (S08)

New capability from `docs/port/research/local-inference.md` and `stack.md` "Local LLM". It has no parity item numbers, so the rows are new.

| #     | Item                                                                                                                      | Status | Notes                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S08-1 | llama.cpp tag `b12063` pinned with four Windows x64 backends and SHA-256 values exactly as the spike                      | new    | `llama-runtime-catalog.ts`. cuda12 and cuda13 each pin the llama zip plus the cudart zip; vulkan and cpu one zip. A test compares every name and hash.                                                                     |
| S08-2 | Folder `<app data>/LlamaRuntime/<backend>`, `isReady`, `binDirectory`, `serverPath`                                       | new    | Ready means no `<backend>.incomplete` marker and `llama-server.exe` in the folder (or one folder down).                                                                                                                    |
| S08-3 | `ensure(backend, onProgress, cancel)`: resumable checksummed download, `System32/tar.exe` extract, promote under a marker | new    | Uses `downloadToFile` (sha256, resume, stall timeout) and `extractZipWithTar`. Archives are deleted afterwards. A mismatch, a cancel or an interrupted extract leaves no folder; a promote failure leaves only the marker. |
| S08-4 | One install per backend; a second caller shares the first                                                                 | new    | Shared in-flight promise, tested with a server hit counter.                                                                                                                                                                |
| S08-5 | `delete(backend)` refuses while a file is held open                                                                       | new    | Probes every file first and throws `RuntimeInUseError`, removing nothing. The probe is injectable; the real one opens the file for read and write.                                                                         |
| S08-6 | `chooseBackend` and `backendFallbackChain` (core, pure)                                                                   | new    | NVIDIA: cuda12, vulkan, cpu. Other GPU with VRAM above 0: vulkan, cpu. Else cpu. `usesGpuOffload` is true for every backend but cpu.                                                                                       |
| S08-7 | `selectWorkingBackend`: install, self-test (`llama-server --version` exits 0), fall back cuda, vulkan, cpu                | new    | Install errors and cancels propagate; only a failed self-test moves down the chain. `failed` is returned so S11 can remember it for the session.                                                                           |

Decisions:

- cuda13 is chosen only when an injected `CudaDriverProbe` reports it (the chain is then cuda13, cuda12, vulkan, cpu). The default probe returns null, so cuda12 is used. No driver probe is written yet; nothing in this app reads the driver version.
- The marker is a sibling file (`cuda12.incomplete`), like the NeMo-Speech runtime, not a file inside the folder as in the spike, so removing the folder cannot lose it.
- macOS and Linux are out of scope: only Windows x64 archives are pinned.
- The spike's extracted folders under `C:/Code/vozella-spikes/llm/work/{cpu,cuda12,cuda13}` are for S09 and S11 integration tests only, selected by `VOZELLA_LLAMA_BIN_DIR` and skipped when absent. No test here downloads a real archive.
- Not observed: a real 287 MB download from GitHub, and the self-test on a real CUDA or Vulkan machine (the real `--version` run is only checked against `node --version`).

### llama-server sidecar and no-orphan kill (S09)

| #      | Item                                                                                          | Status | Notes |
| ------ | --------------------------------------------------------------------------------------------- | ------ | ----- |
| S09-1  | stack.md requirement "guaranteed no-orphan kill": Job Object with kill-on-close                | new    | `assignToKillOnCloseJob(pid)` in Rust (`job.rs`) puts the child in one process-wide job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The handle is never closed by us, so Windows kills the server when the main process dies, even on a hard kill. Observed: a Node owner killed with `taskkill /F` took the fake server and the real 1B server down (cuda12 and cpu) in under 5 s. |
| S09-2  | No-native fallback: watchdog                                                                   | new    | Fake-native builds, non-Windows, or a job that refuses the pid use a detached Node helper (`ELECTRON_RUN_AS_NODE`) that polls the parent every 500 ms and runs `taskkill /T /F` on the child. Observed with the fake server and with a parent pid that was killed. |
| S09-3  | Start: free loopback port, random 24-byte key per launch, args, cwd = exe folder, windowsHide  | new    | `-m --host 127.0.0.1 --port --api-key -c --no-webui -ngl`. `gpuLayers: 'auto'` sends `-ngl 999`; a number sends that count. GPU offload is new: the old app was CPU only. The key is scrubbed from diagnostics and error text. |
| S09-4  | Health wait and early exit                                                                     | new    | Polls `/health` (503 loading, 200 ready). Early exit throws `exited-early` with the output tail; a missing exe throws `spawn`; a slow load throws `health-timeout` and kills the process. Output ring buffer is 64k characters. |
| S09-5  | `chatStream`, `tokenize`, abort                                                                | new    | SSE `data:` lines become `{content, finishReason, usage}`. A cancel closes the request and throws `CancelledError`; the fake server saw the connection close. |
| S09-6  | `stop()`                                                                                      | new    | kill, wait up to 3 s, then `taskkill /T /F`; a synchronous kill also runs from `process.on('exit')`. |
| S09-7  | Idle timeout and one restart                                                                  | new    | Default 10 minutes, injectable. After an idle stop the next request starts the server again. A crash (found at the next request, or on a refused connection) restarts once; the second crash throws `crashed`. |

Decisions:

- The guard is tried in order: Job Object, then watchdog. `NativePorts.processJob` is undefined on the fake build, which selects the watchdog.
- The graceful `stop()` does not wait for the OS to reap the job; it waits for the process exit event.
- The before-quit hook is S15's: it must call `stop()` on the one sidecar S12 builds.
- Real runs used the spike folder (`VOZELLA_LLAMA_BIN_DIR=C:/Code/vozella-spikes/llm/work`, `VOZELLA_LLM_MODEL` set to the 1B Q4_K_M file). cuda12 offloaded 17/17 layers on the RTX 3070 (checked from `-lv 4` output). The tests skip with a console message when the variables are absent.
- Not observed: Electron main (not plain Node) as the owner; the packaged app; a machine where Electron is already inside a restrictive job.

### Local map-reduce (S10)

| #   | Item                                                                                           | Status | Notes |
| --- | ---------------------------------------------------------------------------------------------- | ------ | ----- |
| 33  | Constants: context 4096, final 1024, notes 640, margin 128, 64 parts, 8 merge passes, temp 0.3 | done   | Exported from `local-map-reduce.ts`. |
| 40  | Direct path when the full prompt fits at cap 1024                                              | done   | One call, raw text returned. |
| 41  | `NotesTooLong` before any inference when the empty-transcript prompt leaves less than 640     | done   | Test counts zero inference calls. |
| 42  | Part budget from the empty part prompt at cap 640                                              | done   | `BuildPartPrompt("", 64, 64, language)`. |
| 43  | More than 64 parts raises `TranscriptTooLong` with the count                                   | done   | Args `[n, 64]`, no inference. |
| 44  | Parts in order with cancel checks, 1-based numbering                                           | done   | |
| 45  | Merge passes, group budget from the empty merge prompt at cap 640, +2 per note, single pass-through | done | |
| 46  | No-progress stop and `CannotCondense`                                                          | done   | See the exhaustion decision. |
| 47  | Final prompt at 1024 after a cancel check                                                      | done   | |
| 48  | `splitToBudget` rules                                                                          | done   | |
| 49  | `splitLongLine`: binary search, whitespace in the second half, no split surrogate pair, progress | done | |
| 50  | Every prompt fits with the safety margin                                                       | done   | Property test, 40 seeded transcripts. |
| 51  | No transcript line or word lost                                                                | done   | Property test, words and characters with emoji. |

## Bugs fixed

- **B12** (S03): stderr is classified first; stdout only for CLI sentinel phrases; `model not found` and `404 Not Found` are not a missing program.
- **B28** (S03): errors carry a code and args; `formatFailure` localizes them with the catalog of the active locale.
- **B25** (S02): wrapping code fence, any header case and `**Action Items**` are accepted by the splitter.
- **B26** (S02): action items accept `-`, `*`, `+` bullets and flexible spacing, still need text after the box, and ignore numbered lists.
- **B10** (S02): Spanish auto titles (`Reunión {0}`) are placeholders when the catalog formats are supplied, so they are renamed on summarize.
- **B27** (S01): headings are keyed by language code, unknown codes fall back to Spanish on purpose and this is documented and tested against `SUMMARY_LANGUAGES`.
- **B30** (S04): model and effort are validated and passed as separate argv items; no shell string is ever built.
- **B11** (S05): the resolved path is launched; `.cmd`/`.bat` go through an explicit cmd.exe wrapper with quoted arguments and no user text in a shell string.
- **B24** (S05): stdin is UTF-8 with no byte order mark, tested on the fake child.
- **B17** (S06): a failed hardware read is not cached for the process; the rating can ignore VRAM when the runtime has no GPU backend.
- **B18** (S06): pinned byte size (and SHA-256 for the 1B file) verified before the atomic move; "downloaded" needs the pinned size; resume by Range; one transfer per model shared by every caller.
- **B20** (S06): catalog labels are keys, asserted by a test.
- **B1, B14, B22, B23, B29** (S07): dropped with the xAI provider, reason: owner decision 2026-11-03, may return later. B22 for `settings.json` was already done by the settings module's atomic write; the xAI credentials file and the custom template file are no longer written by this app.
- **S08**: no numbered bug. The spike's marker inside the folder, its missing resume and its unchecked cancel are replaced by the sibling marker, `downloadToFile` and cancel cleanup.
- **S09**: no numbered bug. The spike's `stop()` and `taskkill` fallback are kept; the missing orphan guarantee, the unbounded output buffer and the key in the argument list of error text are replaced as above.
- **S10**: no numbered bug. The map-reduce ported as specified; the English error strings became codes (B28) and the cancel signal reaches every inference call.
- **B31** (S04): not fixed on purpose. Kept for parity and recorded; timeout is injectable.

## Left for other modules

- S13 must pass the `MeetingTitleFormat` values of every catalog to `placeholderPatternsFromFormats` and use `splitSummaryResponse`, `resolveTitle` and `titleFromModelResponse`; S14 copy uses `renderActionItems`.
- S04 and S11 must run `describeSummaryProviderContract` against their providers; S04 builds on `runRequiredStdout` and implements S05's runner against `CliProcessRunner`. S05 must throw `CliTimeoutError` on timeout and a `CancelledError` on cancel, and let spawn errors keep their `code`.
- S10 and S11 throw `SummaryError` (`LocalModelMissing`, `LocalEmpty`, `NotesTooLong`, `TranscriptTooLong` with `[parts, 64]`, `CannotCondense`) instead of English messages. S13 and S14 show failures with `formatFailure`.
- Pending-real-validation: none for S03; the classification keyword lists were not checked against real CLI output.
- S05's runner must accept an argv array, write stdin as UTF-8 without BOM, and implement `isOnPath` and the launch of the resolved path (B11). S12 builds providers with `createClaudeCodeProvider` and `createCodexProvider` from the resolved model and effort. The live-answer path (chat module) uses the `...WebSearchProvider` factories. S13 shows `InvalidCliOptionError` text as a plain error.
- S12 builds `new NodeCliProcessRunner()` (exported from `@vozella/platform`) and gives it to the CLI providers; S19's CLI check can use `isOnPath`. Real CLI flags and a real `.cmd` install of claude/codex stay pending-real-validation.
- Token budgeting that uses the part and merge prompts: S10.

- S06 to S12: pass `{ gpuOffload }` from the chosen llama backend (S08) to `rateFor` and `LocalModelsService.rows`; the Settings page and the wizard (S18) both call the one `LocalModelsService` so they share its in-flight map. Hashes for the three Gemma files are not pinned.

- S12 and the generation gate: `isProviderAvailable(kind)` is false for `Xai`. The gate and factory must report the removed provider (offer the Settings page, text `Ui_SummaryProviderXaiRemoved`) and never build the Local provider for it. `AvailableSummaryProviderKind` is the type to switch on.
- S18 and S19: the wizard and CLI setup must not offer Grok; `Setup_XaiName` and `Setup_XaiHint` are unused catalog keys.
- Final review: `scripts/convert-strings.mjs` could take an exclusion list so the unused `Xai*` keys leave `en.json` and `es.json` (see the S07 decisions).

- S09 and S11: take `exe` and `binDirectory` from `LlamaRuntimeManager` / `selectWorkingBackend`, spawn with cwd = bin directory, and pass `usesGpuOffload(backend)` to S06's `rateFor`. Integration tests read `VOZELLA_LLAMA_BIN_DIR` and skip when absent.
- S12 and S18: construct `new LlamaRuntimeManager({ root: <app data>/LlamaRuntime })`, call `selectWorkingBackend` with the hardware profile, and decide where the install progress shows. A `CudaDriverProbe` is optional.
- Real GitHub download of the pinned archives is pending-real-validation.

- S09: S11 owns one `LlamaSidecar` per app, with `createProcessGuard(nativePorts.processJob)`; it calls `start()` lazily and uses `tokenize` for budgets. S15 wires `app.on('before-quit')` to `sidecar.stop()`. Production code must not pass `argsPrefix`.
- S11: build one `TokenCounter` from `sidecar.tokenize` (BOS added, special tokens parsed) and an `InferFunction` over `chatStream` that concatenates, trims and throws `LocalEmpty` on empty output; pass the cancel signal through. Call `splitSummaryResponse` on the returned text. Item 53 (budgeting title and prompt calls, B8) is S11's.

## Dropped by the owner

Reason for every row: owner decision 2026-11-03, may return later. Auditors: these are not missing.

| Item                                                                                                                                                                                                            | Status  | Reason                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------- |
| JEV/TypeSafe: API client, credentials, post-summary analysis, the "What do I need to do" dialog, settings section, automatic live-question detection, armed questions that depend on it, Jev needs-web judgment | dropped | owner decision 2026-11-03, may return later |
| Calendar: Coming up, reminder toasts, event-started takes, event metadata linking, Calendar settings, pre-meeting brief                                                                                         | dropped | owner decision 2026-11-03, may return later |
| xAI/Grok provider: OAuth, API key, credential store, settings expander (an existing `Xai` selection still loads and asks for another provider; see S07)                                                         | dropped | owner decision 2026-11-03, may return later |
| Suggest-title button                                                                                                                                                                                            | dropped | owner decision 2026-11-03, may return later |
| Custom note template                                                                                                                                                                                            | dropped | owner decision 2026-11-03, may return later |
| Nav-pane resize grip                                                                                                                                                                                            | dropped | owner decision 2026-11-03, may return later |
| Meeting-app suggestion bar on Record                                                                                                                                                                            | dropped | owner decision 2026-11-03, may return later |
| Chat thread history and user recipes                                                                                                                                                                            | dropped | owner decision 2026-11-03, may return later |

On-disk compatibility still applies: `typeSafeEnabled`, calendar settings, Jev frontmatter, event frontmatter keys and the Brief section of existing meetings are read and rewritten without loss.

## Dead code in the WinUI app, never ported

`LiveQuestionDetector`, `MeetingJevAsk.AskAsync`, transcript polish, `PcmLevelNormalizer`, `ClockSkew`, `FinishAndDrain`, `Recognize`, and unused resource keys. Status: dropped, reason: owner decision 2026-11-03, may return later.
