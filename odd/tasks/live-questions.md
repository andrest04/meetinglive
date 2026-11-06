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
- [ ] T2 — Live AI panel: badge, live chips, richer live context with rolling digest. Route: delegated.
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

## Next step
Commit T1, then T2.
