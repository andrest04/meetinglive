# Granola notepad

## Objective

A local AI notepad for back-to-back meetings. Before the meeting you see what is coming and a short brief. During the meeting you write as much or as little as you want while capture runs in the background. After the meeting, your notes plus the transcript become enhanced notes, action items, and a follow-up draft you can copy. No bot joins the call.

## Problem

MeetingLive already captures mic + system audio, transcribes, summarizes, keeps personal notes, highlights a moment, and prompts when a meeting window appears. It does not know the calendar, does not prep you, and does not treat your notes as the thing the model should enhance.

## Why

The user asked to implement the Granola notepad from https://www.granola.ai/ : before, during, and after the meeting, including calendar sync, and to rescue every feature that fits a local Windows app.

## What Granola actually is

Verified against the homepage, `/ai-note-taker`, and docs.granola.ai (101, calendar sync, writing notes, AI-enhanced notes, pre-meeting briefs, follow-up emails, templates, notifications, recipes).

Before:

- Coming up from the calendar. Five events, page forward and back.
- Skip declined events, Out of Office, Focus time, and Working location.
- Click an event to open its note. At or after start, start transcribing. Before start, the note is for prep only.
- A short brief: who is attending, what you discussed last time, what is still open. Glanceable. No filler when there is no prior context.

During:

- Note editor is the canvas. Headings and bullets in the raw notes guide the enhancement.
- Transcription stays in the background. The user stays in the room. No bot.
- Works with Zoom, Meet, Teams, and in-person because capture is computer audio, which MeetingLive already does.

After:

- Enhanced notes from the transcript, the raw notes, and the calendar event.
- My notes / Enhanced toggle. Regenerating uses the current raw notes.
- Templates shape the enhanced notes (Auto, 1:1, standup, sales, user interview, plus a user template).
- List actions, write a follow-up email, draft a project plan. Drafts stay on the device. Nothing is sent.
- Related meetings: same calendar series id, or the exact same title.

Already in this app, do not rebuild:

- WASAPI mic + loopback capture.
- Live transcript, highlight, session notes field, summary, action items, folders.
- Call-window watcher and Take notes toast (`MeetingCallWatcher`).
- Meeting chat and recipes on `feat/granola-chat`. This branch starts from `origin/main` and does not depend on that branch.

## Out

These need Granola's cloud accounts or another vendor's API. Do not fake them.

- Google or Microsoft OAuth inside MeetingLive. Calendar sync reads the Windows calendar. The user adds Google or Outlook calendars there.
- Gmail read/send, Slack, Notion, Linear, HubSpot, Attio, Affinity, Zapier.
- LinkedIn or web research inside the brief.
- Screen capture of a shared screen.
- Zoom or Meet speaker-tag APIs.
- Injecting a chat message or watermark into Zoom, Meet, or Teams.
- Mobile, Apple Watch, team spaces, sharing notes with attendees.
- Auto-start with no click. Granola only transcribes after the user opens the note.

## Constraints

- C# 12. Classic `[ObservableProperty]` private fields. No partial properties.
- UI strings in `MeetingLive.App/Strings/en-us/Resources.resw`. No hardcoded UI copy.
- English artifacts. Do not build or test `MeetingLive.sln`.
- New meeting fields are omitted from Markdown frontmatter when empty so existing files stay valid.
- Calendar access failure is a typed empty state, never a crash.
- `PaneDisplayMode` stays `Auto`.
- Do not commit until the parent records a chain strategy. Forecast exceeds 400 authored lines.

## Acceptance

- Coming up lists the next meetings from Windows Calendar, five at a time, and hides OOO, focus, working-location, all-day, and free blocks.
- Clicking a future event opens its note and brief without starting capture. Clicking an event that has started opens the note and starts capture, and opens the join URL when one exists.
- The same calendar event does not create a second meeting.
- Related meetings match series id or exact title.
- The brief is 2-3 bullets from prior related meetings and the event agenda, or hidden when there is nothing useful.
- Raw notes written during capture are saved on the meeting and are an input to enhanced notes.
- Enhanced notes can be regenerated with a built-in or user template.
- Follow-up email, action list, and project-plan drafts are generated locally and can be copied. Nothing is sent.
- A meeting with two or more attendees notifies about one minute before, unless capture is already active or notifications are off.

## Delivery

- Strategy: `ask-on-risk`. Chain: `stacked-to-main` (user chose it on 2026-09-22).
- Branch: `feat/granola-notepad` from `origin/main`. Not pushed. No PRs opened.
- TDD: unknown. No session config names strict TDD. Do not invent a RED ceremony.
- Checks: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj` (582 passed) and `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64` (0 errors).
- RDD is off. No review started.

Stacked slices, merge to main in this order. Each commit is one future PR. Do not open them until asked.

1. `f968d11` feat(calendar): hide non-meetings from coming up — 276
2. `b8898b5` feat(calendar): page coming-up events and read join urls — 349
3. `7026ca0` feat(calendar): decide when a meeting reminder is due — 371
4. `ada7575` feat(calendar): read windows appointment calendars — 361
5. `49c0f22` feat(notepad): build a pre-meeting brief from prior notes — 239
6. `7712ff2` feat(notepad): let raw notes shape the summary — 136
7. `ac0e153` feat(notepad): add built-in and custom note templates — 276
8. `3d458ed` feat(notepad): draft follow-up email and project plan locally — 191
9. `e11ef7f` feat(notepad): link a meeting to its calendar event — 349
10. `c2bec34` feat(app): remind one minute before a calendar meeting — 366
11. `c36b63a` feat(app): choose which calendars appear in coming up — 185
12. `9524379` feat(app): open calendar notes with brief and drafts — 1171. `size:exception`. RecordingPageViewModel alone is 447 changed lines. Splitting that page would tear Coming up, the brief, and the note canvas apart. One honest pass. Do not shrink the code to fit 400.

## Tasks

- [x] T1 Calendar event model, meeting filter, five-item pager, and store interface. Route: delegated (writer trigger). Tests 531 passed. Build 0 errors.
- [x] T2 Persist calendar link on the meeting and find related meetings. Route: delegated. Frontmatter omitted when empty.
- [x] T3 Coming up on Record, open or reuse the note, start capture only at or after start. Route: delegated. Link stamped on the pipeline request. Capability: `appointmentsSystem`.
- [x] T4 Pre-meeting brief from related meetings and the event. Route: delegated. Hidden when there is no useful context.
- [x] T5 Enhanced notes from raw notes, transcript, and calendar, with My notes / Enhanced. Route: delegated. Summary contract unchanged when context is absent.
- [x] T6 Built-in and user note templates. Route: delegated. Custom template at `%LOCALAPPDATA%\MeetingLive\custom-note-template.json`.
- [x] T7 Local follow-up email, action list, and project-plan drafts. Copy only. Route: delegated.
- [x] T8 One-minute calendar notification and Settings toggles for calendars and notifications. Route: delegated.

## Progress

- T1–T8 committed on `feat/granola-notepad`. Not pushed.
- Parent spot check: 582 tests passed. App build 0 errors.
- Reviewed boundary: `origin/main` (`fdd0cec`). RDD off.

## Next step

Open stacked PRs only if the user asks. Do not push until then.
