# Feature: Chat speed, full context and citations (Phase 2 of the AI panel plan)

## Objective
Make the AI panel fast and trustworthy: real token streaming on every engine, the whole meeting in context (not the last 6000 chars), answers that cite transcript moments you can click, and a way to apply an answer to the summary.

## Problem / why
- CLI engines spawn one process per message and return the whole answer as one chunk (`packages/core/src/summaries/provider.ts:73-80`).
- Meeting scope sends only the last 6000 transcript chars (`packages/core/src/chat/context-packer.ts:8,177`); a question about minute 10 of a 38-min video has no evidence.
- Local llama runs with `cachePrompt: false` (`packages/platform/src/llama/local-llm-provider.ts:137`).
- No citations; the prompt does not set the answer language.

## Approach
- Verified on this machine (2026-11-05): `claude` 2.1.318 supports `-p --output-format stream-json --verbose --include-partial-messages`; `codex-cli` 0.164.0 supports `exec --json` (JSONL events) and `-i/--image`.
- Streaming runner variant that yields stdout lines; JSON event parsers per CLI; fall back to one chunk on parse failure.
- Context: CLI engines get the full transcript (cap ~120k chars); local engine gets summary + notes + BM25-ranked ~90s excerpts + recent tail within its 4096 budget.
- Citations `[mm:ss](vozella://t/<meetingId>/<seconds>)`, opened by `use-chat-links.ts` into the meeting Transcript at that line, with play from that second.
- "Apply to summary" on an answer, with confirm and undo.

## Delivery strategy
`exception-ok`; branch `feat/chat-speed-citations` stacked on `feat/ai-side-panel` (unmerged). RDD off. Forecast ~1200 lines across 4 tasks. **E2E runs only at the end, when the user says so** (no app windows while they game).

## Tasks
- [x] T1 — Real streaming for Claude Code and Codex chat (runner variant, event parsers, fallback, timing logs). Route: delegated.
- [x] T2 — Full-meeting context: full transcript for CLI engines, BM25 excerpts for local, `cachePrompt: true` for chat, answer in UI language. Route: delegated.
- [ ] T3 — Citations: prompt contract, link scheme, open transcript at line + play. Route: delegated.
- [ ] T4 — Apply answer to summary (confirm + undo). Route: delegated.
- [ ] T5 — Run all chat/shell e2e incl. Phase 1 pending (`record-idle.spec.ts` fix), with the user's go-ahead. Route: delegated.

## Acceptance criteria
- First tokens appear progressively on Claude Code and Codex; cancel still kills the process tree.
- Asking about minute 10 of a 38-min meeting returns grounded content with a citation.
- Clicking a citation opens the transcript at that line; play starts there.
- Local engine stays within budget (no PromptTooLong on a 38-min meeting).
- Answers come in the UI language unless the user writes in another language.

## Checks
`pnpm typecheck`, `pnpm --filter @vozella/core test`, `pnpm --filter @vozella/platform test` (known B18 failure), `pnpm --filter @vozella/desktop test`, e2e at T5 only.

## Progress / evidence
### T1 (implemented, commit pending; route: delegated writer)
- Runner: `NodeCliProcessRunner.runLines` (same spawn as `run`, idle timeout reset per line, cancel/timeout/early-break kill the tree, `CliExitError` with 8 KB stderr tail). Port `CliLineRunner` + `CliExitError` live in `core/summaries/cli-provider.ts` (cli-failure.ts was outside the edit surface); `run` behavior unchanged.
- Parsers (`cli-stream-parsers.ts`): Claude `stream_event/content_block_delta/text_delta` of the main agent, `result` as final or error (`is_error`); Codex `item.updated`/`item.completed` `agent_message` growth, `turn.failed` as error (inner API message). Fixtures: real Claude capture, real Codex error capture, hand-written Codex success (every Codex model failed with `model_not_found` on this account).
- Provider: `streamPrompt` = argv + stream flags (`claudeStreamArgs`/`codexStreamArgs`), deltas yielded as they come; no deltas → final text; no JSON at all → plain stdout as one chunk; `completePrompt` untouched. Runners without `runLines` keep the one-chunk path.
- Chat: `ChatServiceDeps.logger?` gets `chat answer streamed {firstChunkMs,totalMs,chunks,chars}`. Not yet wired in `apps/desktop/src/main/index.ts` (outside the edit surface).
- RED observed: parser tests (module missing), runner `runLines` tests (7 failing), chat timing tests (2 failing). Provider/invocation tests were written before the code but not run RED separately.
- Checks (2026-11-05): core 1770/1770; platform 473 pass + known B18 failure; desktop 2117 pass + known notepad-markdown flake (passes alone); `pnpm typecheck` clean; prettier + eslint clean on touched files. Manual headless run vs real `claude` (haiku): 12 chunks, first chunk 17.2 s, total 22.3 s (one-shot 22.0 s); startup dominates (user-level hooks/MCP on this machine).

### T2 (implemented, commit pending; route: delegated writer)
- Retrieval (`core/chat/transcript-retrieval.ts`, pure): ~90 s windows from `[mm:ss.ff-mm:ss.ff]` stamps (1500-char windows when unstamped), BM25 (k1 1.2, b 0.75) over `foldText` tokens minus es+en stopwords, best windows in time order under `[mm:ss–mm:ss]`, always the last ~1500 chars.
- Packer: `packContext(..., { budget, query })`; `contextBudgetFor(id)`: CLI live 20k / meeting 120k / folder summary 2000; local (or unknown) 2500 / 6000 / 800. Meeting: summary ≤30 %, notes ≤10 %, whole transcript if it fits, else `Transcript excerpts (partial; ... say so):` + excerpts.
- Service: provider resolved before packing (B5 kept: scope + live snapshot still copied at send start); query = message + last user turn; `ChatServiceDeps.uiLanguage` (wired `() => locale.tag` in desktop main). Prompt gets the answer-language rule before `Scope:`; content recipes say "Answer in the app language."
- Local: `cache_prompt: true` for `streamPrompt` only (chat + live ask share it); `completePrompt`/summaries stay false.
- RED observed: retrieval (module missing), packer budgets (7 failing), service T2 + S8 update (5 failing), prompt-builder (parse/new export), platform cachePrompt (1 failing). Recipes test/text changed together (string swap).
- Checks (2026-11-05): core 1793/1793; platform 473 pass + B18 + `transcription-platform` Range-download test (passes alone, 31/31: load flake); desktop 2118 pass; `pnpm typecheck` clean; prettier + eslint clean on touched files. E2E skipped (user request).

## Next step
Commit T2; then T3 (citations).
