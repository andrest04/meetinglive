# Parity ledger: summaries

Spec: `docs/port/specs/summaries.md`. Section 8 is the checklist; each package appends its rows under its own heading and never reorders earlier ones.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`.

## Where things are

| Concern | Code |
| --- | --- |
| Summary, title, part and merge prompt builders; enhancement context; language names and headings (S01) | `packages/core/src/summaries/prompt-builders.ts` (tests beside it) |
| Response splitter (S02) | `packages/core/src/summaries/summary-splitter.ts` |
| Action item parser and renderer (S02) | `packages/core/src/summaries/action-items.ts` |
| Title normalization and placeholder check (S02) | `packages/core/src/summaries/suggested-title.ts` |
| Provider port, result, default stream, cancellation (S03) | `packages/core/src/summaries/provider.ts` |
| Provider contract test helper, reused by S04 and S11 (S03) | `packages/core/src/summaries/provider-contract.ts` (`describeSummaryProviderContract`, not exported from the index) |
| CLI failure classification, sanitizer, `CliToolError`, `runRequiredStdout`, `CliProcessRunner` port (S03) | `packages/core/src/summaries/cli-failure.ts` |
| Failure codes, key maps, `formatFailure` (S03) | `packages/core/src/summaries/cli-failure-messages.ts` |
| CLI argv builders, B30 validation, legacy string form (S04) | `packages/core/src/summaries/cli-invocation.ts` |
| CLI provider base, Claude Code and Codex providers, web-search factories (S04) | `cli-provider.ts`, `claude-code-provider.ts`, `codex-provider.ts` |
| `FakeCliProcessRunner` test double (S04) | `packages/core/src/summaries/test-kit.ts` (not exported from the index) |
| Node CLI process runner, `.cmd` wrapper, tree kill (S05) | `packages/platform/src/summaries/cli-process-runner.ts`; fake CLI fixture `fake-cli-fixture.ts` |
| PATH lookup with `resolve()` (S05, shared with Settings) | `packages/platform/src/settings/path-cli-probe.ts` |
| Catalog key parity test (S03) | `apps/desktop/src/main/summary-failure-catalog.test.ts` |

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

## Parity items

### Prompts (S01)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 7 | Summary prompt matches 3.1 verbatim, with U+2013 in "3–8" | done | Exact-text snapshot test; dash checked on its own. |
| 8 | Language name mapping | done | Blank and unknown give Spanish; trim and lowercase. |
| 9 | Subheadings and examples English only for `en` | done | Trimmed, case-insensitive. |
| 10 | `<ended_at>` only when an end time exists, round-trip form | done | Test for both cases, plus the never-say-not-recorded rule. |
| 11 | `<recorded_at>` always, round-trip form | done | Seven fraction digits and offset. |
| 12 | Enhancement suffix only when something is present | done | Blank notes, agenda, instructions and blank-only attendees add nothing. |
| 13 | Rules text; raw-notes line only with raw notes | improved | LF and no indentation (see Decisions). |
| 14 | Block order, trimming, attendee join | improved | LF and no indentation. |
| 15 | Title-only prompt matches 3.2 verbatim | done | Snapshot test. |
| 16 | Part prompt matches 3.5 verbatim | done | Snapshot test; used by S10. |
| 17 | Merge prompt matches 3.5 verbatim | done | Snapshot test; used by S10. |

### Splitter, parser and titles (S02)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 18 | CRLF to LF | done | Tested. |
| 19 | Title block joined by a space, null when empty or absent, not normalized | done | Quotes kept for `normalizeTitle`. |
| 20 | Action section at the first action header, else first checkbox line | improved | Header case and bold form (B25). |
| 21 | No action section and no checkbox: whole reply is summary | done | |
| 22 | Title block removed, leading `## Summary` dropped, trimmed | done | Summary header is case-insensitive. |
| 23 | Item rules per 3.4 | improved | B26. |
| 24 | Text trimmed, done for x and X | done | |
| 25 | Render `- [x] text
`, empty for none | done | Round-trip test. |
| 26 | Splitter tolerates fences and header case | improved | B25. |
| 27 | `normalizeTitle` per 3.8 | done | All listed cases. |
| 28 | `titleFromModelResponse`, heading-only gives null | done | |
| 29 | `resolveTitle` replaces only placeholders, blank counts | done | |
| 30 | Every localized auto title recognized | improved | B10, patterns passed as data. |

### Provider port and failures (S03)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 1 | `SummaryProvider` port with summarize, suggestTitle, completePrompt, streamPrompt | done | Cancel is a `CancelSignal`. |
| 2 | `SummaryResult` shape | done | |
| 3 | Suggested title from the same response, no second inference | done | Contract test counts model calls. |
| 4 | `streamPrompt` default yields one chunk; chunks concatenate to the answer | done | `withDefaultStream` and the contract test. |
| 5 | `ProviderId` is local, claude-code, codex | improved | xAI dropped (S07). |
| 6 | Every provider uses the shared builders and splitter | done | `describeSummaryProviderContract`; S04 and S11 must call it. |
| 72 | Classification order and keyword lists | improved | B12. |
| 73 | Kind to message key with display name | done | `CLI_FAILURE_UI_KEYS`, `CLI_FAILURE_CORE_KEYS`. |
| 74 | Unknown appends a sanitized snippet, never the exit code | done | |
| 75 | Redaction pattern and 120 character cap | done | |
| 76 | UI mapping to `Error_Cli*`; other errors show their message | done | |
| 77 | Error text localized in the UI layer | improved | B28, new `Ui_Summary*` keys. |
| 188 | Six `CliFailure*` and the `ModelSpeed/Quality/UseCase` keys in both catalogs | done | Parity test. |

### CLI providers (S04)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 55 | Executables `claude`/`codex`, display names, 5 minute timeout | done | Timeout injectable (B31). |
| 56 | Claude argv order `-p`, `--model`, `--effort`, tools | improved | Array form; each part only when set; legacy string kept (B30). |
| 57 | Codex argv `--search` before `exec -`, `-m`, `-c model_reasoning_effort="..."` | improved | Array form (B30). |
| 59 | Not on PATH gives NotInstalled before spawn | done | Tested with the fake runner: no spawn. |
| 60 | Non-zero exit classified; empty stdout EmptyOutput | done | Via `runRequiredStdout`. |
| 61 | Cancellation never wrapped | done | Tested. |
| 62 | Other errors wrapped by kind | done | Runner timeout gives TimedOut. |
| 70 | B30 model and effort validated, argv items | improved | See Decisions. |
| 71 | Web search variants only for live answers | done | Explicit factories. |

Contract: both providers run `describeSummaryProviderContract`. Ported tests: CliInvocationTests (6 cases), CliToolProviderBaseTests and both provider test classes (`cli-invocation.test.ts`, `cli-providers.test.ts`). Items 58, 63 to 69 belong to S05.

Pending-real-validation: S04 ran only against `FakeCliProcessRunner`. The real `claude` and `codex` flags (`--effort`, `--tools`, `--allowedTools`, `--search`, `-c model_reasoning_effort`) were not run against the installed CLIs.

### CLI process runner (S05)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 58 | Stdin written as UTF-8 bytes, no BOM, flushed and closed | done | First bytes checked on the fake child. |
| 63 | `isOnPath`: PATH split, blank entries skipped, PATHEXT default `.EXE;.CMD;.BAT` | done | Shared `PathCliProbe`. |
| 64 | `resolveExecutable` returns the full path | improved | New `resolve()`; the resolved path is what is launched (B11). |
| 65 | Stdout, stderr, stdin write and exit awaited together under one deadline | done | 4 MB prompt echoed back, no deadlock. |
| 66 | Closed stdin is "not delivered"; success with undelivered stdin throws, non-zero returns | done | Node reports the closed pipe as an EOF error in the end callback, which counts as not delivered. |
| 67 | Spawn ENOENT becomes a not found error (`code` kept) | done | Classified NotInstalled. |
| 68 | Timeout kills the tree and throws `CliTimeoutError` | done | `taskkill /T /F` on Windows, process group elsewhere. Pid asserted gone, also for a `.cmd`. |
| 69 | Cancellation kills the tree and rethrows `CancelledError` | done | Also while stdin is blocked. |

Real `claude` and `codex` invocation: pending-real-validation.

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
- **B31** (S04): not fixed on purpose. Kept for parity and recorded; timeout is injectable.

## Left for other modules

- S13 must pass the `MeetingTitleFormat` values of every catalog to `placeholderPatternsFromFormats` and use `splitSummaryResponse`, `resolveTitle` and `titleFromModelResponse`; S14 copy uses `renderActionItems`.
- S04 and S11 must run `describeSummaryProviderContract` against their providers; S04 builds on `runRequiredStdout` and implements S05's runner against `CliProcessRunner`. S05 must throw `CliTimeoutError` on timeout and a `CancelledError` on cancel, and let spawn errors keep their `code`.
- S10 and S11 throw `SummaryError` (`LocalModelMissing`, `LocalEmpty`, `NotesTooLong`, `TranscriptTooLong` with `[parts, 64]`, `CannotCondense`) instead of English messages. S13 and S14 show failures with `formatFailure`.
- Pending-real-validation: none for S03; the classification keyword lists were not checked against real CLI output.
- S05's runner must accept an argv array, write stdin as UTF-8 without BOM, and implement `isOnPath` and the launch of the resolved path (B11). S12 builds providers with `createClaudeCodeProvider` and `createCodexProvider` from the resolved model and effort. The live-answer path (chat module) uses the `...WebSearchProvider` factories. S13 shows `InvalidCliOptionError` text as a plain error.
- S12 builds `new NodeCliProcessRunner()` (exported from `@vozella/platform`) and gives it to the CLI providers; S19's CLI check can use `isOnPath`. Real CLI flags and a real `.cmd` install of claude/codex stay pending-real-validation.
- Token budgeting that uses the part and merge prompts: S10.

## Dropped by the owner

Reason for every row: owner decision 2026-11-03, may return later. Auditors: these are not missing.

| Item | Status | Reason |
| --- | --- | --- |
| JEV/TypeSafe: API client, credentials, post-summary analysis, the "What do I need to do" dialog, settings section, automatic live-question detection, armed questions that depend on it, Jev needs-web judgment | dropped | owner decision 2026-11-03, may return later |
| Calendar: Coming up, reminder toasts, event-started takes, event metadata linking, Calendar settings, pre-meeting brief | dropped | owner decision 2026-11-03, may return later |
| xAI/Grok provider: OAuth, API key, credential store, settings expander (an existing `Xai` selection still loads and asks for another provider; see S07) | dropped | owner decision 2026-11-03, may return later |
| Suggest-title button | dropped | owner decision 2026-11-03, may return later |
| Custom note template | dropped | owner decision 2026-11-03, may return later |
| Nav-pane resize grip | dropped | owner decision 2026-11-03, may return later |
| Meeting-app suggestion bar on Record | dropped | owner decision 2026-11-03, may return later |
| Chat thread history and user recipes | dropped | owner decision 2026-11-03, may return later |

On-disk compatibility still applies: `typeSafeEnabled`, calendar settings, Jev frontmatter, event frontmatter keys and the Brief section of existing meetings are read and rewritten without loss.

## Dead code in the WinUI app, never ported

`LiveQuestionDetector`, `MeetingJevAsk.AskAsync`, transcript polish, `PcmLevelNormalizer`, `ClockSkew`, `FinishAndDrain`, `Recognize`, and unused resource keys. Status: dropped, reason: owner decision 2026-11-03, may return later.
