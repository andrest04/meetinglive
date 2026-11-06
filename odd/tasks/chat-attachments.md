# Feature: Attach files to the AI chat (Phase 3 of the AI panel plan)

## Objective
Let the user attach documents (PDF, DOCX, PPTX, TXT/MD/CSV) and images to the AI panel so answers combine the meeting with those files, like Notion AI and Fireflies.

## Why
Notion AI accepts PDFs/images/Office files in its chat; Fireflies answers from an uploaded knowledge base. Vozella's chat accepted only text (`ChatStreamProvider.streamPrompt(prompt)`), with no parsing dependencies.

## Approach
- Pick in main (`dialog.showOpenDialog`) or drop onto the panel; main remembers paths, the renderer only gets opaque ids (pattern from `packages/contracts/src/audio.ts:155-188`).
- Extraction in main: TXT/MD/CSV direct; PDF `pdfjs-dist`; DOCX `mammoth`; PPTX `jszip` + slide XML. Images: Codex `-i <path>`, Claude via a temp copy read by the Read tool; local engine says images are not supported.
- Extracted text goes through `neutralizeStructure` and the BM25 retrieval when large; answers cite "file, page/slide N".
- Attachments live per conversation (chips above the composer), not in the meeting `.md`.

## Delivery strategy
`exception-ok`, local merge. RDD off. Overnight autonomous run authorized (windows OK, no sound).

## Tasks
- [x] T1 — Attach pipeline: contracts, main picker + drop, extraction, packing, provider image args, composer chips; tests + e2e. Route: delegated (writer trigger: 2+ non-trivial files across contracts, core, platform, desktop). Implemented and verified; commit pending (parent).

## Acceptance criteria
- Attach a PDF, DOCX, PPTX and TXT; ask about their content; the answer uses them and names the file (and page/slide when known).
- Paths never come from the renderer; files over the size limit or unsupported types show a clear message.
- Images work with Claude Code and Codex; the local engine refuses images politely.

## Progress / evidence
T1 (writer, 2026-11-06), uncommitted on `feat/chat-attachments`:
- Deps (platform, exact): `pdfjs-dist` 6.5.438, `mammoth` 1.13.0, `jszip` 3.10.2. Bundled into the main chunks by electron-vite (pdfjs lazy chunks `pdf-*.js`, `pdf.worker-*.js`); no asarUnpack needed. `@napi-rs/canvas` (pdfjs optional) is not shipped; pdfjs warns once and text extraction works without it.
- Limits: 10 files per conversation and per send; 20 MB per file (checked on stat and on the bytes read); 200,000 extracted chars per file; CLI files share 120,000 chars with the meeting (floor 24,000); local 2,500.
- Contracts: `chat.attach.pick|drop|remove|list`, `chatSend.attachmentIds` (max 10, default []), `answered.notice`, `chatState.attachments`.
- Core: `chat/attachments.ts` (kinds, limits, `packAttachments` with BM25 chunks and page/slide tags, untrusted-text neutralization, message keys), prompt rules (`FILE_DATA_RULE`, `FILE_CITATION_RULE`, image rule), `ChatService` resolves files after the engine, stages images for CLIs only, releases copies in `finally`, local engine gets the `Ui_ChatAttachImagesLocal` notice. `cli-invocation`: `claudeImageArgs`, `codexImageArgs`; `cli-provider`: images on the streaming path, Claude `cwd`.
- Platform: `attachment-extractors.ts`, `attachment-store.ts` (path checks: absolute, no UNC/device, regular file, allowed type, size), runner `cwd` option on `run`/`runLines`.
- Desktop: controller + handlers, dialog (multi-select), preload drop bridge (`window.vozellaFiles.attachToChat`, paths never reach the page), chips, paperclip, drop overlay, notice, `VOZELLA_FAKE_CHAT_PROMPT_LOG` e2e double.
- RED then GREEN observed: core attachments, prompt builder, chat service, CLI args/provider, contracts, platform extractors/store/runner cwd, desktop controller, renderer chips/drop. Preload bridge test written after the code (no RED observed).
- Checks: core 1997/1997; contracts 55/55; platform 505 passed, 1 failed (known B18); desktop 2219 passed; `pnpm typecheck` clean; prettier + eslint clean on touched files; `pnpm build` ok; e2e `chat-attachments` 3/3, all `chat-*` pass (chat-panel layout specs fail only under `VOZELLA_E2E_BACKGROUND=1`, pass visible); manual check on the built app with a Chromium PDF (2 pages), python-docx DOCX and python-pptx PPTX (3 slides): all ready in 344 ms, prompt carried page/slide-tagged text.
- Pending real validation: Claude Code and Codex with real images (doubles only).

## Next step
Parent: review, commit T1 as a work unit, then the RDD assessment.
