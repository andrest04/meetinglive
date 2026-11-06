# Feature: AI chat polish (gaps found while building phases 2-5)

## Objective
Close the known rough edges in the AI panel so it holds up against Notion AI, Granola and Fireflies in daily use.

## Why
Each phase left a small, recorded gap (handoffs of phases 2-5, 2026-11-05/06). None blocks the feature, but together they make the chat feel less reliable than the competitors.

## Scope
1. Images are dropped when a CLI engine falls back from streaming to the one-shot path; they must be passed there too.
2. Codex `-i` breaks when an image path contains a comma; pass paths so a comma cannot split them (one `-i` per image, or copy to a safe temp name).
3. PDF parsing runs on the Electron main thread; a large PDF can freeze the UI. Move extraction off the main thread (worker thread or utility process) or, at minimum, yield between pages; keep the limits.
4. The Live badge keeps pulsing while the recording is paused; show a static dot (and paused label) when paused.
5. The rolling digest can run while the local engine streams a chat answer and compete for the same model; skip or delay the digest while a local chat answer is in flight.
6. When a send with a saved prompt's engine fails, the text comes back but the engine is no longer armed; keep it armed.
7. If Undo after "apply to summary" fails, the kept copy is lost; keep it and show an error.
8. Check that finishing the setup gate for a saved prompt's engine does not change the default engine in Settings; fix if it does.

## Constraints
- Test-first where a deterministic test exists. No sound through speakers. Overnight run: windows allowed for e2e.
- Generated artifacts in English.

## Delivery strategy
`exception-ok`, local merge into main. RDD off.

## Tasks
- [x] T1 — Items 1-8 with tests. Route: delegated (writer trigger: non-trivial changes across core, platform, main and renderer). Commit pending (parent).

## Acceptance criteria
- Each item has a test that fails before and passes after (or a recorded reason when not testable).
- Core, contracts, platform (except known B18), desktop unit tests pass; `pnpm typecheck`, prettier, eslint clean; affected e2e pass.

## Progress / evidence
T1 (writer, 2026-11-06). RED observed before each fix, GREEN after.
1. Images on the one-chunk path: `CliToolProvider.run` takes the send's images (`IMAGE_FORMATS` split from `STREAM_FORMATS`); `CliProcessRunner.run`/`runRequiredStdout` accept `{ cwd }`. Tests: `cli-providers.test.ts` "keeps the attached images on the one-chunk path" (Claude, Codex), summaries carry none. RED 2 fails -> GREEN.
2. Codex comma: `codexImageInvocation` keeps absolute `-i` paths unless one has a comma; then Codex runs in the image folder with bare (store-sanitized, comma-free) names. Test: "Codex reads images from a folder with a comma by name". RED (threw) -> GREEN.
3. PDF off the main thread: `packages/platform/src/chat/document-extraction.ts` (`createThreadedDocumentExtractor`, `serveDocumentExtraction`), one `worker_threads` worker per PDF/DOCX/PPTX, text inline, 2 min timeout, failures -> `unreadable`. Store takes `extractor`; main wires `new Worker(out/main/workers/extract.js)` (entry `src/main/chat/extract-worker.ts`, electron-vite input `workers/extract`). Limits unchanged (bytes checked by store, `maxChars` passed). Tests: `document-extraction.test.ts` (6), store "hands documents to the injected extractor". Real bundle covered by e2e `chat-attachments` (PDF read back). Exported via `attachment-store.ts` re-export because `packages/platform/src/index.ts` was outside the edit surface.
4. Live badge paused: `use-recording-paused.ts` follows `recording.state`; `LiveBadge` gets `paused` (Pulse inactive) and `Ui_ChatLivePaused` (Paused / En pausa). Test: `AiPanel.test.tsx` "a paused recording shows a still dot and the paused label". RED -> GREEN.
5. Digest vs local chat: `ChatService.localAnswerInFlight`; main `localModelLoaded` dep of `LiveAsk` now also requires no local chat answer streaming, so the digest skips that update (retries next interval). Test: `chat-service.local-busy.test.ts` (3). Wiring in `index.ts` only (`main/recording/live-ask-handlers.ts` was outside the surface; existing test covers "not loaded -> no digest").
6. Engine re-armed after a failed send: `useChat.send` resolves `answered | restored | ignored`; `ChatBody.sendWith` re-arms the recipe on `restored`. Tests: `SavedPrompts.test.tsx` (menu pick and chip). RED -> GREEN.
7. Failed Undo keeps the copy: `applied` notice carries `undoError`; error notice keeps Undo for a retry. Test: `ChatBody.test.tsx` "a failed Undo keeps the previous content". RED -> GREEN.
8. Checked: YES it changed Settings. `summaries-controller.ts` `chooseCli` / `chooseLocalModel` save `selectedSummaryProvider` when the gate finishes. Fix in `use-chat.ts`: for a send with a prompt engine, read the default before the gate and put it back after (null stays null); normal sends unchanged. Test: `use-chat.engine-gate.test.tsx` (3). RED 2 fails -> GREEN. A cleaner main-side fix (a keep-default flag on chooseCli/chooseLocalModel) needs files outside this surface.

Checks: core 2025 passed; contracts 62 passed; platform 520 passed, 1 failed (B18 known); desktop 2251 passed, 1 failed in full run (`notepad-markdown` idempotence hit the 5 s timeout under load, untouched; 106/106 passed alone); `pnpm typecheck` clean; prettier and eslint clean on touched code and JSON (`docs/port/specs/chat.md` is not prettier-clean on base, CRLF and table widths, so it got a minimal 2-line edit instead of a reflow); `pnpm build` ok (`out/main/workers/extract.js`); e2e visible chat-attachments, chat-saved-prompts, chat-panel, live-questions: 17 passed, 1 skipped (opt-in screenshots). No Electron left running.

## Next step
Parent commits T1 on `fix/chat-polish`.
