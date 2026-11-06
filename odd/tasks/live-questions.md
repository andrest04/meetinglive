# Feature: Live question detection + live AI panel (Phase 4 of the AI panel plan)

## Objective
During a recording, detect questions spoken in the meeting and offer a one-click answer (card "Question detected → Answer / Dismiss"), and make the AI panel useful live: quick chips ("Catch me up", "Summary so far", "Suggest questions", "Decisions and tasks") and a live context richer than the last 2500 chars.

## Why
Competitors (Fireflies Live Assist, Zoom AI Companion, Notion in-meeting skills, Granola "What did I miss?") answer during the meeting. Automatic detection was dropped on 2026-11-03; the owner re-approved it on 2026-11-05 (night), asking for existing technology and testing tonight. Design in Engram `design/live-question-detection`.

## Approach
- Rules first (ported WinUI `LiveQuestionDetector`: `¿`, trailing `?`, es/en interrogative start incl. "por qué", ≥12 chars, rhetorical whole-line rejects, last new question wins) in `packages/core/src/live-ask/question-detector.ts`, on new committed lines only.
- Optional confirm with the selected summary engine (WinUI Jev criteria text as a yes/no prompt), debounced, newest cancels older, settings toggle.
- New event `recording.questionDetected`; card in the pill, the Record dock and the AI panel; never auto-answers; dismissed questions never return in that take; Answer uses the existing `liveAsk.ask`.
- Live panel: "En vivo" badge, live chips, live context = session context (title/brief/notes) + rolling digest + last ~3 min.
- No TypeSafe (no TS client; would send transcript to a third party).

## Delivery strategy
`exception-ok`, merge locally. RDD off. Autonomous overnight run authorized by the user (windows OK, no sound through speakers).

## Tasks
- [x] T1 — Question detector + hook + event + cards (pill, dock, AI panel) + optional LLM confirm + setting; unit tests; deterministic e2e via FakeSpeechEngine question phrase. Route: delegated.
- [x] T2 — Live AI panel: badge, live chips, richer live context with rolling digest. Route: delegated.
- [ ] T3 — Real-engine check: synthesize es/en question audio (SAPI TTS to WAV, no speaker playback), import it, confirm Nemotron punctuation and detector hits; record findings. Route: delegated.

## Acceptance criteria
- A spoken question appears as a card within ~2 s of its line being committed (rules path); Answer streams an answer; Dismiss hides it for the take.
- Rhetorical checks ("¿se entiende?", "ok?") do not trigger.
- Live chips answer from session context + digest + recent minutes.
- Unit tests and the targeted e2e pass.

## Progress / evidence
### T1 (delegated writer, 2026-11-05/06) — commit pending
- Core: `live-ask/question-detector.ts` (WinUI rules + extras: `por que` without accent, accented `cuánto` family, more es/en rhetorical checks, second-person cue as tie-breaker only, punctuation-insensitive seen key); `live-ask/live-questions.ts` (`LiveQuestionTracker`: coalesced detection off the live update, per-take seen set, rules+ai check with the WinUI Jev criteria as a yes/no prompt over the last 90 s, 8 s timeout, newer/dismiss/new take cancel, failures keep the card).
- Setting `liveQuestions` (`off|rules|rules+ai`) in `AppSettings`; unset resolves to `rules+ai` with ClaudeCode/Codex, else `rules`; written to settings.json only once set (WinUI property set untouched). UI: Settings > summary engine block (`LiveQuestionsSection`).
- Contracts: events `recording.questionDetected {id, body, atMs, confirmed}`, `recording.questionWithdrawn {id}`, request `recording.dismissQuestion {id}`.
- Renderer: `QuestionCard` + `LiveQuestionSlot` + `use-live-questions` store in the Record dock, the pill panel (above the chips) and the AI panel in Live scope (hidden there while the dock shows it). Ctrl+Enter answers outside text fields; polite live region.
- Fake ASR: `VOZELLA_FAKE_ASR_QUESTION=1` inserts the question as phrase 2 (default script unchanged).
- RED observed: detector, tracker and settings resolver tests failed (missing module / not defined) before implementation; handler, renderer and settings-UI tests were written alongside the code (no separate RED run).
- Checks: core 1881 passed; contracts 49 passed; platform 476 passed, 1 failed (known B18 catalog pin); desktop 2190 passed; `pnpm typecheck` clean; prettier + eslint clean on touched code; e2e 54 passed (live-questions, recording-processing, pill-panel, pill-panel-error, pill-capsule, pill-window, recording-screen, recording-bar).
- Route: delegated (multi-file writer trigger).

### T2 (delegated writer, 2026-11-06) — commit pending
- Core: `live-ask/rolling-digest.ts` (`RollingDigest`: considered every 120 s, runs only with ≥ 600 new committed chars, one in flight, 60 s timeout, failure/empty reply skips and retries those lines next interval, `reset()` cancels and clears; prompt asks for ≤ 1200 chars of `- ... (mm:ss)` bullets from previous digest + new lines; input cut to 12 000 chars CLI / 3000 local, whole recent lines). `chat/context-packer.ts`: `LiveContextSnapshot {transcript, digest, title, notes}`; Live = `Meeting:`/`Notes:` + digest block + `Live transcript:` tail (with digest 2500 local / 8000 CLI, without 2500 / 20 000); a plain string still packs as before. `chat/recipes.ts`: four `live` recipes (ids …301-304) lead the Live list (starter chips); other scopes unchanged.
- Main: `LiveAsk` owns the digest (reset on start/stop/discard, fed by `committed`), engine = Claude Code/Codex always, Local only when `summaryRuntime.host.loadedModelPath` is set (never loads it); `chatContext()` = digest + take title + notes (`liveAskContext` now carries notes). `ChatController` gets `liveContext` and builds the snapshot at send start in Live scope (B5).
- Renderer: `LiveBadge` (Pulse dot, outline pill, scope name) replaces the Live icon+label in the panel header; strings `Ui_RecipeLive*{Name,Prompt}` en/es; spec `docs/port/specs/chat.md` updated.
- RED observed: core digest/packer/recipes/chat-service tests (12 failed: missing module/exports); main controller + live-ask digest tests failed before wiring; AiPanel badge tests failed before `LiveBadge`. ChatBody live-chip tests were written after the core recipes change (passed on first run).
- Checks: see report in the T2 handoff (core 1902 passed; contracts 49; desktop 2197 passed, 1 known notepad-markdown flake; typecheck clean; prettier + eslint clean on touched code; e2e live-questions 4/4 incl. new live-panel test; targeted chat-*, live-questions, pill-panel(-error), recording-screen/bar/processing/notepad/pipeline: 79 passed, 3 skipped, 1 failed then fixed: `recording-bar` pause test hit two `pulse` elements once the remembered-open AI panel shows the Live badge, so its locators are now scoped to `recording-bar` and it passes 9/9).
- Route: delegated (multi-file writer trigger).

## Next step
Commit T1 (if not yet) and T2, then T3.
