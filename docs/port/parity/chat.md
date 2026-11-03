# Parity ledger: chat

Spec: `docs/port/specs/chat.md`. Section 8 is the checklist; each package fills its own rows and never reorders earlier ones.

Status words: `done`, `improved` (a section 7 fix or a recorded decision changed the behavior), `dropped`, `pending`, `pending-real-validation`.

## Owner cuts (decided 2026-11-03)

Reason for every item below: owner decision 2026-11-03, may return later. Auditors: these are not missing.

- JEV/TypeSafe, entirely: API client, credentials, post-summary analysis, the "What do I need to do" dialog (Personal tasks button, items 127 to 129), the settings section, automatic live-question detection, armed questions that depend on it, the Jev needs-web judgment. Typed questions during a take stay, with the explicit web toggle only.
- Calendar: Coming up, reminder toasts, event-started takes, event metadata linking, Calendar settings, the pre-meeting brief (items 143 to 151). Meeting call detection and its prompt popup stay.
- xAI/Grok provider: OAuth, API key, credential store, settings expander. Claude Code, Codex and the local provider stay. A settings file that selects Xai must still load.
- Suggest-title button, custom note template, nav-pane resize grip, meeting-app suggestion bar on Record.
- Chat thread history and user recipes (items 93 to 101, 113 to 116; item 105 keeps only the built-in part). The chat itself and built-in recipe chips stay.
- On-disk compatibility still applies: typeSafeEnabled, calendar settings, Jev frontmatter, event frontmatter keys and the Brief section of existing meetings are read and rewritten without loss.

## Where things are

| Concern | Code |
| --- | --- |
| Surface parsing, scope resolution, open-thread match (chat-1) | `packages/core/src/chat/scope-resolver.ts` |
| Context packer and the B12 neutralizer (chat-1) | `packages/core/src/chat/context-packer.ts` |
| Code-point-safe cuts, reused by chat-2 (chat-1) | `packages/core/src/chat/text-cut.ts` |

## Decisions

- **Line endings (chat-1).** The packer writes LF only. Summary, notes and transcript text is split on any line break and rejoined with LF.
- **Injected strings (chat-1).** `packContext` takes a `ChatStringLookup` (`(key) => string`) as its last argument. The keys `ChatLiveTranscriptEmpty`, `ChatMeetingNotFound`, `ChatTranscriptEmpty`, `ChatFolderNotSelected`, `ChatFolderNotFound`, `ChatNoMeetingsInFolder` and `ChatNoMeetingsSaved` already exist in `en.json` and `es.json`; nothing was added. The "Showing the 12 most recent..." line, `Live transcript:`, `All meetings:`, `Folder:` and `Note:` stay English literals, as in WinUI (the model reads them).
- **B12 rule (chat-1).** Single-line fields (title, folder name, action item text) have each line break replaced by one space. In multi-line free text (summary, notes, transcript, live transcript, folder note) a line is prefixed with `> ` when, after leading spaces and tabs, it starts with `Id` plus optional spaces and `:` (any case), or with one `#` followed by a space, a tab or end of line. Those are the only shapes the context and the prompt use as structure. `##` and deeper headings are untouched so Markdown summaries keep their layout. Caps are applied before the prefix, so an affected line is up to two units longer than the cap.
- **GUID comparison (chat-1).** Meeting and folder ids are compared with case, hyphens and braces ignored, as C# Guid equality does. The tie break after `RecordedAt` compares the 32-hex lowercase ids ordinally, as the spec reasons.
- **Unparseable `recordedAt` (chat-1).** Sorted last; printed as stored.
- **Live transcript snapshot (chat-1, B5).** `packContext` takes the live transcript as an argument. Package 3 must read `workspace.state.liveTranscript` and the scope decision once when the send starts and pass those values.

## Bugs fixed

- B10 (chat-1): `cutPrefix` and `cutTail` count UTF-16 units but never split a surrogate pair. Package 2 reuses them for prior turns and the thread title.
- B12 (chat-1, context part): line breaks stripped from single-line fields and forged `Id:` or `# ` lines neutralized. The prompt part (delimiters in the prompt, brief) belongs to package 2; the brief is cut.
- B5 (chat-1, context part): live transcript is an argument.

## Left for other modules

- Items 1 to 11, 18, 19, 23: packages 3 and 6 (scope label, glyph, collapse, generation guard, mismatch banner). Item 19: the TypeSafe half is cut.
- Items 25 to 47: send flow and conversation UI (packages 3 and 7).
- Items 67 to 74, 154: prompt, links, recipe names (package 2).
- Items 75 to 92: persistence (package 4); thread files are cut, so only what the in-memory conversation needs remains.
- Package 3: call `resolveScopeFromWorkspace` and `matchesOpenThread`; snapshot the live transcript at send start.
- Package 2: reuse `cutPrefix` and `cutTail` from `text-cut.ts`, and `singleLine` and `neutralizeStructure` from `context-packer.ts` for prior turns.

## Items

| # | Item | Package | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Chat bar is app-global, docked below the page content, expand direction up, full width. | chat-6 | pending |  |
| 2 | Bar is hidden (not collapsed-with-header) on Settings only. | chat-6 | pending |  |
| 3 | Bar starts collapsed on app start. | chat-6 | pending |  |
| 4 | Bar collapses whenever the resolved scope kind, folder id, or meeting id changes. | chat-6 | pending |  |
| 5 | Bar expands on New chat and on opening a thread from history. | chat-6 | pending |  |
| 6 | Header shows scope chip (icon plus label), History button, New chat button. | chat-6 | pending |  |
| 7 | Scope glyphs: Live, Meeting, Folder, All meetings each have a distinct icon. | chat-6 | pending |  |
| 8 | Scope label for Live is `Chat_ScopeLive`. | chat-6 | pending |  |
| 9 | Scope label for Meeting is `Chat_ScopeMeetingNamed` with the meeting title, else `Chat_ScopeMeeting` when missing or blank. | chat-6 | pending |  |
| 10 | Scope label for Folder is `Chat_ScopeFolderNamed` with the folder name, else `Chat_ScopeFolder`. | chat-6 | pending |  |
| 11 | Scope label for All meetings is `Chat_ScopeAll`. | chat-6 | pending |  |
| 12 | Surface parsing is exact and case-sensitive for `Recording`, `History`, `Settings`, `Session`; anything else is Unknown. | chat-1 | done | `parseSurface` in `scope-resolver.ts`. |
| 13 | Settings surface: invisible, AllMeetings, no ids, even during capture. | chat-1 | done | `resolveScope`, Settings first. |
| 14 | Capture active (recording or processing): Live scope on every non-Settings surface. | chat-1 | done | `resolveScope`, capture check before Session and History. |
| 15 | Session surface with a selected meeting: Meeting scope with that id. | chat-1 | done | `resolveScope`. |
| 16 | History surface with a selected (non-Inbox) folder: Folder scope with that id. | chat-1 | done | `resolveScope`. |
| 17 | Everything else: AllMeetings (History Inbox, Recording idle, Session without meeting, Unknown). | chat-1 | done | `resolveScope`. |
| 18 | Scope refresh is generation-guarded: a stale refresh is discarded. | chat-3 / chat-6 | pending |  |
| 19 | Scope refresh re-reads the TypeSafe availability and rebuilds recipe lists. | chat-3 / chat-6 | pending |  |
| 20 | Scope changes are raised for: shell tag change, folder publish (always), meeting id change, capture flag change; not for live transcript text changes. | chat-1 | done | Already provided by `Workspace` (`library/workspace.ts`); proven by a test in `scope-resolver.test.ts`. |
| 21 | Live transcript is read from the workspace at send time, not subscribed. | chat-1 | done | `Workspace.state.liveTranscript` is read by the caller; `packContext` takes it as an argument (B5). |
| 22 | Match test for open thread uses kind, folder id, and meeting id with null equality. | chat-1 | done | `matchesOpenThread`. |
| 23 | Mismatch banner text `Chat_ScopeMismatch` shows when an open thread does not match the current scope; not recomputed while sending (decide whether to keep B24). | chat-3 / chat-6 | pending |  |
| 24 | A mismatched open thread is not edited; the next send creates a new thread. | chat-1 | done | Pure rule only; the next send creating a new thread is package 3. |
| 25 | Draft binds on every keystroke. | chat-7 | pending |  |
| 26 | Enter sends; Shift+Enter newline; Ctrl+Enter sends. | chat-7 | pending |  |
| 27 | Enter with an empty draft or while sending does nothing and does not insert a newline. | chat-7 | pending |  |
| 28 | Enter during IME composition must not send (new, S1). | chat-7 | pending |  |
| 29 | Send enabled iff not sending, visible, and draft non-blank. | chat-7 | pending |  |
| 30 | Placeholder `Chat_Composer.PlaceholderText`; Send tooltip `Chat_Send` "Send (Enter)". | chat-7 | pending |  |
| 31 | Composer min height 32, max 96, min width 180, wraps, scrolls. | chat-7 | pending |  |
| 32 | Message text is `Draft.Trim()`. | chat-7 | pending |  |
| 33 | Optimistic user row plus pending assistant row appear immediately; draft clears immediately. | chat-7 | pending |  |
| 34 | Pending row shows spinner plus `Chat_Thinking` until first visible text. | chat-7 | pending |  |
| 35 | Streaming shows Markdown live; first push on first non-whitespace chunk; further pushes at most every 80 ms; final flush at end; leading whitespace trimmed in pushes. | chat-7 | pending |  |
| 36 | Transcript auto-scrolls to the end on new rows and on every streamed text change. | chat-7 | pending |  |
| 37 | Provider is resolved per send from settings; gating dialogs (local model download, CLI check, xAI sign-in) run via the shared resolver. | chat-3 / chat-7 | pending |  |
| 38 | Cancelled/unsatisfied gate shows `Status_SetupCancelled` and keeps the user's turn out of history. | chat-3 / chat-7 | pending |  |
| 39 | Provider exception shows `Chat_SendFailed` with the message. | chat-3 / chat-7 | pending |  |
| 40 | Blank answer shows `Chat_EmptyAnswer` and persists nothing. | chat-3 / chat-7 | pending |  |
| 41 | Answer text is trimmed before persisting. | chat-3 / chat-7 | pending |  |
| 42 | On failure both optimistic rows are removed and the draft is restored only if the composer is still empty. | chat-3 / chat-7 | pending |  |
| 43 | `IsSending` is always cleared in a finally path. | chat-3 / chat-7 | pending |  |
| 44 | Failed UI marshalling reports `Chat_UiMarshalFailed`. | chat-3 / chat-7 | pending |  |
| 45 | Error bar is closable, titled `Chat_Error`, severity error; cleared at the start of each send and on New chat. | chat-3 / chat-7 | pending |  |
| 46 | Starter chips hidden while sending or when any message exists. | chat-3 / chat-7 | pending |  |
| 47 | Optional improvements agreed for the port: block New chat/open/delete during send (B1); stop button (B19). | chat-3 / chat-7 | pending |  |
| 48 | Live scope returns `"Live transcript:" + NL + last 2500 chars`, or `ChatLiveTranscriptEmpty` for null/blank. | chat-1 | done | `packContext` Live; tail is code-point safe (B10). |
| 49 | Live scope never reads saved meetings. | chat-1 | done | `packContext` Live ignores meetings. |
| 50 | Meeting scope finds by id; missing or null id returns `ChatMeetingNotFound`. | chat-1 | done | `packContext` Meeting; ids compared as GUIDs (case, hyphens, braces ignored). |
| 51 | Meeting scope: Summary and Notes uncapped; transcript tail 6000 chars; empty transcript returns `ChatTranscriptEmpty` line. | chat-1 | done | `packContext` Meeting. |
| 52 | Meeting block header lines in order: Id (32 hex), Title, Recorded (`yyyy-MM-dd HH:mm` local), Summary, Action items, Notes. | chat-1 | done | Shared block. |
| 53 | Date is never ISO "O". | chat-1 | done | Local `yyyy-MM-dd HH:mm` from `parseOffsetDate`. |
| 54 | Blank summary or notes render `(none)`. | chat-1 | done | `(none)`. |
| 55 | Action items render `- [ ] text` / `- [x] text`, skipping null/blank, line breaks replaced by a space; empty renders `(none)`. | chat-1 | done | Line breaks replaced by one space. |
| 56 | Folder scope with no folder id returns `ChatFolderNotSelected`. | chat-1 | done | Folder scope. |
| 57 | Folder scope header `Folder: {name}` and `Note: {note or (none)}`; unknown folder prints `ChatFolderNotFound`. | chat-1 | done | Folder name loses line breaks, note neutralized (B12). |
| 58 | Folder scope includes only meetings with exactly that folder id (no children, no Inbox). | chat-1 | done | Exact id, GUID comparison. |
| 59 | AllMeetings header `All meetings:`; ignores folder id. | chat-1 | done | AllMeetings. |
| 60 | Multi scopes: sort by `RecordedAt` desc then `Id` desc; cap 12. | chat-1 | done | Ordinal compare of the 32-hex id for the tie break. |
| 61 | Multi scopes: Summary capped to first 800, Notes to first 400; no transcripts. | chat-1 | done | Cut by `cutPrefix` (B10). |
| 62 | Truncated list adds `Showing the 12 most recent of N meetings. Older meetings were omitted.` | chat-1 | done | Line text is English, as in WinUI. |
| 63 | Empty result adds `ChatNoMeetingsInFolder` or `ChatNoMeetingsSaved`. | chat-1 | done | Messages come from an injected lookup. |
| 64 | Blocks are separated by a blank line; result is end-trimmed. | chat-1 | done | Blocks end with a newline, a blank line separates them. |
| 65 | Never include JevAnalysis, audio paths, folder ids of meetings, or other fields. | chat-1 | done | Packer reads `ContextMeeting` fields only; a test seeds the forbidden fields. |
| 66 | Unknown scope throws. | chat-1 | done | `RangeError` for an unknown scope; `TypeError` for null meetings or folders. |
| 67 | Prompt text lines match section 3.4 verbatim, in order. | chat-2 | pending |  |
| 68 | `Scope: ` label uses the English labels `All meetings`/`Folder`/`Meeting`/`Live`. | chat-2 | pending |  |
| 69 | Rewrite instruction only for Meeting scope when the message contains `rewrite` (case-insensitive substring). | chat-2 | pending |  |
| 70 | Sections `# Context`, `# Prior turns`, `# User message` with blank lines between. | chat-2 | pending |  |
| 71 | Prior turns: last 8 messages, each `role: text`, text cut to 1500; `(none)` if empty. | chat-2 | pending |  |
| 72 | User message appended without a trailing newline. | chat-2 | pending |  |
| 73 | Citation prefix `https://meetinglive.local/meeting/` plus 32-hex Id. | chat-2 | pending |  |
| 74 | `TryParseMeetingLink` rules: null false; prefix match ignoring case; trailing slashes trimmed; Guid parse. | chat-2 | pending |  |
| 75 | Threads file `chat-threads.json` in the app data directory; recipes `chat-recipes.json`. | chat-4 | pending |  |
| 76 | camelCase property names; nulls written; Guid `D` format; ISO-8601 offset timestamps. | chat-4 | pending |  |
| 77 | `scopeKind` stored as PascalCase enum name; reading accepts case-insensitive names. | chat-4 | pending |  |
| 78 | Required members enforced on read (decide the tolerant behavior from B3 in the port, but keep file compatibility). | chat-4 | pending |  |
| 79 | Missing messages array becomes empty. | chat-4 | pending |  |
| 80 | Save is upsert by id, preserving file position when replacing, appending when new. | chat-4 | pending |  |
| 81 | Delete of a missing id does nothing and does not create the file. | chat-4 | pending |  |
| 82 | Thread list order: `updatedAt` desc, `createdAt` desc, `id` desc. | chat-4 | pending |  |
| 83 | Recipe list order: file order. | chat-4 | pending |  |
| 84 | All repository operations are serialized in-process. | chat-4 | pending |  |
| 85 | Directory created on first write. | chat-4 | pending |  |
| 86 | Writes should be atomic (B2) and files remain readable by the old format. | chat-4 | pending |  |
| 87 | Thread created on first successful send only. | chat-4 | pending |  |
| 88 | Thread title is the first message trimmed, line breaks to single space, max 60, trailing space trimmed. | chat-4 | pending |  |
| 89 | `CreatedAt`/`UpdatedAt` use local time with offset; user and assistant messages of a turn share one timestamp (decide whether to fix B7). | chat-4 | pending |  |
| 90 | `UpdatedAt` is bumped each turn; titles never change. | chat-4 | pending |  |
| 91 | Save failure restores the in-memory message list and shows the error. | chat-4 | pending |  |
| 92 | After a successful turn the transcript is re-rendered from the persisted thread and the thread list is refreshed. | chat-4 | pending |  |
| 93 | History flyout reloads threads when opened. | dropped | dropped |  |
| 94 | Empty state `Chat_HistoryEmpty`. | dropped | dropped |  |
| 95 | Rows show title (blank gives `Chat_Untitled`) and `Chat_ThreadUpdated` with a local short date-time. | dropped | dropped |  |
| 96 | Clicking a row opens that thread, closes the flyout, expands the bar, scrolls to end. | dropped | dropped |  |
| 97 | Opening a missing thread resets to a new chat when it was open, and refreshes the list. | dropped | dropped |  |
| 98 | Delete button per row opens the confirm dialog with title `Chat_DeleteThreadTitle`, content with title, default button Close. | dropped | dropped |  |
| 99 | Confirming deletes the thread; clears the view if it was open; refreshes the list. | dropped | dropped |  |
| 100 | New chat clears messages, draft, error, mismatch, and open thread. | dropped | dropped |  |
| 101 | Threads list shows all threads regardless of scope. | dropped | dropped |  |
| 102 | Built-in recipes: eight entries with the exact ids, names, availability, and prompts from 3.7. | chat-2 / chat-8 | pending |  |
| 103 | Built-ins are never written to disk. | chat-2 / chat-8 | pending |  |
| 104 | Scope to availability: Meeting/Live single; Folder/All multiple. | chat-2 / chat-8 | pending |  |
| 105 | Scope list = built-ins (catalog order) then user recipes (file order); user rows with colliding built-in ids skipped (apply the B9 fix or keep, but document). | chat-2 / chat-8 | pending |  |
| 106 | Starter chips = first 4 of the scope list. | chat-2 / chat-8 | pending |  |
| 107 | Chip click fills the draft and sends immediately. | chat-2 / chat-8 | pending |  |
| 108 | Recipes flyout lists name and two-line prompt preview; item click fills the draft without sending, closes the flyout, focuses and puts the caret at the end. | chat-2 / chat-8 | pending |  |
| 109 | Delete icon only on user recipes; built-ins cannot be deleted even through the API. | chat-2 / chat-8 | pending |  |
| 110 | Slash filter opens automatically when the draft starts with `/`, filtering by name or prompt, case-insensitive substring of `Draft[1..].Trim()`. | chat-2 / chat-8 | pending |  |
| 111 | Button-open shows the full list; slash-open shows the filtered list. | chat-2 / chat-8 | pending |  |
| 112 | Empty state `Chat_NoRecipes`. | chat-2 / chat-8 | pending |  |
| 113 | Create recipe dialog fields, placeholders, availability radio with default from current scope, validation that blocks Save on blank name or prompt. | dropped | dropped |  |
| 114 | Saved recipe: new Guid, trimmed name and prompt, availability from the radio, `CreatedAt` now. | dropped | dropped |  |
| 115 | Delete recipe dialog `Chat_DeleteRecipe*` strings, default Close. | dropped | dropped |  |
| 116 | Recipe errors surface through the chat error bar. | dropped | dropped |  |
| 117 | User messages are plain text bubbles, right-aligned, max about 75% width, selectable. | chat-9 | pending |  |
| 118 | Assistant messages render Markdown (headings, lists, emphasis, code, tables, links); no raw HTML. | chat-9 | pending |  |
| 119 | Role labels `Chat_RoleUser` and `Chat_RoleAssistant` exist; assistant label shown above the answer. | chat-9 | pending |  |
| 120 | Copy button on completed assistant messages copies the raw Markdown; failure shows `Chat_CopyFailed`. | chat-9 | pending |  |
| 121 | Transcript list max height 420 with internal scrolling. | chat-9 | pending |  |
| 122 | Meeting citation links open the meeting on the Summary tab (select meeting, navigate to Session). | chat-9 | pending |  |
| 123 | Missing cited meeting shows `Chat_MeetingLinkMissing`. | chat-9 | pending |  |
| 124 | http(s) links open in the system browser; other schemes are ignored. | chat-9 | pending |  |
| 125 | Link handler errors surface in the error bar. | chat-9 | pending |  |
| 126 | Accessible text of each row is `Role: text` (or just the role while thinking). | chat-9 | pending |  |
| 127 | Button visible only in Meeting scope when TypeSafe is enabled and an API key exists. | dropped | dropped |  |
| 128 | Click opens the Personal tasks dialog for the current meeting id; ignores clicks while opening. | dropped | dropped |  |
| 129 | Availability is re-read on scope refresh and when the bar expands. | dropped | dropped |  |
| 130 | Related = other meetings with the same trimmed non-empty series id OR the same trimmed title (ordinal, case-sensitive), excluding the current id. | chat-5 | pending |  |
| 131 | Order by `RecordedAt` desc. | chat-5 | pending |  |
| 132 | Blank series ids never match each other. | chat-5 | pending |  |
| 133 | Summary page shows at most 5, newest first, with title and local short date-time. | chat-5 | pending |  |
| 134 | Section hidden when empty; click opens that meeting's Summary tab. | chat-5 | pending |  |
| 135 | Summary preferred over transcript when summary is not blank. | chat-5 | pending |  |
| 136 | Transcript fallback drops `Recorded `/`Ended ` header lines, timestamp ranges, and `[ Speaker-N ]` tags. | chat-5 | pending |  |
| 137 | Heading lines (1 to 6 `#` then space or end) go to a secondary buffer used only when no body text exists. | chat-5 | pending |  |
| 138 | Marker stripping removes ```` ``` ````, `**`, `__`, `` ` ``, `*`, `_` in that order. | chat-5 | pending |  |
| 139 | Whitespace runs collapse to one space; result trimmed. | chat-5 | pending |  |
| 140 | Truncate to 140 chars plus `…`. | chat-5 | pending |  |
| 141 | Empty snippet shows `History_NoContent`. | chat-5 | pending |  |
| 142 | Snippet computed once per meeting row load (B16 improvement). | chat-5 | pending |  |
| 143 | `HasUsefulContext` gate runs before any provider setup or model call. | chat-5 | pending |  |
| 144 | Brief prompt text matches 3.10 verbatim, with attendees joined by `, `, agenda trimmed, and at most 3 prior meetings. | chat-5 | pending |  |
| 145 | Prior meeting block includes title attribute, summary, notes, action item texts joined by `; `, each defaulting to `(none)`. | chat-5 | pending |  |
| 146 | Normalize returns null for blank or `NONE` (case-insensitive). | chat-5 | pending |  |
| 147 | Generation counter discards stale results after the note is reset or another event is opened. | chat-5 | pending |  |
| 148 | Provider failure shows `RecordPage_BriefFailedFormat` with the mapped message; cancelled provider setup is silent. | chat-5 | pending |  |
| 149 | Brief persists to the linked existing meeting; save errors show in the same error bar. | chat-5 | pending |  |
| 150 | Brief shown only while the coming-up note is open and not processing; passed to the pipeline and to live answers. | chat-5 | pending |  |
| 151 | Brief renders as Markdown in the port (B13). | chat-5 | pending |  |
| 152 | All strings above exist in en and es, with the same keys, including placeholders `{0}`. | chat-1 (context strings only) | done (context strings) |  |
| 153 | Automation ids preserved: `BarMeetingChat`, `LblMeetingChatScope`, `BtnMeetingChatHistory`, `ListMeetingChatHistory`, `BtnMeetingChatNew`, `ListMeetingChat`, `InfoMeetingChatError`, `ListMeetingChatStarters`, `TxtMeetingChat`, `BtnMeetingChatSend`, `BtnMeetingChatPersonalTasks`, `BtnMeetingChatRecipes`, `ListMeetingChatRecipes`, `ListRelatedMeetings`, `TxtMeetingBrief`, `BriefSection`, `InfoBriefError`. | none for chat-1 | pending |  |
| 154 | Built-in recipe names resolve at call time against the current UI language (fix for B8). | chat-2 | pending |  |
| 155 | Every test named in section 6 has an equivalent in the new test suite, plus new tests for B1, B3, B10, and the send/rollback flow. | chat-4 | pending (chat-1 ports ChatContextPackerTests and ChatScopeResolverTests) |  |
