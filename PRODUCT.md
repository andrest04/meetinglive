# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron desktop app (`apps/desktop`), Windows x64 only today; macOS is a possible later target. The landing page lives in `website/`. The original WinUI 3 app (`MeetingLive.*`) is kept intact but is not the target for new design work.

## Users

An individual professional with a steady load of calls (Zoom, Teams, Meet, or anything with audio) on their own Windows PC. During the call they want to stay present and not lose the thread; afterwards they want a reliable transcript, a summary, and their action items, and later they want to find what was already decided. They work alone: there is no team account, shared workspace, or admin role.

## Product Purpose

Vozella writes every meeting down. It records the user's microphone plus system audio (or a single app), transcribes on the PC, then produces notes, summaries and action items, and keeps a searchable library the user can chat with. Success means the user never has to take notes by hand during a call and can answer "what did we decide?" from their own meetings.

## Positioning

- **Nothing joins the call.** No bot, no invite, no extra guest; capture happens on the user's PC.
- **Transcription stays local.** The speech model runs on the PC. The saved transcript is generated from the recording after the user stops; the live text is only a preview.
- **The user chooses who reads the transcript.** Summaries and chat run on a local GGUF model (no account) or on an engine the user picks: their own signed-in Claude Code or Codex CLI, or Grok. Cloud engines send the text to that provider, and the product says so.
- **Meetings are files.** Each meeting is a Markdown file with its recording next to it in `Documents\Vozella`, usable in any editor and kept if the user stops using Vozella.

## Operating Context

- Used alongside a live call: a recording pill, a Live copilot window that stays on top, detected questions, and "What did I miss?".
- Proactive entry points: Windows calendar reminders about one minute before meetings with two or more people, and a popup when a Zoom, Teams or Meet call is detected.
- After the call: transcript, summary, action items, templates; optional speaker labels for up to four voices.
- Library: folders, date and status filters, search, and chat scoped to one meeting, a folder, or all meetings, with answers linking back to source meetings.
- Audio can also be imported.

## Capabilities and Constraints

- Status: beta, Windows only, unsigned NSIS installer published from GitHub Actions on pushes to `main`.
- Transcription languages: auto, English, Spanish, Portuguese, French, German, Italian, Dutch, Japanese, Chinese. UI and summary languages: English and Spanish (both locales must stay in sync).
- Optional TypeSafe integration sends the transcript to TypeSafe only after the user saves a key.
- Stack: Electron + React renderer, typed IPC contracts, pure core packages, Node platform adapters, and a Rust native addon for audio, calendar, DPAPI, sessions and windows.
- The Electron port has passing automated tests but is not yet validated with real meetings, real accounts, or the installer.
- Terminology: "meeting", "recording", "transcript", "summary", "action items", "Live copilot", "library", "engine".

## Brand Commitments

- Name: Vozella. Tagline: "Every meeting, written down."
- Logo files in `docs/brand/` (light and dark tiles).
- Voice, as used across the README and landing page: plain, short, factual sentences; says what happens to the user's data without hedging; no hype.
- The legacy WinUI app keeps the name MeetingLive and its `Documents\MeetingLive` folder.

## Evidence on Hand

- App screenshots: `docs/screenshots/` (for example `record.png`) and port screenshots under `docs/port/`.
- Landing page copy and sample meeting content: `website/index.html`.
- No customers, testimonials, usage numbers, press, pricing, or benchmarks exist. Do not invent them.

## Product Principles

1. Stay out of the call: capture must never be visible to other participants.
2. Be honest about data: every place text leaves the PC is named, chosen by the user, and off by default where optional.
3. The user owns the meetings: plain files on their disk, no lock-in.
4. Help without pulling attention: during a call, assistance is glanceable and never makes the user lose their place.
5. The recording is the source of truth: live output is a preview; the final transcript and notes come from the recording.
