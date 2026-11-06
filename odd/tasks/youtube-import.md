# Feature: Import a meeting from a YouTube link

## Objective
Let the user paste a YouTube link on the Record screen and get the same meeting (transcript + summary) as when importing an audio file.

## Problem / why
Only local audio files can be imported today. Many meetings, talks and classes live on YouTube.

## Approach
- yt-dlp downloads the audio only (`bestaudio[ext=m4a]`, which Media Foundation can decode) to a temp file.
- The temp file goes through the existing `convertForImport` → `runPipeline` path unchanged. Temp file is removed afterwards.
- yt-dlp.exe is NOT bundled at build time: it is downloaded on first use into app data (verified against the release `SHA2-256SUMS`) and kept current with `yt-dlp -U`, because YouTube changes often break older versions and updates must not need a Vozella release.
- Cancel reuses `recording.cancelProcessing {meetingId:null}` (kills the yt-dlp process tree).

## Scope
In: platform yt-dlp manager + runner, `recording.importUrl` contract, service method, IPC, renderer UI + strings, docs (specs/parity).
Out: playlists, live streams, non-YouTube sites (URL validation restricts to YouTube hosts), download percent progress.

## Constraints
- Electron port conventions (`docs/port/stack.md`); new strings in `ui.{en,es}.json` with `Ui_` prefix.
- `shell:false`, process tree kill on cancel (`killProcessTree`).
- Meeting time: `fileTimeMs: null` (temp file mtime is meaningless).

## Delivery strategy
`exception-ok`: the user merges feature branches locally into `main` (no PRs). Forecast ~900 authored lines.
Review: RDD is off (global) → ordinary checks only.

## Tasks
- [x] T1 — Platform: `YtDlpManager` (ensure binary in app data, sha256 verify, self-update) and `YtDlpDownloader` (spawn, cancel, error mapping) + unit tests. Route: delegated (multi-file). `parseYouTubeUrl` lives in `@vozella/core`.
- [ ] T2 — Main: `recording.importUrl` contract + channel, `RecordingService.importUrl` (download → convertForImport → pipeline, temp cleanup, cancel), IPC handler, composition wiring + tests. Route: delegated.
- [ ] T3 — Renderer: "Import from YouTube" action with URL input on Record screen, store action, `Ui_` strings (en/es) + tests. Route: delegated.
- [ ] T4 — Docs: `docs/port/specs/recording.md` §2.12 and `docs/port/parity/recording.md`. Route: delegated with T3.

## Acceptance criteria
- Pasting a valid YouTube URL creates a meeting with transcript and summary.
- Invalid URL is rejected in the UI before any download.
- Cancel during download stops yt-dlp and leaves no temp/partial files.
- yt-dlp missing → downloaded once, verified; failure shows a localized error.
- `pnpm check` green.

## Checks
- `pnpm --filter @vozella/desktop test` and the platform/contracts package tests
- `pnpm check`

## Progress / evidence
- T1: core 1721 passed (38 URL cases), platform youtube 20/20 (parent re-run), typecheck + prettier + eslint clean. RED observed before GREEN. Pre-existing unrelated failure: `settings-adapters.test.ts > catalog pins match the real 1B file (B18)` (machine-local spike model). Commit: see git log `feat(platform): add yt-dlp manager and downloader`.

## Next step
T2.
