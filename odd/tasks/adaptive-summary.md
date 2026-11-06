# Feature: Adaptive summary structure

## Objective
The AI summary infers what the recording is (meeting, class, talk, podcast, interview, tutorial, YouTube video…) and picks the structure that serves it best, instead of a fixed meeting template.

## Problem / why
`buildSummaryPrompt` (`packages/core/src/summaries/prompt-builders.ts`) forces four fixed `###` subheadings (What this was / Key points / Decisions / Open questions). Non-meeting content gets flattened into bullets and loses concepts, steps, arguments and quotes. Map-reduce part/merge prompts keep only points, decisions, questions and tasks, so long recordings lose that content before the final step.

## Approach (approved by the user 2026-11-05)
1. Summary body opens with a 1–2 sentence gist (chat reads only the first 800 chars).
2. The model infers the content type and chooses its own `###` sections, written in the output language (examples: meeting → decisions/topics/open questions; class → key concepts with explanation, examples, what to review; talk/podcast/interview → thesis, arguments, notable quotes, takeaways; tutorial → goal, numbered steps, tips/pitfalls).
3. Group by topic, not chronology; each section cites its time range.
4. Use formats the renderer supports: numbered lists, tables, blockquotes. No checkboxes in the body (splitter falls back to the first checkbox; renderer has no task lists).
5. A selected note template overrides the inferred structure.
6. `## Action Items` only for real tasks; empty is fine.
7. Part/merge prompts keep type-relevant material (concepts, steps, arguments, quotes) and the content type.

## Constraints
- Keep `## Title`, `## Summary`, `## Action Items` headings (parser, title, storage depend on them).
- Never emit the 8 meeting-file `##` headers inside the summary.
- Keep the prompt compact: local model has 4096 context (final step budget 4096 − 1024 − 128).
- Spec `docs/port/specs/summaries.md` §3.1/§3.5 and full-text prompt tests change with it.

## Delivery strategy
`exception-ok`: local merge into `main`, no PRs. Forecast ~350 authored lines. RDD off (global).

## Tasks
- [x] T1 — Rewrite summary, part and merge prompts + template override; update prompt tests (RED first) and the spec doc. Route: delegated (prompt-builders.ts + tests + spec; preparation reading).

## Acceptance criteria
- Prompt asks for gist first, inferred `###` sections in output language, topic grouping with time ranges, renderer-safe formats, no body checkboxes, template override.
- Contract headings unchanged; splitter and provider-contract tests stay green.
- Part/merge prompts preserve content type and type-relevant material.
- Final local map-reduce prompt still fits the budget (local-map-reduce/local-prompt-budget tests green).

## Checks
- `pnpm --filter @vozella/core test`, `pnpm --filter @vozella/platform test` (known unrelated B18 failure), `pnpm --filter @vozella/desktop test`, `pnpm typecheck`.

## Progress / evidence
- T1 (delegated writer, 2026-11-05) — implementation done, commit pending; NOT ticked: `cli-providers.test.ts` (outside the T1 edit surface) still asserts the removed `### Key points` / `### Puntos clave` subheadings (2 failures).
  - RED: 15 failing in `prompt-builders.test.ts` after the test rewrite; GREEN: 40/40.
  - Prompt chars (empty transcript/part): summary en 2647→2956 (+11.7%), es 2661→2965 (+11.4%); part 758→860 (+13.5%); merge 427→463 (+8.4%).
  - Spec §3.1/§3.5 updated with a divergence note; spec blocks mechanically compared equal to code output.
  - Checks: core 1689 pass / 2 fail (cli-providers, above); platform 1 fail (known B18); desktop 2059 pass; typecheck pass; prettier/eslint clean on touched TS.

- Parent updated the two `cli-providers.test.ts` assertions; core rerun 1691/1691 pass. T1 done.

## Next step
Try it on a real recording (CLI and local provider) and compare against an old summary.
