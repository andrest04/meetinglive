# Parity ledger: summaries

Spec: `docs/port/specs/summaries.md`. Section 8 is the checklist; each package appends its rows under its own heading and never reorders earlier ones.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending-real-validation`.

## Where things are

| Concern | Code |
| --- | --- |
| Summary, title, part and merge prompt builders; enhancement context; language names and headings (S01) | `packages/core/src/summaries/prompt-builders.ts` (tests beside it) |

## Decisions

- **Newlines (S01).** Prompts and enhancement blocks use LF only. CRLF inside notes, agenda and template text is converted to LF. The WinUI app used the platform newline (CRLF on Windows) and indented the enhancement tags with 12 spaces; both were artefacts of the C# raw string literals and the model ignores them. The tag lines now start at column 0.
- **Enhancement layout (S01).** Taken from the C# source, not the prose summary: the rules text follows the main prompt after one newline, and every block is a newline, `<tag>`, the trimmed value, `</tag>`, then a newline. So blocks are separated by a blank line and the whole suffix ends with a newline, as in the original.
- **Dates (S01).** `recordedAt` and `endedAt` are `OffsetDate` values (see `library/offset-date.ts`) and are written with `formatOffsetDate(..., 'round-trip')`: seven fraction digits and a numeric offset.
- **Headings by language code (S01, B27).** `SUMMARY_HEADINGS` is keyed by language code and only `es` and `en` are populated, which are exactly the codes the Settings picker offers (`SUMMARY_LANGUAGES`). A test fails if the picker gains a code without headings. Other codes still fall back to Spanish headings and examples while the body language name follows `toEnglishLanguageName`, as in the WinUI app.
- **fr and de (S01).** Not localized. They are not offered in the picker, and a saved `fr` or `de` is reachable only by editing `settings.json`. Such a file still gets a prompt that asks for French or German text under Spanish subheadings, exactly like WinUI. If either is added to the picker later, add a headings entry first; the test enforces it.
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

## Bugs fixed

- **B27** (S01): headings are keyed by language code, unknown codes fall back to Spanish on purpose and this is documented and tested against `SUMMARY_LANGUAGES`.

## Left for other modules

- Splitter, action item parser and title normalization: S02.
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
