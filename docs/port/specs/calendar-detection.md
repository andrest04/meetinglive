# Spec: calendar-detection

Source of truth: the C# code in `MeetingLive.Core`, `MeetingLive.App`, and `MeetingLive.Core.Tests` on branch `feat/electron-port`. File:line references are to that tree. This module covers (a) reading the OS calendar, (b) the "Coming up" list on the Record page, (c) the one-minute reminder toast, (d) detecting a live Zoom/Teams/Meet call and offering to record, and (e) suggesting a meeting app as the audio source. Strings are given as resource keys (`Strings/en-us/Resources.resw`, `Strings/es/Resources.resw`), with the English value quoted.

Scope note: `HistoryPage.xaml` and `HistoryPage.xaml.cs` contain no calendar UI (searched for calendar, ComingUp, TakeNotes). The only calendar fields in History are the persisted meeting metadata in section 4. The calendar UI is in `RecordingPage` and `SettingsPage`.

## 1) Purpose

1. Read upcoming events from the machine calendar (Windows Appointment store, all calendars, read-only), filter out non-meetings, and show up to five at a time as "Coming up" on the Record page.
2. Clicking an event opens a prepared note (title, linked calendar metadata, prior notes if the event was recorded before, an AI brief) and, if the meeting is already running (or ended less than 5 minutes ago), starts recording and opens the join link.
3. While the app runs, poll every 15 s and raise an OS toast about one minute before a meeting that has at least two people, unless recording or disabled. The toast's action opens that event as in (2).
4. While the app runs, poll every 5 s for a visible Zoom, Teams, or Google Meet call window. When one appears and nothing is recording, show an in-app InfoBar and (if enabled) a floating always-on-top popup offering "Start recording".
5. On the Record page, when "All system audio" is selected and a known meeting app is playing audio, suggest switching to that app. The suggestion never switches by itself.

## 2) User-facing features

### 2.1 Coming up (Record page)

Where: `RecordingPage.xaml:373-461`, `RecordingPageViewModel.cs:298-314, 927-991`.

Visibility: the whole section is visible only when `!IsRecording && !IsProcessing` (`ShowComingUp`, vm:298). It is hidden during recording and processing.

Refresh triggers: only `OnNavigatedTo` (vm:331-340) and the toast-open path (2.3). There is no timer. Each refresh increments `_comingUpGeneration`; a result from an older generation is dropped (vm:929-936, 943).

Load algorithm (`RefreshComingUpAsync` + `ApplyComingUp`, vm:927-968):
1. Load settings; on any exception use an empty disabled set (vm:914-925).
2. `GetUpcomingAsync(now, disabledCalendarIds)`.
3. If `Failure` is `AccessDenied` or `NoPackageIdentity`: show failure (below).
4. Otherwise (including `Empty`): `CalendarEventFilter.Visible(events)`, then keep `CalendarEventTiming.IsStillRelevant(e, now)`, order by `Start` ascending then `EventId` ordinal, reset page index to 0.
5. Message = `ComingUp_Empty` if the filtered list is empty, else empty string. `IsComingUpError = false`.
6. Any exception other than cancellation shows the `AccessDenied` failure (vm:941-947).

States and strings:

| State | Condition | UI |
|---|---|---|
| Events | list non-empty | horizontal scroller of cards, 5 per page, prev/next buttons visible |
| Empty | list empty, no failure | muted body text `ComingUp_Empty` = "Nothing coming up." (AutomationId `TxtComingUpEmpty`); paging buttons hidden |
| Access denied | store failure or exception | Error InfoBar, not closable, message `ComingUp_AccessDenied` = "Windows denied calendar access. Allow Vozella to read the calendar, then open Record again." (`InfoComingUp`) |
| No package identity | store failure | Error InfoBar, `ComingUp_NoPackageIdentity` = "Vozella cannot read the Windows calendar because this launch has no package identity." |

The paging buttons are visible only while there is no message (`HasComingUpMessage` false). `HasComingUpError = message non-empty AND IsComingUpError`; `HasComingUpEmptyMessage = message non-empty AND NOT IsComingUpError`. Heading: `ComingUp_Heading.Text` = "Coming up" (es "Próximamente"). Previous button (glyph E76B): `ComingUp_Previous` name and tooltip "Previous meetings" (es "Reuniones anteriores"). Next (E76C): `ComingUp_Next` "Next meetings" (es "Próximas reuniones"). Both 40x40, no border, transparent. Previous is enabled only when `HasPrevious`, Next only when `HasNext` (commands, vm:894-912). After each page change `PublishComingUpPage` clamps the index and notifies both commands.

Card (`RecordingPage.xaml:426-457`): a button, min width 200, max 240, min height 64, padding 12,8, card fill, 1 px card stroke, control corner radius. `Tag` = `EventId`; AutomationId `BtnComingUpEvent_<EventId>`; automation name = subject. Three lines: subject (bold body, one line, ellipsis), time range (caption, secondary), location (caption, secondary, one line, ellipsis, hidden when blank). List AutomationId `ListComingUp`. Cards lay out horizontally, spacing 8, scroll horizontally with a hidden scrollbar.

Time range (`RecordingPage.xaml.cs:276-285`): convert start and end (`start + duration`) to local time. If local start date equals today's local date: `ComingUp_TimeRange` = `{0:t} – {1:t}` (short time, en dash). Otherwise `ComingUp_TimeRangeOtherDay` = `{0:ddd, MMM d} {1:t} – {2:t}` called with (start, start, end). Format uses the current culture. The same format string is in the es file; localisation comes from the culture.

Click (`RecordingPage.xaml.cs:305-316`): look up the event by `EventId` in the full unpaged list `_comingUpAll`; if missing do nothing; run `OpenComingUp` if it can execute.

### 2.2 Open a Coming up event (`OpenComingUpAsync`, vm:857-892)

Guards: null event, `_openingComingUp` already true, `IsRecording`, or `IsProcessing` all return silently with no message.

Steps, in order:
1. `_openingComingUp = true` (reset in `finally`).
2. Load all saved meetings. `existing = CalendarMeetingMatch.FindByEventId(meetings, eventId)`.
3. `RememberCalendarLink`: `_linkedMeetingId = existing?.Id`; remember `EventId`, `CalendarId`, `SeriesId`, `JoinUrl`, attendee list.
4. `_linkedAgenda` = trimmed `Details`, or null if blank.
5. `_comingUpNoteOpen = true`; clear `MeetingBrief` and `BriefError`.
6. `MeetingTitle = TitleFor(event, existing)`: existing meeting title if non-blank; else trimmed subject if non-blank; else `AppStrings.MeetingTitle(start.LocalDateTime)`.
7. `RestoreLinkedNotesAsync`: if a linked meeting id exists, load it and, if its notes are non-blank, set `SessionNotes` to them.
8. Notify canvas state (shows the session-notes panel because `ShowSessionNotes = IsRecording || IsProcessing || _comingUpNoteOpen`, vm:257).
9. `generation = ++_briefGeneration`.
10. `captureNow = CalendarEventTiming.ShouldStartCapture(event, now)`. If true and not recording/processing and the toggle command can execute: await the toggle (starts recording); if recording is now active, launch the join URL.
11. Fire and forget `GenerateBriefAsync` (2.5). The join URL is not opened for a future (prep-only) event.

Join URL launch (`TryLaunchJoinUrlAsync`, vm:1138-1154): requires a non-blank, absolute URI with scheme http or https; opens with the OS default handler; any failure is swallowed (capture is already running).

Notes saving: the notes TextBox `LostFocus` calls `SavePrepNotesAsync` (`RecordingPage.xaml.cs:300-303`, vm:1029-1044): only if a linked meeting exists and not recording/processing; load the record; normalise notes to null when blank; if equal (ordinal) to the stored value do nothing; else set and save.

Starting a recording while `_comingUpNoteOpen` is true keeps `SessionNotes` (vm:1248-1252, 1442-1446, 1611-1612). Start uses `_currentMeetingId = _linkedMeetingId ?? new Guid` (vm:1238, 1409). The calendar link travels into `RecordingPipelineRequest` (PipelineRun.cs:66-82: `CalendarEventId, CalendarId, SeriesId, JoinUrl, Attendees, Brief, Agenda`) and is saved on the meeting (section 4). After a pipeline run releases the session, `MeetingTitle` resets to the default and `ClearCalendarLink()` clears link, agenda, attendees, `_comingUpNoteOpen`, brief, error (vm:1003-1017, PipelineRun.cs:235-239).

### 2.3 Reminder toast (one minute before)

Where: `CalendarReminderWatcher.cs`, `CalendarReminder.cs`.

Lifecycle: created and started in `App.xaml.cs:138-139` after the main window is activated; disposed on window close (`App.xaml.cs:130-131`). `Start()` registers `AppNotificationManager.Default` (a Register failure is ignored because it may already be registered), subscribes `NotificationInvoked`, sets `_notificationsReady`, starts a 15 s `DispatcherTimer`, and polls once immediately. If notification setup throws, `_notificationsReady=false` and no toast is ever shown, but polling continues.

Poll (`PollAsync`, watcher:70-115). Reentrancy guard with `Interlocked`. Steps:
1. Return if `Workspace.IsCaptureActive`.
2. Load settings; return if `CalendarNotificationsEnabled` is false.
3. `GetUpcomingAsync(now, disabledSet)`. Return if failure is `AccessDenied` or `NoPackageIdentity`. Never toast an error.
4. Re-check capture active and the setting (they may have changed during the await).
5. `ForgetStarted(_notified, now)`.
6. For each event: `ShouldNotify(event, now, alreadyNotified)`; if true, `ShowToast`; if the toast was shown, record `_notified[eventId] = event.Start`.
7. All exceptions are swallowed.

`ShouldNotify` (CalendarReminder.cs:74-94) is true only when all hold: event id non-blank; id not in the notified set; `CalendarEventFilter.IsVisible`; `IsInNotifyWindow(start, now)`, i.e. `start - 90 s <= now < start`; `CountPeople >= 2`.

Toast content (watcher:117-142): nothing is shown if `_notificationsReady` is false or the subject is blank. Arguments `action=open-calendar-event`, `eventId=<Uri.EscapeDataString(eventId)>`. Text line 1: trimmed subject. Text line 2: `CalendarReminder_Body` = "This meeting is about to start." (es "Esta reunión está a punto de comenzar."). One button labelled `CallPrompt_TakeNotes` = "Take notes" (es "Tomar notas") with the same two arguments. Any exception returns false (event is not marked notified, so the next poll retries).

Activation (`OnNotificationInvoked`, watcher:144-172): requires `action == open-calendar-event` and a non-blank `eventId`; unescape it; on the UI dispatcher call `App.Window.Activate()` then `Workspace.RequestTakeNotes(eventId)`. Exceptions swallowed.

`RequestTakeNotes(eventId)` (`WorkspaceService.cs:160-192`): stores a pending flag and pending event id (blank id becomes null), raises `TakeNotesRequested`, then `NavigateTo(Recording)`. `ConsumeTakeNotes(out id)` returns the id, clears it, and returns whether the flag was set, clearing the flag. On the Record page: `OnTakeNotesRequested` ignores the event if the page is not visible (vm:801-807), otherwise enqueues `TryStartFromTakeNotes`; `OnNavigatedTo` also calls `TryStartFromTakeNotes` (vm:339). `TryStartFromTakeNotes`: if nothing was pending, return; if an event id is pending, run `OpenPendingCalendarEventAsync`; otherwise (blank request) if not recording/processing and the toggle can execute, start recording. `OpenPendingCalendarEventAsync` (vm:831-852): return if recording/processing; refresh Coming up; return if recording/processing; find the event in the refreshed list by id (it must pass the filter and relevance check, otherwise nothing happens); run `OpenComingUpAsync`. All exceptions swallowed.

### 2.4 Settings (Calendar section)

Where: `SettingsPage.xaml:456-493`, `CalendarSectionViewModel.cs`, `SettingsPage.xaml.cs:241-258`.

Controls, in order:
1. Toggle `Settings_CalendarNotifications`: header "Notify one minute before a meeting"; description "Shows a notification when a meeting with two or more people is about to start. Stays quiet while you are already recording." Glyph E787. AutomationId `ToggleCalendarNotifications`. Persists `CalendarNotificationsEnabled`.
2. Toggle `Settings_MeetingPopup`: header "Show a popup when a call starts"; description "Shows a small popup with a Start recording button when a Zoom, Teams, or Meet call is detected. Stays quiet while you are already recording." Glyph E720. AutomationId `ToggleMeetingPopup`. Persists `MeetingPopupEnabled`.
3. Expander `Settings_Calendars`: header "Calendars"; description "Turn a calendar off to hide it from Coming up and notifications." Expanded by default; visible only when `HasCalendars`. One toggle row per calendar, header = calendar name, AutomationId `ToggleCalendar_<Id>`. On = calendar not in `DisabledCalendarIds`.
4. A status text (`TxtCalendarStatus`) visible when `CalendarMessage` is non-empty.

Section heading `Settings_Calendar.Text` = "Calendar" (es "Calendario"). es texts exist for every key above.

Behavior: `ApplySettings(settings)` sets the two toggles synchronously from settings with `_applying=true` so setters do not write back (vm:51-63). `LoadAsync(settings)` reads the calendar list, then replaces rows in one synchronous step; existing rows stay until the result arrives (vm:67-89). An exception other than cancellation shows the AccessDenied message. Toggle handlers ignore changes while `_applying` or when the value equals the current one. Each change does load-mutate-save of the whole settings file via `SaveSettingsAsync`. For a calendar toggle: ensure the list exists, remove all ordinal-equal ids, then add the id if the toggle is off.

Failure text in this section (vm:151-161): `NoPackageIdentity` -> `ComingUp_NoPackageIdentity`; `Empty` -> `ComingUp_Empty` ("Nothing coming up."); anything else -> `ComingUp_AccessDenied`. Rows are cleared and `HasCalendars=false`. See bug B2.

### 2.5 Meeting brief (generated on open)

`GenerateBriefAsync` (vm:1046-1122), generation-guarded by `_briefGeneration`:
1. Probe record = the existing meeting, or a synthetic one (new Guid, title = subject or current title, `RecordedAt = event.Start`, empty audio path, `SeriesId`).
2. `RelatedMeetings.Find(probe, allMeetings)`.
3. If `MeetingBriefPromptBuilder.HasUsefulContext(related, details, attendees)` is false, stop (no brief, no error).
4. Resolve the summary provider from settings; stop if none or the generation is stale.
5. Build the prompt (`MeetingBriefPromptBuilder.Build(subject, attendees, details, related)`), run `CompletePromptAsync` on a background thread. On failure set `BriefError = RecordPage_BriefFailedFormat` = "The note is open. The brief could not be prepared: {0}" with `{0}` from `CliFailureUserMessage.Format(ex)`.
6. `Normalize(raw)`; null means stop. Else set `MeetingBrief`; if an existing meeting was matched, store `existing.Brief` and save (a save failure sets the same error).

The brief panel (`ShowMeetingBrief`) shows while `_comingUpNoteOpen && !IsProcessing && brief non-blank`. Heading `RecordPage_BriefHeading` = "Brief" (es "Informe previo"); error bar title `RecordPage_BriefFailed.Title` = "Could not prepare the brief". The brief builder, related-meeting search and provider resolver belong to other modules; this module only calls them.

### 2.6 Call detected: in-app bar and floating popup

Watcher: `MeetingCallWatcher.cs`, created in `App.xaml.cs:134-137` with handlers `OnMeetingDetected` and `OnMeetingEnded`.

State: `_armed=true` initially, `_windowFound=false`, reentrancy guard `_ticking`. 5 s `DispatcherTimer`. Tick (watcher:35-104):
1. `inCall = MeetingWindowScanner.AnyMeetingWindow()`. Log transitions of `_windowFound`.
2. If not in call: if `!_armed`, set `_armed=true`, raise `MeetingEnded`. Return.
3. If in call and not armed: return.
4. If in call, armed, and `Workspace.IsCaptureActive`: set `_armed=false` (suppressed for this call even if recording stops mid-call). Return.
5. Otherwise: `_armed=false`, `disarmedThisTick=true`; call `Workspace.OfferCallPrompt()` (always, regardless of the popup setting); load `MeetingPopupEnabled` (exception returns true); if `MeetingPopupPolicy.ShouldShow(enabled, IsCaptureActive, alreadyPrompted:false)` raise `MeetingDetected`, else log; `disarmedThisTick=false`.
6. On exception: if `disarmedThisTick`, set `_armed=true` so the next tick retries.

So at most one offer per call. The watcher is re-armed only after the call windows disappear. `MeetingPopupPolicy.ShouldShow = popupEnabled && !captureActive && !alreadyPrompted`.

In-app bar (`MainPage.xaml:20-32`, `MainPage.xaml.cs:51, 415-425`): `CallPromptOffered` sets `CallPromptBar.IsOpen = true`. Informational, closable InfoBar, AutomationId `InfoCallPrompt`. Title `CallPrompt_Title` "A call is happening" (es "Hay una llamada en curso"); message `CallPrompt_Body` "Take notes in Vozella so you don't miss it." (es "Toma notas en Vozella para no perder nada."); action button `CallPrompt_TakeNotes` "Take notes" (`BtnCallPromptTakeNotes`) which closes the bar and calls `RequestTakeNotes()` (blank request: navigate to Record and start recording). Nothing closes the bar automatically.

Floating popup (`MeetingPromptWindow.xaml`, `.xaml.cs`):
- Created lazily on first `MeetingDetected`, reused afterwards; if the window is closed the reference is nulled (`App.xaml.cs:311-325`). `MeetingEnded` calls `Dismiss()` (animated). A recording start (false to true on `IsRecording`) also dismisses (`App.xaml.cs:357-358`).
- Always-on-top, borderless (no border, no title bar), not resizable, not maximizable, not minimizable, hidden from taskbar and Alt+Tab (`IsShownInSwitchers=false`), rounded corners requested from DWM (`DWMWA_WINDOW_CORNER_PREFERENCE=33`, value `DWMWCP_ROUND=2`), best effort. Window title = `MeetingPrompt_Title.Text`. Shown without activation so focus stays in the call.
- Size 480 x 72 DIP, edge margin 24 DIP, scaled by `GetDpiForWindow/96`; placed top-right of the work area (3.6).
- Always dark theme regardless of app theme. Card: base-alt solid background, default surface stroke 1 px, overlay corner radius. A hover overlay (subtle fill, opacity 0 to 1 over 150 ms) lightens it.
- Layout: three columns. 40x40 icon tile with the 24x24 app logo (`Assets/Square44x44Logo.scale-200.png`); title and subtitle; split button on an accent-filled rounded border. Left padding/right padding 16.
- Text: `MeetingPrompt_Title.Text` "Meeting detected" (body strong, ellipsis, `TxtMeetingPromptTitle`); `MeetingPrompt_Subtitle.Text` "Take notes with Vozella" (caption, secondary, `TxtMeetingPromptSubtitle`). es: "Reunión detectada", "Toma notas con Vozella".
- Split button: left `BtnStart` (`BtnMeetingPromptStart`) `MeetingPrompt_Start.Content` "Start recording" (es "Empezar a grabar"), height 40, padding 16,0. A 1 x 20 divider at 35% opacity. Right `BtnMore` (`BtnMeetingPromptMore`), 40x40, glyph E70D size 12, name and tooltip `MeetingPrompt_More` "More options" (es "Más opciones"). Its flyout is a menu anchored bottom-edge-aligned-right with: `MeetingPrompt_Dismiss.Text` "Dismiss" (es "Descartar", `MenuMeetingPromptDismiss`) and `MeetingPrompt_NeverAgain.Text` "Don't notify me again" (es "No volver a avisarme", `MenuMeetingPromptNeverAgain`). Button states: transparent background; hover 16% and pressed 28% of the on-accent color; foreground on-accent color.
- Show (`Present`): compute scale, size, position; stop any running exit or entrance storyboard; reset `_dismissing=false`, hover overlay opacity 0, card opacity 1, translate X 0; show without activation; restart the 30 s auto-hide timer; if OS animations are enabled play the entrance, on exception stop it and force the card visible.
- Entrance: 280 ms, cubic ease-out, opacity 0 to 1 and card translate X from +24 DIP to 0. Exit: 150 ms cubic ease-in, opacity to 0, then hide only if still dismissing and this storyboard is still the current one.
- Auto-hide: 30 s one-shot timer. Pointer enter on the card stops it and shows the overlay. Pointer exit hides the overlay and restarts the timer if visible and not dismissing. When it fires it calls `Dismiss()`.
- `Dismiss(animate=true)`: stop the timer; return if not visible; if `animate` is false or animations are disabled, stop storyboards and hide immediately; otherwise (once) play the exit.
- Start click: `Dismiss(animate:false)`; restore the main window if minimized; activate the main window; `Workspace.RequestTakeNotes()` (blank: navigate to Record, start recording unless already recording or processing).
- Dismiss menu item: `Dismiss()` only.
- "Don't notify me again": `Dismiss()`, then load settings; if `MeetingPopupEnabled` is already false return; set false and save. Exceptions swallowed. This disables the popup only, not the in-app bar (the bar is raised before the popup setting is read).
- Closing the window stops the timer and storyboards.

### 2.7 Meeting app suggestion (audio source)

Where: `RecordingAudioSourcesViewModel.cs:62-158`, `RecordingPage.xaml:257-269`, `MeetingAppSuggestion.cs`.

`Pick(active, systemAudioSelected, dismissedPids)`: null unless system audio is selected; among apps with `IsKnownMeetingApp` and a pid not dismissed, order by `Peak` descending then `FriendlyName` ascending (current-culture, case-insensitive); first or null.

`EvaluateSuggestion` runs when the selected card changes, after each audio-app refresh, and after the remembered app is restored; it does nothing while `_restoring` (so a suggestion does not flash then vanish). It uses system-audio-selected = `SelectedCard is null or system card`. If no pick: clear the suggested pid, close the InfoBar. If pick and the pid changed: store it and set `SuggestionTitle = RecordPage_SuggestionTitle` ("{0} is in a call"; es "{0} está en una llamada") and `SuggestionActionLabel = RecordPage_SuggestionAction` ("Use {0}"; es "Usar {0}") with `{0}` = friendly name. Then open the InfoBar. Programmatic changes are wrapped by `_updatingSuggestion` so they are not treated as user dismissals.

UI: informational, closable InfoBar, `x:Uid=RecordPage_MeetingAppSuggestion` (automation name "Meeting app suggestion"), AutomationId `InfoMeetingAppSuggestion`, action button `BtnUseSuggestedApp` bound to `UseSuggestedAppCommand`.
- Action: find the non-system card whose pid equals the suggested pid and call `SelectCard` (same as a user click, remembers the choice).
- Close (X): if not programmatic and a suggested pid exists, add the pid to the in-memory dismissed set and clear the suggestion. The set lives for the lifetime of the view model; it is not persisted. Dismissal is per process id, not per app name.

`IsKnownMeetingApp` comes from `ActiveAudioAppService.MeetingApps` (case-insensitive process names), which starts `zoom, teams, ms-teams, webex, webexmta, slack, discord, skype, cpthost` (`ActiveAudioAppService.cs:71-73`; that file is the audio module's data and is authoritative for the full list). Browsers are intentionally not in this list.

## 3) Domain rules

### 3.1 Constants

| Name | Value | Source |
|---|---|---|
| Page size | 5 | CalendarEventPager.cs:8 |
| End grace | 5 min | CalendarEventTiming.cs:12 |
| Lookahead (UI window and store read) | 14 days | CalendarEventTiming.cs:15 |
| Lookback (store read) | 1 day | CalendarEventTiming.cs:18 |
| Notify lead | 90 s | CalendarReminder.cs:32 |
| Reminder poll interval | 15 s | CalendarReminder.cs:35 |
| Store `MaxCount` per calendar | 512 | WindowsAppointmentCalendarStore.cs:125 |
| Call-window poll interval | 5 s | MeetingCallWatcher.cs:27 |
| Popup auto-hide | 30 s | MeetingPromptWindow.xaml.cs:21 |
| Popup size / margin | 480 x 72 / 24 DIP | MeetingPromptWindow.xaml.cs:22-24 |
| Entrance / exit | 280 ms / 150 ms; slide 24 DIP | MeetingPromptWindow.xaml.cs:25-27 |
| `APPMODEL_ERROR_NO_PACKAGE` | 0x80073D54 | CalendarAccessFailure.cs:9 |

### 3.2 Event model (`CalendarEvent`)

Fields: `EventId` (required, store local id), `CalendarId`, `CalendarName`, `Subject`, `Start` (offset-aware instant), `Duration` (never negative), `Location?`, `Details?` (agenda, may be HTML or text, not persisted on the meeting), `JoinUrl?`, `OrganizerDisplayName?`, `AttendeeDisplayNames` (trimmed, blanks dropped, organizer excluded), `OrganizedByCurrentUser`, `AttendeesIncludeCurrentUser`, `SeriesId?`, `BusyStatus` (Unknown, Free, Tentative, Busy, OutOfOffice, WorkingElsewhere), `IsAllDay`, `IsDeclined`. Optional strings are `null` when blank after trim.

Result types: `CalendarStoreResult { Events, Failure? }` and `CalendarListResult { Calendars, Failure? }`. Invariant: failure and non-empty list are never both set. `FromEvents([])` returns failure `Empty`. `Failed(f)` returns an empty list. `CalendarStoreFailure` values: `AccessDenied`, `NoPackageIdentity`, `Empty`. The store never throws for permission problems; cancellation does propagate.

### 3.3 Visibility filter (`CalendarEventFilter.IsVisible`, evaluated in this order)

1. Hide if `IsAllDay` or `IsDeclined`.
2. Hide if `BusyStatus` is `OutOfOffice` or `WorkingElsewhere`.
3. Hide if the trimmed subject equals (ordinal, case-insensitive) one of `Focus time`, `Out of office`, `Working elsewhere`, `Working location`, or starts with `Working location:` (case-insensitive).
4. Hide if the subject is null/whitespace.
5. Show if `BusyStatus` is `Busy` or `Tentative`.
6. Otherwise (`Free` or `Unknown`): show only if `JoinUrl` is non-blank or there is at least one attendee name.

`Visible(events)` keeps the input order.

### 3.4 Timing

- `IsStillRelevant(e, now)`: `end = start + duration`; true iff `end + 5 min >= now` and `start <= now + 14 days`.
- `ShouldStartCapture(e, now)`: false if `start > now`; else true iff `now <= end + 5 min`.
- Consequence: an event that starts exactly now starts capture; a future event is prep only.

### 3.5 Paging

`pageCount = events.Count == 0 ? 1 : ceil(Count/5)`. `clamped = clamp(pageIndex, 0, pageCount-1)`. `start = clamped*5`. Items = next up to 5. `HasPrevious = clamped > 0`. `HasNext = start + 5 < Count`.

### 3.6 Popup placement

`TopRight(width, height, areaX, areaY, areaW, areaH, margin)` = `Clamp(areaX + areaW - width - margin, areaY + margin, width, height, areaX, areaY, areaW, areaH)`. `Clamp` (`LiveCopilotPillPlacement.cs:18-27`): `maxX = max(areaX, areaX+areaW-width)`, `maxY = max(areaY, areaY+areaH-height)`, returns `(clamp(x, areaX, maxX), clamp(y, areaY, maxY))`. In the app, width and height are `ceil(DIP * scale)`, margin is `(int)(24*scale)`, scale = window DPI / 96, area = work area of the display the window is on (fallback primary). The window is moved and resized in one call.

### 3.7 Reminder rule

- Window: `[start - 90 s, start)`. A sample at start or later is outside. With a 15 s poll at least one sample lands in `[start-90 s, start-60 s]`, so the one-minute mark cannot be skipped (test `FifteenSecondPoll_CannotMissTheOneMinuteMark`).
- `IncludesCurrentUser(organizedByCurrentUser, ownerMatchedInInvitees) = !organized && ownerMatched`. Production always passes `ownerMatched=false`, so `AttendeesIncludeCurrentUser` is always false.
- `CountPeople`: `named` = count of non-blank attendee names. If `OrganizedByCurrentUser || !AttendeesIncludeCurrentUser` return `named + 1`, else `named`.
- `ForgetStarted(dict, now)`: remove every entry whose stored start is `<= now`. This lets a later occurrence with the same id notify again.
- Notified set key: event id, ordinal. Value: the start time. It is in memory only.

### 3.8 Join URL resolution (`CalendarJoinUrl.Resolve`)

Priority: `FirstHttpUri(onlineMeetingLink)`, then `FirstHttpUri(appointmentUri)`, then `FirstHttpsInText(location)`, then `FirstHttpsInText(details)`.
- `FirstHttpUri(v)`: null if blank; trim; must parse as an absolute URI with scheme http or https; return `Uri.AbsoluteUri` (this normalises: lower-cased scheme and host, percent-encoding, a trailing `/` on a bare host).
- `FirstHttpsInText(t)`: null if empty; find the first `https://` case-insensitive (only https, not http); extend until whitespace or one of `<` `>` `"` `'`; strip trailing `.` `,` `;` `)` characters; pass through `FirstHttpUri`. Only the first occurrence is tried; if it is invalid the result is null even if later URLs exist.

### 3.9 Series id

`FromRecurrence(isRecurring, roamingId)`: null if not recurring or roaming id blank; else trimmed roaming id. Recurring is `appointment.Recurrence != null`.

### 3.10 Meeting match

`FindByEventId(meetings, id)`: null if id blank; otherwise records whose `CalendarEventId` equals the id (ordinal), newest `RecordedAt` first, first one.

### 3.11 Failure classification

`Classify(ex)`: `NoPackageIdentity` if `ex.HResult == 0x80073D54` or the message contains (case-insensitive) `package identity` or `no package identity`; otherwise `AccessDenied`. (The second phrase is redundant with the first.)

### 3.12 Store read algorithm (`GetUpcomingAsync`)

1. `RequestStoreAsync(AllCalendarsReadOnly)`; a null store gives `AccessDenied`.
2. `FindAppointmentCalendarsAsync`.
3. `rangeStart = now - 1 day`; `rangeLength = 1 day + 14 days`.
4. For each calendar: honour cancellation; `calendarId = LocalId ?? ""`; skip if the id is non-empty and in the disabled set (comparison uses the set's own comparer; the app builds it ordinal). Read `FindAppointmentsAsync(rangeStart, rangeLength, options)`. A per-calendar exception (not cancellation) is remembered as `calendarError` and the loop continues.
5. Map each appointment (3.13); appointments with a blank local id are dropped.
6. If no events were collected and a calendar error exists, return `Failed(Classify(error))`.
7. Sort by `Start`, then `EventId` ordinal. Return `FromEvents` (empty gives `Empty`).
8. Outer catch: cancellation rethrown; any other exception returns `Failed(Classify(ex))`.

Fetch options: `MaxCount=512`; properties Subject, Location, Details, Organizer, Invitees, BusyStatus, AllDay, Recurrence, Uri, UserResponse, IsOrganizedByUser, `"RoamingId"`, OnlineMeetingLink.

### 3.13 Appointment mapping

`EventId = LocalId`; `CalendarId = appointment.CalendarId` if non-blank else the calendar's local id; `CalendarName = calendar.DisplayName ?? ""`; `Subject = Subject ?? ""` (not trimmed); `Start = StartTime`; `Duration = max(Duration, 0)`; `Location`, `Details` trimmed or null; `JoinUrl` per 3.8 with `OnlineMeetingLink`, `Uri?.AbsoluteUri`, location, details; `OrganizerDisplayName` trimmed or null; attendees from `Invitees` display names trimmed, blanks dropped; `OrganizedByCurrentUser = IsOrganizedByUser`; `AttendeesIncludeCurrentUser = false`; `SeriesId` per 3.9; `IsAllDay = AllDay`; `IsDeclined = UserResponse == Declined`; busy status map: Free, Tentative, Busy, OutOfOffice, WorkingElsewhere map 1:1, everything else `Unknown`.

### 3.14 Calendar list (`GetCalendarsAsync`)

Same store request. Skip calendars with an empty local id. Name = trimmed display name, or the id if blank. Sort by name (current culture, ignore case) then id ordinal. Empty list gives failure `Empty`. Exceptions follow the same classification.

### 3.15 Call detection (`MeetingCallDetector.IsMeeting(processName, windowTitle)`)

Process name is trimmed and lower-cased; title is used as given. Empty process name returns false. Then:
- `cpthost`: true for any title.
- `zoom`: title contains (ignore case) `Zoom Meeting` or `Zoom Webinar`.
- `teams` or `ms-teams`: title contains `Meeting` or `Call` (ignore case, substring).
- `chrome`, `msedge`, `firefox`, `brave`, `opera`, `vivaldi`: title matches the regex `\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b` (ignore case, culture invariant) AND contains `Meet` (ignore case).
- Anything else: false.

Window scan (`MeetingWindowScanner.AnyMeetingWindow`): enumerate all top-level windows; skip invisible windows (visible includes minimized) and windows with empty title; get the owning process id (skip 0); get the process name (without `.exe`); stop at the first window where `IsMeeting` is true. Process-exited races are ignored. Runs on the UI thread inside the timer tick.

## 4) Persistence and wire formats

### 4.1 Settings (`settings.json`, camelCase, indented; `AppSettingsService.cs:9`)

```json
{
  "calendarNotificationsEnabled": true,
  "meetingPopupEnabled": true,
  "disabledCalendarIds": ["<calendar LocalId>", "..."]
}
```

Defaults when a field is missing: `true`, `true`, `[]`. `DisabledCalendarIdsAsSet()` returns an ordinal set, dropping null and blank ids. The file is rewritten as a whole by several view models (load, mutate, save); every writer in this module follows that pattern. Calendar ids are opaque Windows `LocalId` strings and are machine-specific.

### 4.2 Meeting markdown frontmatter (`MeetingMarkdownFormatter.cs:60-66, 216-220`)

Optional keys, written only when non-empty, in this order after `summaryProvider`:

```
calendarEventId: <EventId>
calendarId: <CalendarId>
seriesId: <SeriesId>
joinUrl: <https URL>
noteTemplateId: ...
attendees: Ada Lovelace | Grace Hopper
```

`attendees` is one line, names joined by ` | `; parsed by splitting on ` | ` with trim and no empty entries. Brief is the `## Brief` section; notes are in the notes section. `Agenda` is carried in the pipeline request but is not written by this module.

### 4.3 Notification payload

Toast arguments: `action=open-calendar-event`, `eventId=<percent-encoded id>`. The action button repeats both. The handler unescapes once.

### 4.4 In-process messages

`Workspace.RequestTakeNotes(string? eventId)`, `TakeNotesRequested`, `ConsumeTakeNotes(out string? eventId)`, `OfferCallPrompt` / `CallPromptOffered`, `IsCaptureActive`. `MeetingCallWatcher` events: `MeetingDetected`, `MeetingEnded`.

### 4.5 Example

A Busy event "Standup", start 2026-09-21T15:00Z, duration 30 min, attendees `["Ada Lovelace"]`, organized by the user: visible; `CountPeople=2`; toast sent when `now` is in `[14:58:30Z, 15:00Z)`; if the user clicks it at 15:02Z, `ShouldStartCapture` is true, so recording starts and the join URL opens; the saved meeting gets `calendarEventId`, `calendarId`, `attendees: Ada Lovelace`.

## 5) Native and OS dependencies

| Dependency | Use | Class |
|---|---|---|
| `Windows.ApplicationModel.Appointments` (`AppointmentManager`, `AppointmentStore`, `FindAppointmentsAsync`) | Read all calendars | Windows-only. Needs MSIX package identity and restricted capability `appointmentsSystem` (`Package.appxmanifest:51`). An NSIS-installed Electron app has neither (see `docs/port/research/quality-packaging.md:100-101`), so the port needs a workaround or a different provider. |
| `Microsoft.Windows.AppNotifications` (toast, `NotificationInvoked`) | Reminder toast and action | Windows-only. Replace with Electron `Notification` (portable) and a main-process click handler. |
| `user32` `EnumWindows`, `IsWindowVisible`, `GetWindowText`, `GetWindowTextLength`, `GetWindowThreadProcessId` | Call-window scan | Windows-only. macOS needs Screen Recording permission or an accessibility API to read other apps' window titles. |
| `Process.GetProcessById(...).ProcessName` | Map window to process | Portable concept, OS-specific implementation. |
| `user32.GetDpiForWindow`, `DisplayArea.WorkArea`, `AppWindow.MoveAndResize/Show(activate:false)/IsShownInSwitchers`, `OverlappedPresenter.IsAlwaysOnTop` | Popup | Windows-only APIs; Electron `BrowserWindow` options (`alwaysOnTop`, `focusable:false`, `skipTaskbar`, `screen.getPrimaryDisplay().workArea`, `showInactive`) give portable behavior. |
| `dwmapi.DwmSetWindowAttribute(33, 2)` | Rounded corners | Windows-only, best effort; use CSS rounding with a transparent window in Electron. |
| `UISettings.AnimationsEnabled` | Skip animations | Windows-only; Electron equivalent is `prefers-reduced-motion`. |
| `Windows.System.Launcher.LaunchUriAsync` | Open join URL | Portable via `shell.openExternal` (restrict to http/https). |
| `DispatcherTimer` / `DispatcherQueue` | Polling on UI thread | Portable concept; move polling to the main process or a worker so it does not block the UI. |
| Process audio-session enumeration (`ActiveAudioAppService`) | Meeting app suggestion | Windows-only, owned by the audio module. |
| Pure logic (filter, timing, pager, join URL, series id, match, reminder rule, popup policy, placement math, call detector, app suggestion, access-failure classification) | Decisions | Portable. Move as-is with the test vectors in section 6. |

## 6) Existing test coverage (`MeetingLive.Core.Tests/Services`)

Every case below must be ported as an automated test. Names are the C# test method names.

- `CalendarAccessFailureTests`: `Classify_UnauthorizedAccess_ReturnsAccessDenied`; `Classify_NoPackageHresult_ReturnsNoPackageIdentity`; `Classify_PackageIdentityMessage_ReturnsNoPackageIdentity`.
- `CalendarEventFilterTests`: `IsVisible_TimedBusyEventWithSubject_KeepsIt`; `..._TimedTentativeEventWithSubject_KeepsIt`; `..._AllDayEvent_HidesIt`; `..._OutOfOffice_HidesIt`; `..._WorkingElsewhere_HidesIt`; `..._FocusTimeSubject_HidesIt`; `..._WorkingLocationSubject_HidesIt`; `..._DeclinedEvent_HidesIt`; `..._FreeBlockWithoutMeetingSignals_HidesIt`; `..._FreeEventWithJoinUrl_KeepsIt`; `..._BusyEventWithoutSubject_HidesIt`; `Visible_MixedEvents_ReturnsOnlyMeetings`.
- `CalendarEventPagerTests`: `GetPage_EmptyList_ClampsToFirstPageWithNoNeighbors`; `..._ExactlyOnePage_HasNoNext`; `..._SixEvents_FirstPageHasNextAndFiveItems`; `..._SixEvents_SecondPageHasPreviousAndOneItem`; `..._IndexPastEnd_ClampsToLastPage`; `..._NegativeIndex_ClampsToFirstPage`.
- `CalendarEventTimingTests`: `ShouldStartCapture_FutureStart_DoesNotStart`; `..._StartIsNow_Starts`; `..._EndedWithinGrace_Starts` (start -20 min, 16 min long); `..._EndedBeyondGrace_DoesNotStart` (start -20 min, 10 min long); `IsStillRelevant_EndedBeyondGrace_IsNotUpcoming`; `IsStillRelevant_StartsInsideLookahead_IsUpcoming` (+13 days).
- `CalendarJoinUrlTests` (file also holds the series-id tests): `Resolve_OnlineMeetingLinkPresent_PrefersIt`; `Resolve_NoDedicatedLink_UsesFirstHttpsInLocation`; `Resolve_NoHttpsUrl_ReturnsNull`; `FromRecurrence_RecurringWithRoamingId_UsesRoamingId`; `FromRecurrence_NotRecurring_LeavesSeriesIdNull`.
- `CalendarReminderTests` (22 test cases including theory rows): `IsInNotifyWindow_AtLeadAndOneMinuteBefore_IsInside`; `..._BeforeLeadOrAtStart_IsOutside`; `..._FifteenSecondPoll_CannotMissTheOneMinuteMark` (all 15 phase offsets); `IncludesCurrentUser_WhenOrganizedByUser_IsFalseEvenIfANameWasMatched`; `IncludesCurrentUser_WhenNotOrganizer_FollowsTheInviteeMatch` (two rows); `CountPeople_WhenOwnerIsNotInTheList_OneOtherPersonIsTwoPeople`; `..._WhenOwnerOrganized_DoesNotTreatThemAsAlreadyListed`; `..._WhenListAlreadyIncludesTheOwner_DoesNotAddThemAgain`; `..._BlankNames_DoNotCount`; `ShouldNotify_OneOtherPersonInsideTheWindow_Notifies`; `..._OwnerAlreadyListedAlone_DoesNotNotify`; `..._NoOtherPerson_DoesNotNotify`; `..._BlockedByCalendarEventFilter_DoesNotNotify` (all-day, declined, out of office, "Focus time"); `..._FreeBlockWithoutMeetingSignal_DoesNotNotify`; `..._AlreadyNotified_DoesNotNotifyAgain`; `..._AfterStart_DoesNotNotify`; `ForgetStarted_WhenStartHasPassed_DropsTheIdSoALaterOccurrenceCanNotify`; `ForgetStarted_BeforeStart_KeepsTheId`.
- `MeetingAppSuggestionTests`: `Pick_MeetingAppPlaying_IsSuggested`; `..._AnAppIsAlreadySelected_IsNull`; `..._NoMeetingApp_IsNull`; `..._DismissedProcess_IsSkipped`; `..._DismissedProcessDoesNotHideAnotherMeetingApp`; `..._SeveralMeetingApps_LoudestWins`; `..._EqualLoudness_FirstByNameWins`; `..._EmptyList_IsNull`.
- `MeetingCallDetectorTests`: table `(CptHost, Zoom) true`, `(zoom, Zoom Meeting) true`, `(Zoom, Zoom Workplace) false`, `(ms-teams, "Standup | Meeting") true`, `(Teams, "Chat | Microsoft Teams") false`, `(msedge, "Inbox - Gmail") false`, `(notepad, Zoom Meeting) false`; browser in-call true for chrome `Meet - abc-defg-hij - Google Chrome`, msedge `Meet – abc-defg-hij`, firefox `Meet - ABC-DEFG-HIJ`, brave, opera, vivaldi (all `Meet - abc-defg-hij`); browser false for `Google Meet`, `Meet`, `Google Meet - Video calls and meetings for everyone`, `Standup - Google Meet`, msedge `Andres's Personal Meeting Room - Zoom`, chrome `Home - Microsoft Teams`, `abc-defg-hij - notes`, `Meet - abcd-efg-hij`.
- `MeetingPopupPolicyTests`: enabled+idle+not prompted true; setting off false; recording false; already prompted false.
- `MeetingPromptPlacementTests`: `TopRight_PlacesWindowAtTopRightWithMargin`; `..._WhenAreaHasNonZeroOrigin_OffsetsFromThatOrigin`; `..._WhenMarginDoesNotFit_StillStaysInsideArea`.

Not covered by any test: `CalendarMeetingMatch`, the `CalendarStoreResult`/`CalendarListResult` factories, `WindowsAppointmentCalendarStore`, all watchers, the popup window, `CalendarSectionViewModel`, the Coming up view-model logic (refresh generation, open flow, toast open flow), the brief call from this flow, and `FirstHttpsInText` edge cases (trailing punctuation, delimiters, invalid first URL). The port should add tests for these.

## 7) Bugs, races, and uncovered cases

Confirmed (evidence in code):

- **B1 Discard keeps the calendar link.** `ClearCalendarLink()` is called only from `RecordingPageViewModel.PipelineRun.cs:238`. The discard path (`RecordingPageViewModel.cs:1590-1618`) only clears notes when `_comingUpNoteOpen` is false and never clears `_linkedMeetingId`, event ids, or `_comingUpNoteOpen`. After opening a Coming up event, recording, and discarding, the next manual recording reuses `_linkedMeetingId` (vm:1238), the old title/notes, and is saved against the old calendar event. Fix in the port: clear the link on discard.
- **B2 Wrong text for "no calendars".** `CalendarSectionViewModel.cs:129-131, 158` shows `ComingUp_Empty` ("Nothing coming up.") in Settings when the calendar list is empty. It should say that no calendars were found.
- **B3 Toast is not at one minute.** The window is 90 s wide with a 15 s poll (`CalendarReminder.cs:32, 35, 40-44`), so the first poll inside the window fires 90 to 75 s before start, not 60 s. The label "Notify one minute before a meeting" is inaccurate. The test only asserts that the one-minute mark falls in the window.
- **B4 Partial calendar failure is silent.** `WindowsAppointmentCalendarStore.cs:59-62, 65`: if one calendar throws and others return events, the error is dropped and the user sees an incomplete list with no warning.
- **B5 Coming up is stale.** Refresh happens only on navigation (`RecordingPageViewModel.cs:331-340`) and on toast open. A page left open keeps listing finished meetings and misses new ones until the user leaves and returns.
- **B6 Cold-start toast activation is unhandled.** `AppNotificationManager.Register` and `NotificationInvoked` are used only in `CalendarReminderWatcher.cs:34-37`; a search of `MeetingLive.App` found no other code reading notification activation. If the app was closed after the toast was shown, clicking the toast launches the app and nothing opens.
- **B7 Popup policy is partly vestigial.** `MeetingCallWatcher.cs:79` always passes `alreadyPrompted:false`; "once per meeting" comes from the `_armed` latch. `OfferCallPrompt()` (`:76`) runs before the popup setting is read, so the in-app InfoBar appears even when the user turned the popup off, and it never closes by itself (`MainPage.xaml.cs:51`).
- **B8 Detector gaps and false positives.** `MeetingCallDetector.cs:28-29` matches the substring `Call`, so a Teams window titled `Calls | Microsoft Teams` returns true (the test only covers `Chat | Microsoft Teams`). `IsKnownMeetingApp` (webex, slack, discord, skype) is not mirrored in the detector, so those apps get the audio suggestion but never the call popup.
- **B9 English-only subject filter.** `CalendarEventFilter.cs:49-57` matches `Focus time`, `Out of office`, `Working elsewhere`, `Working location`; localized subjects pass through if the status is Busy. Out of office and working elsewhere are also caught by status.
- **B10 Invalid first URL hides valid later ones.** `CalendarJoinUrl.cs:34-43` tries only the first `https://` occurrence.

Suspected (not proven in this review):

- **S1 Owner listed in Invitees counts twice.** In production `AttendeesIncludeCurrentUser` is always false (`WindowsAppointmentCalendarStore.cs:176`), so `CountPeople` always adds 1. If Windows lists the owner in `Invitees` on a solo event, a one-person event reaches count 2 and toasts. The comment at `CalendarReminder.cs:20-23` admits the ambiguity.
- **S2 Recurring occurrences may share `LocalId`.** `CalendarMeetingMatch.FindByEventId` matches only by id, and the toast set is keyed by id. If occurrences share an id, a new occurrence opens the previous occurrence's saved meeting (title, notes, meeting id reuse at vm:1238) and a reminder can be suppressed until `ForgetStarted`. Verify on a real recurring series; consider keying by (id, start).
- **S3 `MaxCount=512` per calendar** with a 15-day range (`WindowsAppointmentCalendarStore.cs:125`) may drop upcoming events from a busy calendar, since the order of truncation is not guaranteed.
- **S4 Cancelled meetings are not filtered.** `IsCanceledMeeting` is not fetched; only the user's `Declined` response hides an event.
- **S5 Duplicates.** The same meeting present in two calendars is shown twice and can toast twice (different ids).
- **S6 Call window flap.** A title change that hides the keyword for one 5 s tick (switching browser tab, Teams title during screen share) re-arms the latch, raises `MeetingEnded` (popup hides), then shows the popup again on the next tick. Browser titles show only the active tab, so leaving the Meet tab ends the "call".
- **S7 Popup DPI and monitor.** `GetDpiForWindow` and the work area are read for the monitor the hidden window last sat on, not necessarily the monitor of the main window or the call (`MeetingPromptWindow.xaml.cs:83-89`). Mixed-DPI setups may mis-size it.
- **S8 UI-thread scan.** `AnyMeetingWindow` opens a `Process` handle for every titled visible window every 5 s on the UI thread (`MeetingWindowScanner.cs:14-47`).
- **S9 Settings write race.** "Don't notify me again" does load-mutate-save (`MeetingPromptWindow.xaml.cs:237-242`) outside the Settings view model, so an open, cached Settings page shows a stale popup toggle and may write the old value back on its next save.
- **S10 Reminder re-fire after restart.** The notified map is in memory only; restarting the app inside a meeting's 90 s window toasts again.
- **S11 `Appointment.CalendarId` vs `Calendar.LocalId`.** The disabled list stores calendar `LocalId`; the event's `CalendarId` may differ in form, so saved `calendarId` metadata may not equal the settings id.
- **S12 Culture-dependent ordering.** The suggestion tie-break and calendar-list sort use the current culture; results can vary by user locale.
- **S13 Double encoding.** The id is percent-encoded before being passed to `AddArgument` and decoded once on activation; confirm the builder does not encode a second time for ids with reserved characters.

## 8) Parity checklist

Tick each item in the port. Prefix letters: S store, F filter, T timing, P paging, U Coming up UI, O open flow, R reminder, C call detection, W popup window, A app suggestion, G settings, D persistence.

Store and mapping
1. S1 Read all calendars read-only through the OS calendar API, behind a port with `getUpcoming(now, disabledIds)` and `getCalendars()`.
2. S2 Read range is `[now - 1 day, now + 14 days]`.
3. S3 Skip a calendar when its id is non-empty and in the disabled set.
4. S4 Request at most 512 appointments per calendar (or paginate, see S3 in section 7).
5. S5 Fetch subject, location, details, organizer, invitees, busy status, all-day, recurrence, uri, user response, is-organized-by-user, roaming id, online meeting link.
6. S6 Drop appointments with a blank local id.
7. S7 Map `Duration` below zero to zero.
8. S8 Trim and null-ify blank location, details, organizer name.
9. S9 Attendees are trimmed invitee display names with blanks removed; the organizer and owner are not inserted.
10. S10 `OrganizedByCurrentUser` comes from the OS flag; `AttendeesIncludeCurrentUser` is false.
11. S11 `IsDeclined` is true only for a Declined user response.
12. S12 Busy status maps Free, Tentative, Busy, OutOfOffice, WorkingElsewhere; all else Unknown.
13. S13 Event `CalendarId` falls back to the calendar's id when the appointment has none.
14. S14 Sort events by start, then event id ordinal.
15. S15 Result with zero events and no error is failure `Empty`.
16. S16 Result with zero events and a per-calendar error is `Failed(classify(error))`.
17. S17 A per-calendar error with other events present is swallowed (surface it in the port, B4).
18. S18 A null store gives `AccessDenied`.
19. S19 Cancellation propagates; every other exception becomes a typed failure and never throws.
20. S20 Classification: HRESULT 0x80073D54 or a message containing "package identity" gives `NoPackageIdentity`; else `AccessDenied`.
21. S21 Failure and non-empty list are mutually exclusive in result types.
22. S22 Calendar list skips empty ids, names default to the id, sorted by name (ignore case) then id; an empty list is `Empty`.
23. S23 Series id is the trimmed roaming id only when the appointment is recurring and the id is non-blank.
24. S24 Join URL priority: online meeting link, appointment URI, first https in location, first https in details.
25. S25 `FirstHttpUri` accepts only absolute http/https and returns the normalised absolute URI.
26. S26 `FirstHttpsInText` finds the first `https://` (case-insensitive), stops at whitespace, `<`, `>`, `"`, `'`, trims trailing `. , ; )`.

Filter
27. F1 Hide all-day events.
28. F2 Hide declined events.
29. F3 Hide OutOfOffice and WorkingElsewhere status.
30. F4 Hide subjects `Focus time`, `Out of office`, `Working elsewhere`, `Working location` (trimmed, case-insensitive) and prefix `Working location:`.
31. F5 Hide blank subjects.
32. F6 Show Busy and Tentative events with a subject.
33. F7 Show Free or Unknown events only with a join URL or at least one attendee.
34. F8 Filtering preserves order.

Timing and paging
35. T1 Still relevant iff `end + 5 min >= now` and `start <= now + 14 d`.
36. T2 Capture starts iff `start <= now <= end + 5 min`.
37. T3 Future events never start capture.
38. P1 Page size 5.
39. P2 Empty list has one page, no previous, no next.
40. P3 Page index is clamped to `[0, pageCount-1]`.
41. P4 `HasPrevious` is index > 0; `HasNext` is `start + 5 < count`.

Coming up UI
42. U1 Section visible only when not recording and not processing.
43. U2 Heading "Coming up" (es "Próximamente").
44. U3 Refresh on each navigation to Record.
45. U4 Stale refresh results are discarded by a generation counter.
46. U5 A settings failure while loading disabled ids falls back to no disabled calendars.
47. U6 Pipeline: filter, relevance, order by start then id, page reset to 0.
48. U7 Empty list shows muted "Nothing coming up." and hides paging.
49. U8 `AccessDenied` shows an Error InfoBar with the denied message and hides paging.
50. U9 `NoPackageIdentity` shows an Error InfoBar with the identity message and hides paging.
51. U10 An unexpected read exception shows the access-denied state.
52. U11 Previous and next buttons with tooltips "Previous meetings" and "Next meetings", disabled at the ends.
53. U12 Cards show subject, time range, optional location, with ellipsis on one line.
54. U13 Time range uses local short time today and `ddd, MMM d` plus times on other days.
55. U14 AutomationIds: card `BtnComingUpEvent_<id>`, list `ListComingUp`, section `ComingUpSection`, empty text `TxtComingUpEmpty`, error bar `InfoComingUp`, buttons `BtnComingUpPrevious`, `BtnComingUpNext`.
56. U15 Cards scroll horizontally.
57. U16 Click looks up the event in the full list and ignores unknown ids.

Open flow
58. O1 Ignore the open while another open is running, while recording, or while processing.
59. O2 Find the saved meeting by event id (newest by recorded time).
60. O3 Remember event id, calendar id, series id, join URL, attendees, and the matched meeting id.
61. O4 Remember the trimmed agenda from details (null if blank).
62. O5 Title: existing title, else subject, else default dated title.
63. O6 Restore prior notes from the matched meeting when non-blank.
64. O7 Show the session notes panel while a Coming up note is open.
65. O8 Start capture only when `ShouldStartCapture`; then open the join URL (http/https only, best effort).
66. O9 A future event opens prep only, with no capture and no join.
67. O10 Reuse the matched meeting id when starting capture; otherwise a new id.
68. O11 Notes edits save on blur only when a meeting is linked, not recording or processing, and the value changed.
69. O12 The link and note state travel to the pipeline request and are saved on the meeting.
70. O13 After a pipeline run releases the session, clear link, agenda, attendees, brief, and note-open flag.
71. O14 Discard must also clear the link (fixes B1).
72. O15 Brief generation is generation-guarded and fire and forget.
73. O16 Brief runs only if useful context exists (related meetings, details, or attendees).
74. O17 Brief provider failure shows "The note is open. The brief could not be prepared: {0}".
75. O18 A successful brief is shown and stored on the matched meeting; a save failure shows the same error.
76. O19 The brief stays visible while the note is open and not processing.

Reminder
77. R1 Watcher starts with the app and stops on window close.
78. R2 Poll every 15 s and once immediately at start.
79. R3 Reentrant polls are dropped.
80. R4 Skip when capture is active.
81. R5 Skip when the setting is off, re-checked after the calendar read.
82. R6 Skip silently on access-denied or no-identity failures; never toast an error.
83. R7 Notify window is `[start - 90 s, start)`.
84. R8 Notify only for filter-visible events with a non-blank id.
85. R9 Notify only if `CountPeople >= 2`.
86. R10 `CountPeople` counts non-blank names, adds 1 for the owner unless `AttendeesIncludeCurrentUser` and not organizer.
87. R11 Never notify an id twice until its start has passed (`ForgetStarted` removes entries with start `<= now`).
88. R12 Record an id as notified only when the toast was shown.
89. R13 Toast: title = trimmed subject, body "This meeting is about to start.", button "Take notes", args action and id.
90. R14 No toast for a blank subject.
91. R15 Click opens the main window (restoring it) and requests take-notes with the event id.
92. R16 Handle activation when the app is not running (fixes B6).
93. R17 A take-notes request is remembered until the Record page consumes it.
94. R18 The Record page ignores the live event when not visible and consumes on navigation.
95. R19 With an event id: refresh, find, open as in section 2.2; do nothing if the event is gone.
96. R20 A blank request starts recording unless already recording or processing.
97. R21 Calendar read or toast errors are swallowed and never crash the app.

Call detection
98. C1 Poll every 5 s.
99. C2 Detection: `cpthost` always; Zoom with "Zoom Meeting" or "Zoom Webinar"; Teams/ms-teams with "Meeting" or "Call"; supported browsers with a Meet code and "Meet" in the title.
100. C3 Meet code regex `\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b`, case-insensitive.
101. C4 Process name is trimmed and lower-cased; blank is false.
102. C5 Scan only visible, titled top-level windows; stop at the first match.
103. C6 One offer per call; re-arm only after no call window is seen.
104. C7 If recording is active when a call is found, mark the call handled and stay quiet for the rest of the call.
105. C8 Offer the in-app bar every time a call is first detected, independent of the popup setting.
106. C9 Raise the popup only if enabled and not recording.
107. C10 Raise "ended" when the call windows vanish after an offer or suppression, to hide the popup.
108. C11 A failure after disarming re-arms for retry.
109. C12 A settings read failure defaults the popup to enabled.
110. C13 Detection never crashes the app.

In-app bar and popup
111. W1 In-app bar text: "A call is happening" / "Take notes in Vozella so you don't miss it." / "Take notes"; closable.
112. W2 The bar's button closes it and requests take-notes (blank).
113. W3 Popup is always on top, borderless, fixed size 480 x 72 DIP, hidden from taskbar and Alt+Tab, never steals focus.
114. W4 Popup placed at the top-right of the work area with a 24 DIP margin, clamped inside the area, DPI scaled.
115. W5 Popup is dark regardless of theme, rounded corners, icon tile, title "Meeting detected", subtitle "Take notes with Vozella".
116. W6 Split button: "Start recording" plus a more-options menu with "Dismiss" and "Don't notify me again".
117. W7 Entrance 280 ms fade and 24 DIP slide; exit 150 ms fade; both skipped when the OS disables animations.
118. W8 Auto-hide after 30 s; hover pauses and hover exit restarts it; hover shows a lighter overlay.
119. W9 Reshow resets any stale animation state so the card is always visible.
120. W10 The window is created on first use and reused.
121. W11 Start: hide without animation, restore and focus the main window, request take-notes (blank).
122. W12 Dismiss: hide with animation.
123. W13 Never again: hide, then persist `meetingPopupEnabled=false` unless already false; errors swallowed.
124. W14 Starting a recording from any path dismisses the popup.
125. W15 Popup policy: show iff enabled and not capturing and not already prompted.
126. W16 AutomationIds: `TxtMeetingPromptTitle`, `TxtMeetingPromptSubtitle`, `BtnMeetingPromptStart`, `BtnMeetingPromptMore`, `MenuMeetingPromptDismiss`, `MenuMeetingPromptNeverAgain`, `InfoCallPrompt`, `BtnCallPromptTakeNotes`.

App suggestion
127. A1 Suggest only while all system audio is selected.
128. A2 Only for known meeting apps that are playing audio.
129. A3 Skip dismissed process ids; dismissal is per pid, in memory, per session.
130. A4 Choose the loudest peak; ties by friendly name (case-insensitive).
131. A5 Suspend evaluation while the remembered app is being restored.
132. A6 Text "{0} is in a call" and action "Use {0}".
133. A7 The action selects the app card as a user choice (remembered); it never switches on its own.
134. A8 Closing the bar dismisses that pid; programmatic hides do not.

Settings and persistence
135. G1 Settings section "Calendar" with the two toggles and a per-calendar expander, with the exact texts in 2.4.
136. G2 Toggles apply from settings on first paint without writing back.
137. G3 The calendar list loads asynchronously and replaces rows atomically.
138. G4 A calendar toggle adds or removes its id (ordinal) in `disabledCalendarIds`.
139. G5 Failure text per 2.4 (and a correct "no calendars" text, B2).
140. G6 Every toggle change persists via load-modify-save of the whole settings object.
141. D1 Settings keys `calendarNotificationsEnabled` (default true), `meetingPopupEnabled` (default true), `disabledCalendarIds` (default empty).
142. D2 The disabled set drops null and blank ids; empty means all calendars.
143. D3 Meeting frontmatter keys `calendarEventId`, `calendarId`, `seriesId`, `joinUrl`, `attendees` written only when non-empty; attendees joined by ` | `.
144. D4 Spanish translations for every key listed in this spec are present and used.
