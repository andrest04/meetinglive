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
| Prompt builder (chat-2) | `packages/core/src/chat/prompt-builder.ts` |
| Meeting link build and parse (chat-2) | `packages/core/src/chat/meeting-link.ts` |
| Thread title (chat-2) | `packages/core/src/chat/thread-title.ts` |
| Built-in recipes, scope lists, slash filter (chat-2) | `packages/core/src/chat/recipes.ts` |

## Decisions

- **Chat service (chat-3).** `ChatService` keeps one in-memory conversation (scope plus messages) for the app session. `send(draft, decision, liveSnapshot, {setupGate?})` returns `ignored`, `sent`, `cancelled`, `setup-required` or `failed`, each failure with `originalDraft`. Text comes from an injected `TranslateFn`. Ports: `ChatMeetingReader`, `ProviderSource`, `Clock`, `CancelSignal`. Test kit: `chat-test-kit.ts`.
- **Cancel (chat-3).** A cancel after the provider returned text still drops the answer (B20).

- **Recipe API (chat-2).** `builtInRecipes(t)` and `recipesForScope(kind, t)` take a `RecipeNameLookup` (`(key) => string`) and return fresh objects every call. `availabilityFor` throws RangeError on an unknown scope. `filterRecipes(list, draft)` is the slash filter; the flyout is chat-8.
- **Link parsing (chat-2).** `tryParseMeetingLink` returns the 32-hex lowercase id or null. Braced and parenthesized forms need the hyphenated shape and matching delimiters, as .NET Guid.TryParse does.
- **Prompt messages (chat-2).** `buildPrompt` takes `{role, text}` prior messages; a null text counts as empty and a null element throws a TypeError on access.

- **Line endings (chat-1).** The packer writes LF only. Summary, notes and transcript text is split on any line break and rejoined with LF.
- **Injected strings (chat-1).** `packContext` takes a `ChatStringLookup` (`(key) => string`) as its last argument. The keys `ChatLiveTranscriptEmpty`, `ChatMeetingNotFound`, `ChatTranscriptEmpty`, `ChatFolderNotSelected`, `ChatFolderNotFound`, `ChatNoMeetingsInFolder` and `ChatNoMeetingsSaved` already exist in `en.json` and `es.json`; nothing was added. The "Showing the 12 most recent..." line, `Live transcript:`, `All meetings:`, `Folder:` and `Note:` stay English literals, as in WinUI (the model reads them).
- **B12 rule (chat-1).** Single-line fields (title, folder name, action item text) have each line break replaced by one space. In multi-line free text (summary, notes, transcript, live transcript, folder note) a line is prefixed with `> ` when, after leading spaces and tabs, it starts with `Id` plus optional spaces and `:` (any case), or with one `#` followed by a space, a tab or end of line. Those are the only shapes the context and the prompt use as structure. `##` and deeper headings are untouched so Markdown summaries keep their layout. Caps are applied before the prefix, so an affected line is up to two units longer than the cap.
- **GUID comparison (chat-1).** Meeting and folder ids are compared with case, hyphens and braces ignored, as C# Guid equality does. The tie break after `RecordedAt` compares the 32-hex lowercase ids ordinally, as the spec reasons.
- **Unparseable `recordedAt` (chat-1).** Sorted last; printed as stored.
- **Live transcript snapshot (chat-1, B5).** `packContext` takes the live transcript as an argument. Package 3 must read `workspace.state.liveTranscript` and the scope decision once when the send starts and pass those values.

## Bugs fixed (chat-3 first)

- B1 (chat-3): `newChat()` is refused while sending; `state.canStartNewChat` drives the control.
- B5 (chat-3, service part): scope and live transcript are copied when `send` starts.
- B7 (chat-3): user and assistant messages have separate timestamps.
- B14 (chat-3): failures go through `formatFailure`, never raw `ex.Message`.
- B19 (chat-3): `cancel()` stops a send; a cancelled send is silent and keeps nothing.
- B20 (decision, chat-3): a failed or cancelled partial answer is discarded.
- B24 (decision, chat-3): the mismatch flag is recomputed also while sending.
- B4 (chat-3): a local budget failure (`PromptTooLong`) is surfaced as a plain too-long sentence; the 512/4096 limits are summaries' job.
- B6 (chat-3): moot, there is no persistence.

## Bugs fixed (earlier packages)

- B8 (chat-2): recipe names resolve at call time through an injected lookup; a test switches language between two calls.
- B10 (chat-2): prior-turn cuts and the thread title use the surrogate-safe cut.
- B12 (chat-2, prompt part): lines of user and prior-turn text that begin with `# Context`, `# Prior turns` or `# User message` (leading spaces or tabs and case ignored) get a `> ` prefix. The fixed prompt lines stay verbatim.
- B9 (chat-2): dropped with user recipes (owner decision 2026-11-03, may return later).

- B10 (chat-1): `cutPrefix` and `cutTail` count UTF-16 units but never split a surrogate pair. Package 2 reuses them for prior turns and the thread title.
- B12 (chat-1, context part): line breaks stripped from single-line fields and forged `Id:` or `# ` lines neutralized. The prompt part (delimiters in the prompt, brief) belongs to package 2; the brief is cut.
- B5 (chat-1, context part): live transcript is an argument.

## Left for other modules (chat-3)

- Chat-4: implement `ChatMeetingReader` (by id, by folder, all, folders) and `ProviderSource` over `SummaryProviderResolver` (map `unavailable` to `{status:'unavailable'}`), plus the IPC contract.
- Chat-7: wire `ChatService` state to the UI; run the provider gate (`use-provider-gate`) when `send` returns `setup-required` or pass it as `setupGate`; restore `originalDraft` only into an empty composer; show `failure.message`; stop button calls `cancel()`; disable New chat on `!canStartNewChat`.
- Chat-6: call `beginScopeRefresh()` before each scope read and `applyScope(token, decision)` with the result.
- Dropped in chat-3 (owner decision 2026-11-03, may return later): chat thread history (items 75 to 86, 93 to 101, ChatThread repository, chat-threads.json, History button and flyout, delete thread dialog, thread title persistence, B2, B3, B18, B6), personal tasks items 127 to 129, JsonChatThreadRepositoryTests (7) and JsonChatRecipeRepositoryTests (5). Item 44 is not applicable.

## Left for other modules

- Chat-2 leaves: send flow and thread title use in chat-3/4 (items 88 wiring), chips and slash flyout UI in chat-8 (items 107 to 112; the pure filter is `filterRecipes`).
- Dropped in chat-2 (owner decision 2026-11-03, may return later): user recipes entirely (items 113 to 115, create and delete dialogs, the chat-recipes.json repository, item 109, B9), JsonChatRecipeRepositoryTests, and the two user-row ChatRecipeListTests cases (ForScope_Meeting_ReturnsSingleBuiltInsThenUserRecipes user part, ForScope_WhenUserIdCollidesWithBuiltIn_SkipsUserRow).

- Items 1 to 11, 18, 19, 23: packages 3 and 6 (scope label, glyph, collapse, generation guard, mismatch banner). Item 19: the TypeSafe half is cut.
- Items 25 to 47: send flow and conversation UI (packages 3 and 7).
- Items 67 to 74, 154: prompt, links, recipe names (package 2).
- Items 75 to 92: persistence (package 4); thread files are cut, so only what the in-memory conversation needs remains.
- Package 3: call `resolveScopeFromWorkspace` and `matchesOpenThread`; snapshot the live transcript at send start.
- Package 2: reuse `cutPrefix` and `cutTail` from `text-cut.ts`, and `singleLine` and `neutralizeStructure` from `context-packer.ts` for prior turns.

## Chat-4 (contracts, main controller, platform reader, IPC)

Channels (`packages/contracts/src/chat.ts`): `chat.send` (request id, draft, scope, live transcript snapshot; answers `answered`, `setup-required{kind, originalDraft}`, `failed{kind, message, originalDraft}`, `cancelled{originalDraft}` or `empty`), `chat.cancel`, `chat.newChat`, `chat.state`, `chat.setScope`, `chat.meetingExists`, `chat.copyText`, `chat.openExternal`; events `chat.chunk` (request id and the text so far, about every 80 ms) and `chat.stateChanged`. Decisions:

- `empty` means nothing was sent (blank draft, hidden chat, an answer already running). A provider that returned no text is `failed` with kind `empty-answer`.
- The scope lives in the renderer; `chat.setScope` hands it to main so `showScopeMismatch` follows it (token guard from `beginScopeRefresh`/`applyScope`). `chat.stateChanged` goes out only when messages, sending, mismatch or the New chat flag change, not on every chunk.
- `LibraryChatReader` (platform) reads the light list, then parses only the newest 12 records in full (B17). Older meetings come back as stubs without text so the packer's "Showing the 12 most recent of N" count stays right.
- The fake provider streams its reply as one chunk, so the e2e proves the chunk path and ordering but not many small chunks; the many-chunk coalescing is covered by the `StreamCoalescer` tests.

## Bugs fixed (chat-4)

- B17: no send loads every transcript. Folder and All scopes parse at most 12 records; the existence check parses none (`LibraryChatReader` test counts `get` calls).
- B14: the mapper is wired in the live path; the e2e shows a not-signed-in CLI failure as a `send-failed` sentence, not raw error text.
- S2: `chat.openExternal` refuses every scheme except http and https (`file:`, `javascript:`, `ms-settings:`, custom schemes and non-URLs are tested).
- B1 (main side): `chat.newChat` answers `started:false` while an answer is running (e2e).

## Left for other modules (chat-4)

- Chat-6: call `chat.setScope` after each scope refresh, listen to `chat.stateChanged`, and read `workspace.state.liveTranscript` at the moment of sending.
- Chat-7: run the provider gate on `setup-required` (`summaries.providerStatus`, `chooseLocalModel`, `chooseCli`), then send again; restore `originalDraft` only into an empty composer; correlate `chat.chunk` by request id.
- Chat-9: use `chat.copyText`, `chat.meetingExists` and `chat.openExternal`; never `navigator.clipboard` or `window.open`.
- Tests for the controller and handlers use a service double (written together with the code, not RED first); the contract and reader tests also came with the code.

## Chat-5 (related meetings, snippet, brief cut)

- **B15 rule (decision).** Fences, `**`, `__` and backticks are removed in the spec order. A single or doubled `*` and `_` is removed only when it wraps text: the opener has no word character before it and no space after it, the closer has no space before it and no word character after it. `snake_case`, file names, URLs and `a*b` keep their markers; `*it*` and `_it_` lose them. Row 138 follows this rule.
- **Related UI.** `SummaryTab` calls `chat.meetingExists` before it navigates.
- **B22.** `Chat_ScopeFolder` is still in `en.json` and `es.json` ("Folder", "Carpeta") and `LibraryRoute.tsx` uses it for the folder crumbs label (lines 178 and 242).
- **B23.** The chat strings exist in en and es, with the same keys.

### Section 6 test map (chat-5)

| WinUI test | Vitest case |
| --- | --- |
| `MeetingSnippetTests.From_WhenSummaryPresent_PrefersSummaryOverTranscript` | `snippet.test.ts` "prefers the summary over the transcript" |
| `From_WhenSummaryMissing_UsesTranscript` | "falls back to the transcript body without headers, stamps, or speaker tags" |
| `From_WhenBothEmpty_ReturnsEmpty` | "is empty when both are empty" |
| `FromMarkdown_StripsAtxHeadingsEmphasisAndBackticks` | "strips headings, emphasis and backticks, preferring body text" |
| `FromMarkdown_WhenOnlyHeadings_KeepsHeadingText` | "keeps heading text when there is nothing else" |
| `From_WhenSummaryMissing_DropsTranscriptHeadersStampsAndSpeakerTags` | the transcript fallback test above plus `committedLineBody` tests |
| `From_WhenTranscriptHasOnlyHeaders_ReturnsEmpty` | "is empty when the transcript has only headers" |
| `FromMarkdown_CollapsesWhitespace` | "collapses whitespace and joins lines with one space" |
| `FromMarkdown_TruncatesToMaxLengthWithEllipsis` | "truncates to 140 characters plus an ellipsis" |
| `FromMarkdown_LeavesShortPlainTextUnchanged` | "leaves short text unchanged" |
| `RelatedMeetingsTests.Find_SharedSeriesId_ReturnsOtherMeetingsNewestFirst` | `related-meetings.test.ts` "matches a shared series id with a different title" and "is newest first and capped at 5" |
| `Find_ExactTrimmedTitle_MatchesWithoutSeries` | "matches the exact trimmed title, case-sensitive" |
| `Find_EmptySeriesId_DoesNotMatchOtherEmptySeries` | "a blank series never matches a blank series" |
| `Find_SameCalendarEvent_ReturnsNewestAndIgnoresBlankIds` (`FindByEventId`) | dropped, owner decision 2026-11-03, may return later (calendar cut) |
| `MeetingBriefPromptBuilderTests` (7) | dropped, owner decision 2026-11-03, may return later (calendar cut) |

### Bugs fixed (chat-5)

- B11: blank or whitespace titles never relate two meetings; a shared series id still does. The summaries test that expected the old behavior was replaced.
- B15: emphasis markers inside words, URLs and file names are kept (rule above).
- B10 (snippet): the 140 cut never splits a surrogate pair.
- B16: verified, the snippet is computed once when the index lists meetings.
- B21: a related meeting that no longer exists shows `Chat_MeetingLinkMissing` instead of navigating.
- B22, B23: verified, see above.
- B12-brief, B13, S4: dropped with the brief (owner decision 2026-11-03, may return later (calendar cut)).

### Left for other modules (chat-5)

- Chat-6 to 8: the remaining automation ids of row 153.
- Dropped, owner decision 2026-11-03, may return later (calendar cut): items 143 to 151, `MeetingBriefPromptBuilder`, RecordPage brief lifecycle, `BriefSection`, `TxtMeetingBrief`, `InfoBriefError`, `CalendarMeetingMatch.FindByEventId`.

## Items

| # | Item | Package | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Chat bar is app-global, docked below the page content, expand direction up, full width. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 2 | Bar is hidden (not collapsed-with-header) on Settings only. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 3 | Bar starts collapsed on app start. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 4 | Bar collapses whenever the resolved scope kind, folder id, or meeting id changes. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 5 | Bar expands on New chat and on opening a thread from history. | chat-6 | done | New chat expands the bar. Opening a thread from history is dropped (owner decision 2026-11-03, may return later). |
| 6 | Header shows scope chip (icon plus label), History button, New chat button. | chat-6 | done | Chip and New chat button. History button `BtnMeetingChatHistory` dropped (owner decision 2026-11-03, may return later). |
| 7 | Scope glyphs: Live, Meeting, Folder, All meetings each have a distinct icon. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 8 | Scope label for Live is `Chat_ScopeLive`. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 9 | Scope label for Meeting is `Chat_ScopeMeetingNamed` with the meeting title, else `Chat_ScopeMeeting` when missing or blank. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 10 | Scope label for Folder is `Chat_ScopeFolderNamed` with the folder name, else `Chat_ScopeFolder`. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 11 | Scope label for All meetings is `Chat_ScopeAll`. | chat-6 | done | `ChatBar.tsx`, `use-chat-scope.ts`, `chat-scope-label.ts`; `ChatBar.test.tsx` and `e2e/chat-bar.spec.ts`. |
| 12 | Surface parsing is exact and case-sensitive for `Recording`, `History`, `Settings`, `Session`; anything else is Unknown. | chat-1 | done | `parseSurface` in `scope-resolver.ts`. |
| 13 | Settings surface: invisible, AllMeetings, no ids, even during capture. | chat-1 | done | `resolveScope`, Settings first. |
| 14 | Capture active (recording or processing): Live scope on every non-Settings surface. | chat-1 | done | `resolveScope`, capture check before Session and History. |
| 15 | Session surface with a selected meeting: Meeting scope with that id. | chat-1 | done | `resolveScope`. |
| 16 | History surface with a selected (non-Inbox) folder: Folder scope with that id. | chat-1 | done | `resolveScope`. |
| 17 | Everything else: AllMeetings (History Inbox, Recording idle, Session without meeting, Unknown). | chat-1 | done | `resolveScope`. |
| 18 | Scope refresh is generation-guarded: a stale refresh is discarded. | chat-3 / chat-6 | done | `ScopeRefreshGuard`, `ChatService.beginScopeRefresh/applyScope`; stale result returns false. chat-service.test.ts |
| 19 | Scope refresh re-reads the TypeSafe availability and rebuilds recipe lists. | chat-3 / chat-6 | done | Service half only: scope refresh rebuilds nothing stored; recipe lists are derived by `recipesForScope` (chat-2). TypeSafe half cut. |
| 20 | Scope changes are raised for: shell tag change, folder publish (always), meeting id change, capture flag change; not for live transcript text changes. | chat-1 | done | Already provided by `Workspace` (`library/workspace.ts`); proven by a test in `scope-resolver.test.ts`. chat-4 verified: `workspace.changed` carries the state with every scope input (`currentShellTag`, `selectedFolderId`, `selectedMeetingId`, `isCaptureActive`) and `liveTranscript`, so no new event was added. Chat-6 must not refresh the scope when only `liveTranscript` changes. |
| 21 | Live transcript is read from the workspace at send time, not subscribed. | chat-1 | done | `Workspace.state.liveTranscript` is read by the caller; `packContext` takes it as an argument (B5). chat-4: `chat.send` carries `liveTranscript` from the renderer's workspace state at the moment of sending; main passes it to `ChatService.send` unchanged. |
| 22 | Match test for open thread uses kind, folder id, and meeting id with null equality. | chat-1 | done | `matchesOpenThread`. |
| 23 | Mismatch banner text `Chat_ScopeMismatch` shows when an open thread does not match the current scope; not recomputed while sending (decide whether to keep B24). | chat-3 / chat-6 | improved | `state.showScopeMismatch` is derived on every read, so it is recomputed also while sending (B24 decision: keep the fix, the banner follows the live scope). Banner UI is chat-6. |
| 24 | A mismatched open thread is not edited; the next send creates a new thread. | chat-1 | done | Pure rule only; the next send creating a new thread is package 3. |
| 25 | Draft binds on every keystroke. | chat-7 | done | `useChat` keeps the draft in state on every change (`Composer` is controlled). |
| 26 | Enter sends; Shift+Enter newline; Ctrl+Enter sends. | chat-7 | done | `keyIntent` in `chat-view-model.ts`; component tests for Enter, Shift+Enter, Ctrl+Enter. |
| 27 | Enter with an empty draft or while sending does nothing and does not insert a newline. | chat-7 | done | `keyIntent` returns `swallow`: Enter is prevented on an empty draft or while sending. |
| 28 | Enter during IME composition must not send (new, S1). | chat-7 | done | S1: Enter with `isComposing` is ignored (component test). |
| 29 | Send enabled iff not sending, visible, and draft non-blank. | chat-7 | done | Service half: `send` returns `ignored` unless not sending, visible and the trimmed draft is non-empty. UI half: `BtnMeetingChatSend` is disabled unless not sending and the trimmed draft is non-empty (component test). |
| 30 | Placeholder `Chat_Composer.PlaceholderText`; Send tooltip `Chat_Send` "Send (Enter)". | chat-7 | done | Placeholder and Send tooltip come from the existing keys; the Send button has the accessible name `Chat_Send`. |
| 31 | Composer min height 32, max 96, min width 180, wraps, scrolls. | chat-7 | done | `Composer` textarea grows from 32 to 96 px, min width 180, scrolls past that. |
| 32 | Message text is `Draft.Trim()`. | chat-7 | done | `send` trims the draft; `originalDraft` returns it untrimmed. |
| 33 | Optimistic user row plus pending assistant row appear immediately; draft clears immediately. | chat-7 | done | UI half: `sendStarted` adds the user row and the pending row and the draft clears at once (reducer and component tests). |
| 34 | Pending row shows spinner plus `Chat_Thinking` until first visible text. | chat-7 | done | Pending row: spinner plus `Chat_Thinking.Text` until the first text arrives. |
| 35 | Streaming shows Markdown live; first push on first non-whitespace chunk; further pushes at most every 80 ms; final flush at end; leading whitespace trimmed in pushes. | chat-7 | done | UI half: `chunk` replaces the pending row text and the answer renders through `MarkdownView` while it streams (component test; e2e saw the Thinking row give way to the answer). |
| 36 | Transcript auto-scrolls to the end on new rows and on every streamed text change. | chat-7 | done | `MessageList` sets scrollTop to the end on every rows change (every streamed push too). Observed: `e2e/chat-layout.spec.ts` asserts the transcript is scrollable and ends at the bottom (audit round 4 corrected the old remark). |
| 37 | Provider is resolved per send from settings; gating dialogs (local model download, CLI check, xAI sign-in) run via the shared resolver. | chat-3 / chat-7 | done | Service half: `ProviderSource.resolve()` per send; `needs-setup` returns `setup-required`, or runs an optional `setupGate`. The gate dialogs reuse features/summaries/use-provider-gate in chat-7. xAI selection returns `provider-removed` with Ui_SummaryProviderXaiRemoved. chat-4 (main half): `chatProviderSource` maps the summaries resolver (`resolveSummaryProvider`) to `ProviderSource`; the fake native build uses the same `FakeSummaryProvider` override as summaries. `chat.send` answers `setup-required{kind}` with the draft; the page runs the gate and sends again (no `setupGate` in main). |
| 38 | Cancelled/unsatisfied gate shows `Status_SetupCancelled` and keeps the user's turn out of history. | chat-3 / chat-7 | done | UI half: `useChat` runs `useProviderGate` on `setup-required`, sends once more on completion; a cancelled gate rolls back, restores the draft and shows `Status_SetupCancelled` (component tests). |
| 39 | Provider exception shows `Chat_SendFailed` with the message. | chat-3 / chat-7 | done | The failed outcome message (already `Chat_SendFailed`) shows in the error notice; e2e uses a failing fake provider. |
| 40 | Blank answer shows `Chat_EmptyAnswer` and persists nothing. | chat-3 / chat-7 | done | `Chat_EmptyAnswer` arrives as a failed outcome and shows in the error notice. |
| 41 | Answer text is trimmed before persisting. | chat-3 / chat-7 | done | Answer trimmed before it is kept. |
| 42 | On failure both optimistic rows are removed and the draft is restored only if the composer is still empty. | chat-3 / chat-7 | done | UI half: `rolledBack` removes both rows and `restoreDraft` puts the draft back only into an empty composer (reducer, component and e2e tests). |
| 43 | `IsSending` is always cleared in a finally path. | chat-3 / chat-7 | done | `sending` and `pending` cleared in `finally`. |
| 44 | Failed UI marshalling reports `Chat_UiMarshalFailed`. | dropped | dropped | Not applicable: no dispatcher marshalling in the port, so `Chat_UiMarshalFailed` cannot happen. |
| 45 | Error bar is closable, titled `Chat_Error`, severity error; cleared at the start of each send and on New chat. | chat-3 / chat-7 | done | `ChatErrorNotice` reuses `ui/Notice`: closable, titled `Chat_Error.Title`, `InfoMeetingChatError`; cleared by `sendStarted` and by New chat (the bar remounts the body). Severity: `ui/Notice` gained an `error` tone (role alert, `data-tone="error"`); `ChatErrorNotice` uses it, pinned in `ChatBody.test.tsx` (audit round 4). The look stays ink on a hairline, as in the design direction. |
| 46 | Starter chips hidden while sending or when any message exists. | chat-3 / chat-7 | done | `StarterChips` render only when there are no rows and nothing is sending; a chip sends its prompt at once, tooltip is the prompt. |
| 47 | Optional improvements agreed for the port: block New chat/open/delete during send (B1); stop button (B19). | chat-3 / chat-7 | done | B1 UI half: New chat is disabled while sending (chat-6 reads `canStartNewChat`); stop button `BtnMeetingChatStop` with new string `Ui_ChatStop` (en, es). |
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
| 67 | Prompt text lines match section 3.4 verbatim, in order. | chat-2 | done | prompt-builder.test.ts Build_AnyScope_TellsModelNotToInvent |
| 68 | `Scope: ` label uses the English labels `All meetings`/`Folder`/`Meeting`/`Live`. | chat-2 | done | prompt-builder.test.ts scope labels |
| 69 | Rewrite instruction only for Meeting scope when the message contains `rewrite` (case-insensitive substring). | chat-2 | done | prompt-builder.test.ts Build_WhenMessageContainsRewrite |
| 70 | Sections `# Context`, `# Prior turns`, `# User message` with blank lines between. | chat-2 | improved | prompt-builder.test.ts layout; B12 headings neutralized |
| 71 | Prior turns: last 8 messages, each `role: text`, text cut to 1500; `(none)` if empty. | chat-2 | improved | prompt-builder.test.ts Build_PriorTurns; B10 cut is surrogate-safe |
| 72 | User message appended without a trailing newline. | chat-2 | done | prompt-builder.test.ts layout (no trailing newline) |
| 73 | Citation prefix `https://meetinglive.local/meeting/` plus 32-hex Id. | chat-2 | done | prompt-builder.test.ts MeetingLink_RoundTrips |
| 74 | `TryParseMeetingLink` rules: null false; prefix match ignoring case; trailing slashes trimmed; Guid parse. | chat-2 | done | prompt-builder.test.ts TryParseMeetingLink_* |
| 75 | Threads file `chat-threads.json` in the app data directory; recipes `chat-recipes.json`. | dropped | dropped | owner decision 2026-11-03, may return later |
| 76 | camelCase property names; nulls written; Guid `D` format; ISO-8601 offset timestamps. | dropped | dropped | owner decision 2026-11-03, may return later |
| 77 | `scopeKind` stored as PascalCase enum name; reading accepts case-insensitive names. | dropped | dropped | owner decision 2026-11-03, may return later |
| 78 | Required members enforced on read (decide the tolerant behavior from B3 in the port, but keep file compatibility). | dropped | dropped | owner decision 2026-11-03, may return later |
| 79 | Missing messages array becomes empty. | dropped | dropped | owner decision 2026-11-03, may return later |
| 80 | Save is upsert by id, preserving file position when replacing, appending when new. | dropped | dropped | owner decision 2026-11-03, may return later |
| 81 | Delete of a missing id does nothing and does not create the file. | dropped | dropped | owner decision 2026-11-03, may return later |
| 82 | Thread list order: `updatedAt` desc, `createdAt` desc, `id` desc. | dropped | dropped | owner decision 2026-11-03, may return later |
| 83 | Recipe list order: file order. | dropped | dropped | owner decision 2026-11-03, may return later |
| 84 | All repository operations are serialized in-process. | dropped | dropped | owner decision 2026-11-03, may return later |
| 85 | Directory created on first write. | dropped | dropped | owner decision 2026-11-03, may return later |
| 86 | Writes should be atomic (B2) and files remain readable by the old format. | dropped | dropped | owner decision 2026-11-03, may return later |
| 87 | Thread created on first successful send only. | chat-4 | improved | In-memory: the conversation is created on the first successful send only; failure keeps nothing. |
| 88 | Thread title is the first message trimmed, line breaks to single space, max 60. | chat-4 | dropped | Thread history is cut (owner decision 2026-11-03, may return later); the unused title helper was deleted. |
| 89 | `CreatedAt`/`UpdatedAt` use local time with offset; user and assistant messages of a turn share one timestamp (decide whether to fix B7). | chat-4 | improved | B7 fixed: the user message is stamped at send start and the assistant message when the answer is done, from the injected Clock. |
| 90 | `UpdatedAt` is bumped each turn; titles never change. | chat-4 | dropped | No thread record exists in the in-memory conversation (owner decision 2026-11-03, may return later). |
| 91 | Save failure restores the in-memory message list and shows the error. | dropped | dropped | No persistence, so a save failure cannot happen. The in-memory list is only written after success. |
| 92 | After a successful turn the transcript is re-rendered from the persisted thread and the thread list is refreshed. | chat-4 | improved | In-memory equivalent: `state.messages` is the whole conversation after a successful turn. |
| 93 | History flyout reloads threads when opened. | dropped | dropped |  |
| 94 | Empty state `Chat_HistoryEmpty`. | dropped | dropped |  |
| 95 | Rows show title (blank gives `Chat_Untitled`) and `Chat_ThreadUpdated` with a local short date-time. | dropped | dropped |  |
| 96 | Clicking a row opens that thread, closes the flyout, expands the bar, scrolls to end. | dropped | dropped |  |
| 97 | Opening a missing thread resets to a new chat when it was open, and refreshes the list. | dropped | dropped |  |
| 98 | Delete button per row opens the confirm dialog with title `Chat_DeleteThreadTitle`, content with title, default button Close. | dropped | dropped |  |
| 99 | Confirming deletes the thread; clears the view if it was open; refreshes the list. | dropped | dropped |  |
| 100 | New chat clears messages, draft, error, mismatch, and open thread. | chat-3 / chat-7 | done | Not dropped: the New chat button is live. `chat-service.test.ts` (messages), `e2e/chat-layout.spec.ts` "New chat clears the error and the restored draft", `ChatBar` epoch key remounts the body. |
| 101 | Threads list shows all threads regardless of scope. | dropped | dropped |  |
| 102 | Built-in recipes: eight entries with the exact ids, names, availability, and prompts from 3.7. | chat-2 / chat-8 | done | recipes.test.ts BuiltIns_ListsSingleAndMultipleRecipes |
| 103 | Built-ins are never written to disk. | chat-2 / chat-8 | done | catalog is code only; no repository exists |
| 104 | Scope to availability: Meeting/Live single; Folder/All multiple. | chat-2 / chat-8 | done | recipes.test.ts AvailabilityFor_MatchesScope |
| 105 | Scope list = built-ins (catalog order) then user recipes (file order); user rows with colliding built-in ids skipped (apply the B9 fix or keep, but document). | chat-2 / chat-8 | improved | recipes.test.ts ForScope; built-ins only, user half dropped (owner decision 2026-11-03, may return later), B9 moot |
| 106 | Starter chips = first 4 of the scope list. | chat-2 / chat-8 | done | recipes.test.ts starterRecipes; chips UI in chat-8 |
| 107 | Chip click fills the draft and sends immediately. | chat-2 / chat-8 | done | e2e `chat-recipes.spec.ts` "a chip click sends and streams the answer"; chip behavior from chat-7. |
| 108 | Recipes flyout lists name and two-line prompt preview; item click fills the draft without sending, closes the flyout, focuses and puts the caret at the end. | chat-2 / chat-8 | done | `RecipesMenu.test.tsx` (fill without send, closes, focus, caret at end); e2e click fills the draft. |
| 109 | Delete icon only on user recipes; built-ins cannot be deleted even through the API. | chat-2 / chat-8 | dropped | moot: no user recipes (owner decision 2026-11-03, may return later); built-ins have no delete path |
| 110 | Slash filter opens automatically when the draft starts with `/`, filtering by name or prompt, case-insensitive substring of `Draft[1..].Trim()`. | chat-2 / chat-8 | done | `RecipesMenu.test.tsx` slash filter cases; e2e `/ac` leaves one row. |
| 111 | Button-open shows the full list; slash-open shows the filtered list. | chat-2 / chat-8 | done | `RecipesMenu.test.tsx` button-open lists all (5 meeting, 3 folder); e2e checks both counts. |
| 112 | Empty state `Chat_NoRecipes`. | chat-2 / chat-8 | done | `RecipesMenu.test.tsx` "No recipes for this scope." on a filter with no match. |
| 113 | Create recipe dialog fields, placeholders, availability radio with default from current scope, validation that blocks Save on blank name or prompt. | dropped | dropped |  |
| 114 | Saved recipe: new Guid, trimmed name and prompt, availability from the radio, `CreatedAt` now. | dropped | dropped |  |
| 115 | Delete recipe dialog `Chat_DeleteRecipe*` strings, default Close. | dropped | dropped |  |
| 116 | Recipe errors surface through the chat error bar. | dropped | dropped |  |
| 117 | User messages are plain text bubbles, right-aligned, max about 75% width, selectable. | chat-9 | done | `MessageRow`: right-aligned bubble, max 75% width, selectable plain text. |
| 118 | Assistant messages render Markdown (headings, lists, emphasis, code, tables, links); no raw HTML. | chat-9 | done | `MarkdownView.tsx` and `markdown.ts` now read pipe tables as well; raw HTML stays text. `MarkdownView.test.tsx`, `markdown.test.ts`, `e2e/chat-links.spec.ts` (light and dark screenshots `chat-links-answer-*.png`). |
| 119 | Role labels `Chat_RoleUser` and `Chat_RoleAssistant` exist; assistant label shown above the answer. | chat-9 | done | Assistant label `Chat_RoleAssistant` above the answer; user rows carry `Chat_RoleUser` in their accessible text. |
| 120 | Copy button on completed assistant messages copies the raw Markdown; failure shows `Chat_CopyFailed`. | chat-9 | done | `MessageRow` copy button calls `chat.copyText` with the raw Markdown; `Chat_CopyFailed` goes to the error notice. `e2e/chat-links.spec.ts` reads the clipboard and compares it with the scripted reply. |
| 121 | Transcript list max height 420 with internal scrolling. | chat-9 | done | `MessageList` max-h 420 with internal scrolling. |
| 122 | Meeting citation links open the meeting on the Summary tab (select meeting, navigate to Session). | chat-9 | done | `use-chat-links.ts`: `chat.meetingExists`, then `workspace.dispatch` selectMeeting and openSession on the Summary tab. `use-chat-links.test.tsx` and the e2e spec. Main half (chat-4): `chat.meetingExists` takes the hex or hyphenated id and answers the stored id. |
| 123 | Missing cited meeting shows `Chat_MeetingLinkMissing`. | chat-9 | done | The missing citation puts `Chat_MeetingLinkMissing` in the chat error notice (`InfoMeetingChatError`); no navigation. Unit and e2e. |
| 124 | http(s) links open in the system browser; other schemes are ignored. | chat-9 | done | `chat.openExternal` for http and https, target visible in the link `title`. Any other scheme is not a link at all: `safeHref` drops it and the label shows as plain text. The e2e opener double is `VOZELLA_FAKE_OPENED_LOG` (fake native only). Main half (chat-4): `rejected` for other schemes (S2). |
| 125 | Link handler errors surface in the error bar. | chat-9 | done | A thrown error or a `failed` answer from the handler goes to the error notice through `Chat_SendFailed` (unit tests). |
| 126 | Accessible text of each row is `Role: text` (or just the role while thinking). | chat-9 | done | Each row is a list item named `Role: text`; a thinking row is named just the role (component and e2e tests). |
| 127 | Button visible only in Meeting scope when TypeSafe is enabled and an API key exists. | dropped | dropped |  |
| 128 | Click opens the Personal tasks dialog for the current meeting id; ignores clicks while opening. | dropped | dropped |  |
| 129 | Availability is re-read on scope refresh and when the bar expands. | dropped | dropped |  |
| 130 | Related = other meetings with the same trimmed non-empty series id OR the same trimmed title (ordinal, case-sensitive), excluding the current id. | chat-5 | done | `findRelated` in `summaries/related-meetings.ts`; tests in `related-meetings.test.ts`. Blank titles no longer match (B11). |
| 131 | Order by `RecordedAt` desc. | chat-5 | done | Sort by parsed instant, ties keep input order (test "orders by instant"). |
| 132 | Blank series ids never match each other. | chat-5 | done | Test "a blank series never matches a blank series". |
| 133 | Summary page shows at most 5, newest first, with title and local short date-time. | chat-5 | done | Cap of 5 tested; renderer shows title and local date (`SummaryTab.test.tsx` related meetings). |
| 134 | Section hidden when empty; click opens that meeting's Summary tab. | chat-5 | improved | Hidden when empty (tested in `RelatedMeetings.test.tsx`, audit round 4). Click checks `chat.meetingExists` first; a missing meeting shows `Chat_MeetingLinkMissing` and does not navigate (B21). |
| 135 | Summary preferred over transcript when summary is not blank. | chat-5 | done | `snippet.test.ts` "prefers the summary over the transcript". |
| 136 | Transcript fallback drops `Recorded `/`Ended ` header lines, timestamp ranges, and `[ Speaker-N ]` tags. | chat-5 | done | `snippet.test.ts` transcript fallback test; line grammar is the transcription parser. |
| 137 | Heading lines (1 to 6 `#` then space or end) go to a secondary buffer used only when no body text exists. | chat-5 | done | `snippet.test.ts` heading tests. |
| 138 | Marker stripping removes ```` ``` ````, `**`, `__`, `` ` ``, `*`, `_` in that order. | chat-5 | improved | Fences, `**`, `__`, backticks kept in spec order; single and doubled `*` and `_` are stripped only when they wrap text (B15 rule in `snippet.ts`). |
| 139 | Whitespace runs collapse to one space; result trimmed. | chat-5 | done | `snippet.test.ts` "collapses whitespace". |
| 140 | Truncate to 140 chars plus `…`. | chat-5 | improved | 140 UTF-16 units plus the ellipsis, cut never splits a surrogate pair (B10, `cutPrefix`). |
| 141 | Empty snippet shows `History_NoContent`. | chat-5 | done | Library row shows `History_NoContent` for an empty snippet (library module). |
| 142 | Snippet computed once per meeting row load (B16 improvement). | chat-5 | done | The snippet is built once when the index lists the meetings (`markdown-meeting-repository.test.ts` "computes the snippet once per file version": a second listing returns the same cached item while mtime and size match); the UI never recomputes it (B16). |
| 143 | `HasUsefulContext` gate runs before any provider setup or model call. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 144 | Brief prompt text matches 3.10 verbatim, with attendees joined by `, `, agenda trimmed, and at most 3 prior meetings. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 145 | Prior meeting block includes title attribute, summary, notes, action item texts joined by `; `, each defaulting to `(none)`. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 146 | Normalize returns null for blank or `NONE` (case-insensitive). | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 147 | Generation counter discards stale results after the note is reset or another event is opened. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 148 | Provider failure shows `RecordPage_BriefFailedFormat` with the mapped message; cancelled provider setup is silent. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 149 | Brief persists to the linked existing meeting; save errors show in the same error bar. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 150 | Brief shown only while the coming-up note is open and not processing; passed to the pipeline and to live answers. | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 151 | Brief renders as Markdown in the port (B13). | chat-5 | dropped | owner decision 2026-11-03, may return later (calendar cut): pre-meeting brief, not built; brief frontmatter and Brief section pass through untouched. |
| 152 | All strings above exist in en and es, with the same keys, including placeholders `{0}`. | chat-9 | done | No new strings in chat-9; every key it shows already existed in en and es. |
| 153 | Automation ids preserved: `BarMeetingChat`, `LblMeetingChatScope`, `BtnMeetingChatHistory`, `ListMeetingChatHistory`, `BtnMeetingChatNew`, `ListMeetingChat`, `InfoMeetingChatError`, `ListMeetingChatStarters`, `TxtMeetingChat`, `BtnMeetingChatSend`, `BtnMeetingChatPersonalTasks`, `BtnMeetingChatRecipes`, `ListMeetingChatRecipes`, `ListRelatedMeetings`, `TxtMeetingBrief`, `BriefSection`, `InfoBriefError`. | none for chat-1 | done (ListRelatedMeetings only) | `ListRelatedMeetings` is a `data-testid` on the list in `RelatedMeetings.tsx` (B21 test finds it). The other ids belong to chat-6/7/8; `TxtMeetingBrief`, `BriefSection`, `InfoBriefError` dropped (owner decision 2026-11-03, may return later (calendar cut)). Chat-7 added `ListMeetingChat`, `InfoMeetingChatError`, `ListMeetingChatStarters`, `TxtMeetingChat`, `BtnMeetingChatSend` as `data-testid` (the composer and send button also `id`). `BtnMeetingChatPersonalTasks` (JEV/TypeSafe cut), `BtnMeetingChatHistory` and `ListMeetingChatHistory` (chat thread history cut) are dropped: owner decision 2026-11-03, may return later; no dead controls exist. `BtnMeetingChatRecipes` and `ListMeetingChatRecipes` were added by chat-8 as `data-testid` (also `PopupMeetingChatRecipes`, `ItemMeetingChatRecipe`). |
| 154 | Built-in recipe names resolve at call time against the current UI language (fix for B8). | chat-2 | improved | recipes.test.ts B8 test switches language between calls |
| 155 | Every test named in section 6 has an equivalent in the new test suite, plus new tests for B1, B3, B10, and the send/rollback flow. | chat-9 | done | See the audit index below: every section 6 class has one row. |

## Chat-6 (chat bar in the shell)

- Items 1 to 11 done. Item 18 UI half: `use-chat-scope.ts` bumps a generation on every refresh and discards a name lookup that finishes late (unit test "discards a name lookup...").
- Item 153: `BarMeetingChat`, `LblMeetingChatScope` and `BtnMeetingChatNew` are `data-testid` values (the first and last also `id`). `BtnMeetingChatHistory` dropped (owner decision 2026-11-03, may return later, thread history cut).
- Item 152 (shell strings): only existing keys are used (`Chat_Bar.AutomationProperties.Name`, `Chat_New.*`, `Chat_Scope*`). No new strings.
- Decisions: scope comes from `workspace.getState` and `workspace.changed` (the shell dispatches the router tag into the workspace); names come from `library.getMeeting` and `library.load`, refreshed on `library.changed` so a rename updates the chip. The bar calls `chat.setScope` when the scope changes and tracks `canStartNewChat` from `chat.stateChanged`, so New chat is disabled while an answer runs. The body is a `children` slot, rendered only while open. The bar sits in the content column below `<main>`, so expanding it shrinks the page area (no overlay).
- Tests were written after the code, not RED first. Screenshots in `docs/port/screens/chat/`.

### Bugs fixed (chat-6)

- None found in the WinUI behavior for this package.

### Left for other modules (chat-6)

- Chat-7: pass the conversation as `children` of `<ChatBar>` in `AppShell.tsx`; the body area is 360 px high (45 vh at most) with 40 px side padding.

## Chat-7 (conversation UI)

Files in `apps/desktop/src/renderer/features/chat/`: `ChatBody` (container), `use-chat` (IPC, stream, gate, rollback), `chat-view-model` (reducer, `keyIntent`, `restoreDraft`), `MessageList`, `MessageRow`, `Composer`, `StarterChips`, `ChatErrorNotice`. `ChatBar` now takes its body as a function of the scope and remounts it on New chat, which drops the draft and the error with the old messages. Tests: `chat-view-model.test.ts`, `ChatBody.test.tsx`, `e2e/chat-conversation.spec.ts`; screenshots in `docs/port/screens/chat/chat-conversation-*.png`.

### Decisions (chat-7)

- Main owns the conversation. The page mirrors `chat.state` and `chat.stateChanged` only while no send runs, so optimistic rows are never overwritten.
- After a gate completes, the same two rows stay and the send goes out again under a new request id, so stale chunks of the first request are ignored.
- A scope mismatch send starts the list afresh (`replace`), matching what main keeps.
- The copied check mark shows only when the clipboard write succeeded; a failed copy shows `Chat_CopyFailed` as a plain notice without the "could not answer" title.
- Spinner for Thinking is a rotating glyph that stops under reduced motion.
- Answer headings are shown at body size so a reply does not look like a page.
- `Setup cancelled.` shows as a plain notice with no title.
- Collapsing the bar unmounts the body, so an unsent draft is lost on collapse; messages are kept in main.

### Bugs fixed (chat-7)

- B1 (UI half): New chat is disabled while sending.
- B19: the stop button cancels the running answer; the draft returns and no notice shows.
- B20: a stopped or failed answer shows an error only for failures; the partial text never becomes a row.
- B24: the mismatch text follows the live scope also while sending.
- S1: Enter during IME composition no longer sends.

### Left for other modules (chat-7)

- Links in answers still use the default `MarkdownView` navigation; `MarkdownView` accepts an `onLink` handler for chat-9 (citation links and the http/https check).
- Recipes flyout and slash filter (chat-8).
- The failed-answer notice repeats "Could not answer" in its title and in `Chat_SendFailed`; the key text is shared with the earlier packages and was left alone.

## Chat-8 (Recipes flyout and slash filter)

- Files: `RecipesMenu.tsx`, `use-recipes-menu.ts`, a small edit in `Composer.tsx` (button, key hook) and `ChatBody.tsx` (passes the full scope list).
- Decision: no Menu/Popover from `ui` fits. The base-ui Menu moves focus into the popup, and S7 needs focus to stay in the textarea. The flyout is a listbox the textarea points at with `aria-activedescendant`, positioned above the composer, 320 px wide, list max height 240.
- S7: arrows move the highlight only after the first ArrowDown, so Enter keeps sending a typed draft until a row is highlighted. Escape closes. A press outside or focus leaving the composer closes it.
- Suppress flag: a pick fills the draft and the next draft change skips the slash filter once, then focuses the field and puts the caret at the end.
- Item 116 stays dropped with user recipes; 113 to 115 cross-checked, no delete icon or New recipe button exists (tested).
- Sending a draft that starts with `/` sends it literally (tested).
- Screenshots: `docs/port/screens/chat/chat-recipes-flyout-light.png`, `chat-recipes-slash-light.png`, `chat-recipes-flyout-dark.png` (Spanish).

### Bugs fixed (chat-8)

- None found in the C# flows. The prompts of built-in recipes stay English in every language, as in the original.

### Left for other modules (chat-8)

- Recipe prompts are not localized (original behavior); revisit only if the owner asks.
- The flyout can cover the New chat button while open; it closes on any outside press.
- Not observed: screen reader announcement of the highlighted row (only the ARIA wiring is tested).

## Chat-9 (answer Markdown, citations, external links) and final audit

- `use-chat-links.ts` classifies an address: a meeting citation (parsed with `tryParseMeetingLink` after percent decoding, because the Markdown reader normalizes braces to `%7B`), a web address, or ignored. Every click calls `preventDefault`, so the page never navigates and the window never opens a second tab.
- Decision: `CitationLink.tsx` was not created. `MarkdownView` already renders the anchor, and a second component would only wrap it.
- `MarkdownView` and `markdown.ts` gained pipe tables and a `title` on links. `onLink` already existed from chat-7. `MessageRow` and `MessageList` take one `onLink` prop; `ChatBody` supplies it, and `useChat.reportError` feeds the error notice.
- S3 is documented: a braced or hyphenated id parses; an unknown id shows `Chat_MeetingLinkMissing`. Models that invent ids get that message.
- E2E hooks, fake native only: `VOZELLA_FAKE_CHAT_REPLY` replaces the reply of chat prompts, and `VOZELLA_FAKE_OPENED_LOG` receives each address the opener would open.

### Bugs fixed (chat-9)

- A braced citation id would have been treated as a web link once the reader encoded it; it now routes to the meeting lookup.
- Unfinished syntax (bold, fence, link, table header) never throws at any cut point of a streamed answer (a test cuts a full reply at every index).

### Left for other modules (chat-9)

- Real CLI and local-model answers have not been seen rendering; the screenshots use a scripted reply (pending-real-validation for the model side only).
- Screen reader behavior of links and the table was not observed.

### Audit index (final)

Every item 1 to 155 above has one row. Bugs, suggestions and section 6 test classes, one row each:

| Id | Status | Evidence |
| --- | --- | --- |
| B1 | improved | `newChat` refused while sending; New chat disabled (chat-3, chat-6, chat-7) |
| B2 | dropped | owner decision 2026-11-03, may return later (thread files) |
| B3 | dropped | owner decision 2026-11-03, may return later (thread and recipe files) |
| B4 | improved | `PromptTooLong` shown as a plain sentence (chat-3) |
| B5 | improved | live transcript snapshot at send start (chat-1, chat-3, chat-7) |
| B6 | dropped | owner decision 2026-11-03, may return later (no thread persistence) |
| B7 | improved | separate timestamps (chat-3) |
| B8 | improved | recipe names resolved per call (chat-2) |
| B9 | dropped | owner decision 2026-11-03, may return later (user recipes) |
| B10 | improved | surrogate-safe cuts everywhere (chat-1, chat-2, chat-5) |
| B11 | improved | blank titles never relate (chat-5) |
| B12 | improved | context and prompt neutralizer (chat-1, chat-2); the brief part is dropped with the calendar cut |
| B13 | dropped | owner decision 2026-11-03, may return later (brief) |
| B14 | improved | failures mapped, never raw messages (chat-3, chat-4) |
| B15 | improved | snippet keeps markers inside words (chat-5). Decision (audit round 4): list bullets, `>`, table pipes and `[text](url)` stay in the snippet as in WinUI, because the spec states them as observed behavior with no port rule; pinned in `snippet.test.ts`. Markers are stripped per line, so a `**` opened on one line and closed on the next is kept, same as WinUI's per-line pass. |
| B16 | done | snippet computed once per listing (chat-5) |
| B17 | improved | at most 12 meetings parsed in full (chat-4) |
| B18 | dropped | owner decision 2026-11-03, may return later (thread history) |
| B19 | improved | Stop button and `chat.cancel` (chat-3, chat-7) |
| B20 | done | partial answer discarded by decision (chat-3) |
| B21 | improved | missing related meeting shows `Chat_MeetingLinkMissing` (chat-5); the same for citations (chat-9) |
| B22 | done | `Chat_ScopeFolder` kept for Library (chat-5) |
| B23 | done | en and es chat strings present, same keys |
| B24 | improved | mismatch follows scope while sending (chat-3, chat-7) |
| S1 | improved | Enter ignored during IME composition (chat-7) |
| S2 | improved | only http and https open (chat-4, chat-9); no confirmation dialog, as in WinUI |
| S3 | done | documented, an unknown id shows the missing message (chat-9) |
| S4 | dropped | owner decision 2026-11-03, may return later (brief) |
| S5 | improved | scope refresh token discards stale results (chat-3, chat-6) |
| S6 | done | unchanged on purpose: a spoken line starting with `#` is still a heading in the snippet |
| S7 | improved | listbox keeps focus in the textarea (chat-8) |
| S8 | kept | no output language is passed to chat prompts, as in WinUI. Proven in `chat-service.test.ts` (provider called with prompt and cancel only, prompt has no language text). Real local-model answers stay unverified, so no more can be proven here. |
| ChatContextPackerTests, ChatScopeResolverTests | done | chat-1 |
| ChatPromptBuilderTests | done | chat-2 |
| ChatThreadTitleTests | dropped | owner decision 2026-11-03, may return later (chat thread history cut); no thread title function exists |
| ChatRecipeCatalogTests, ChatRecipeListTests | done | chat-2 (built-in cases); the user-recipe cases are dropped, owner decision 2026-11-03, may return later |
| JsonChatThreadRepositoryTests, JsonChatRecipeRepositoryTests | dropped | owner decision 2026-11-03, may return later |
| MeetingBriefPromptBuilderTests | dropped | owner decision 2026-11-03, may return later (calendar cut) |
| MeetingSnippetTests, RelatedMeetingsTests | done | chat-5 test map above; the event-id case is dropped |

Real CLI and local-model answers remain unverified for every row that depends on them (pending-real-validation); the fake provider was used throughout.

## Audit round fixes

| Item | Status | Evidence or decision |
|---|---|---|
| 18, 19, 20 scope delivery | fixed | `use-chat-scope.ts` tracks delivery to main separately from the generation guard, so a superseded refresh still hands main the final scope. `ChatBar.test.tsx` "delivers the final scope". |
| 20 live transcript refresh | fixed | `workspace.changed` that resolves to the same scope is skipped. `ChatBar.test.tsx` "does not refresh when only the live transcript changes". |
| 30 Send tooltip | proven | `ChatBody.test.tsx` asserts "Send (Enter)". |
| 31, 117, 121, 36 layout and scroll | proven | `e2e/chat-layout.spec.ts`: composer 32 to 96 and min width 180, bubble right aligned at most 75 percent and selectable, transcript at most 420 with internal scroll and scrolled to the end. |
| 37 gate reasons | proven | `ChatBody.test.tsx` opens the CLI surface for ClaudeCode and Codex. |
| 39, 43 rejected chat.send | proven | `ChatBody.test.tsx` rolls back, restores the draft, shows a mapped sentence and allows another send. |
| 45 error cleared on New chat | proven | `e2e/chat-layout.spec.ts`. |
| B14, 125 raw error text | fixed | Controller catch, renderer catch and link errors go through `sendFailedFailure` (`formatFailure`); the controller gets `translate`. |
| Duplicate "Could not answer" | fixed | `ChatErrorNotice` drops the repeated lead when the title is shown. |
| B19 stop before send reaches main | fixed | `use-chat.ts` `stopEarly`; `ChatBody.test.tsx` "Stop before chat.send reaches main". |
| 51, 59 packer | proven | `context-packer.test.ts` Meeting scope uncapped, AllMeetings ignores the folder id. |
| 133 related date | proven | `SummaryTab.test.tsx` row shows title and short date-time. |
| S6 | proven | `snippet.test.ts` pins the retained heading behavior. |
| Section 7 decisions | decided | Live scope with an empty transcript stays sendable (the packer adds `ChatLiveTranscriptEmpty`; `chat-service.test.ts` sends with empty, blank and null transcripts). Folder scope matches the exact folder id only and excludes sub-folders, as in WinUI (`context-packer.test.ts`, `library-chat-reader.test.ts`). Mismatch banner wiring (B24) is proven through the real service, controller and handlers in `chat-wiring.test.ts`. Recipe descriptions are the English prompt text sent to the model, as in `ChatRecipeCatalog.cs`; only the titles are localized, so descriptions stay English in Spanish (rejected as a finding). The error notice repeat was already fixed (body drops the lead; the old screenshot predates it). A meeting deleted while the chat is open answers with `ChatMeetingNotFound`. Search, rename, export, regenerate, message delete and token usage: dropped with thread history (owner decision 2026-11-03, may return later). |
| Recipe descriptions in Spanish | rejected | The line under a recipe name is the prompt sent to the model; WinUI keeps built-in prompts in English, so they are not localized. |
| Raw `[ ]` in answers | rejected | It is the fake provider's Markdown; the real model output is rendered as sent. |
| Skipped dark screenshot test | rejected | It is gated by VOZELLA_SCREENSHOTS by design; not a failure. |
| S8 output language | kept | tested (audit round 4); unchanged: WinUI passes no language to chat prompts. |
| B12 line endings | kept | Prompt neutralization normalizes line terminators to LF; harmless for the model, recorded here as a deviation from item 72. |
| Chip pick replaces a typed draft | kept | Matches WinUI (a chip sends at once); on rollback the chip text returns. Low severity, no change. |
| app-paths chat thread and recipe paths | kept | Unused leftovers from an earlier module, harmless. |
| Unused dropped-feature locale keys | kept | Left for when the features return. |
| B22 Library reuse of `Chat_ScopeFolder` | kept | Coupling is intentional and documented. |
| Design notes (flyout over chips, panel height on Record, empty expanded shot) | deferred | Visual polish, not a behavior defect; left for the final review. |
