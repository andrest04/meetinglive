# Spec: shell-platform

Status: behavior spec for the Electron port. Source of truth is the WinUI3/.NET code on branch `feat/electron-port` as read on 2026-11-02. File references are `path:line` relative to the repository root; `App.xaml.cs` means `MeetingLive.App/App.xaml.cs`, and so on. Product name is Vozella; internal names (namespaces, data folders, package identity) stay `MeetingLive`.

Scope of this module: application startup and shutdown, the main window, the navigation shell (`MainPage`), the composition root (`AppServices`), the shared dialog factory, string lookup, window and tray-less lifecycle, single-instance handling (there is none), theme, keyboard shortcuts, global error handling and logging, the manifests, every background watcher, the floating "Start recording" popup and the live copilot pill as seen from the shell, the meeting chat dock that `MainPage` hosts, and the brand assets and design tokens (`docs/brand`, `scripts/make_icons.py`, `website/index.html` CSS).

Out of scope here (other module specs own them): recording pipeline, transcription, summary providers, library pages, session pages, settings sections, chat view-model logic, calendar store internals, the live copilot panel contents. Where the shell calls into them, the call and the contract are listed.

---

## 1. Purpose

Vozella is a Windows meeting recorder. This module is the frame around everything else:

1. It starts the process, restores the user's UI language, migrates legacy data, creates the single main window, and starts two background watchers (call detection, calendar reminder).
2. It hosts three destinations (Record, Library, Settings) plus a drill-down (an opened meeting, "Session") in one content frame, behind a resizable left navigation rail, with a docked meeting-chat bar at the bottom of the content area.
3. It decides when two auxiliary always-on-top windows appear: the "Meeting detected" popup and the live copilot pill.
4. It refuses to let the process end while a take is being recorded or saved.
5. It owns the visual identity: the mark, the tile icons, the palette and type tokens.

There is no tray icon, no single-instance enforcement, no global hotkey, no window-state persistence, and no in-app log viewer. Those absences are part of the behavior to port (see section 7 for which ones are gaps).

---

## 2. User-facing features

String keys are `.resw` keys from `MeetingLive.App/Strings/en-us/Resources.resw` and `.../es/Resources.resw`. In C#, `AppStrings.Get("A.B")` looks up `A/B` (dots become slashes) (`AppStrings.cs:12`); XAML `x:Uid="A"` binds property `B` from key `A.B`. English values are the default; Spanish values are in section 4.6.

### 2.1 Launch sequence

Order is fixed (`App.xaml.cs:94-142`):

1. Register the XAML unhandled-exception handler in the `App` constructor, before `InitializeComponent` (`App.xaml.cs:71`).
2. `OnLaunched` is `async void`. First await: `ApplyPersistedUiLanguageAsync()` (section 2.10). It runs before any window or resource use.
3. Construct `MainWindow` (section 2.2). Its constructor navigates the root frame to `MainPage`, so the shell page is constructed inside this step. `App.Window` is assigned after the constructor returns.
4. Capture the UI dispatcher as `App.DispatcherQueue`.
5. Run three migrations inside one `try` (section 2.11). A thrown exception is held, not shown yet.
6. `Window.Activate()`. Then subscribe to window `Activated`, to `AppServices.Recording.PropertyChanged`, and to `AppWindow.Closing`. Register a `Window.Closed` handler that tears everything down (section 2.12).
7. Create and start `MeetingCallWatcher` (5 s) and `CalendarReminderWatcher` (15 s). Subscribe `MeetingDetected` and `MeetingEnded` on the call watcher.
8. If a migration error was held, show the error dialog (`MigrationFailed_Title`, `MigrationFailed_Content` with `{0}` = exception message, button `Dialog_OK`). Single button, default is Close.

Launch arguments (`LaunchActivatedEventArgs`) are ignored. There is no command-line handling, no deep link, and no second-instance redirection.

Static accessors on `App`: `Window`, `DispatcherQueue`, `WindowHandle` (HWND), `WindowId`. Any code that shows dialogs or pickers uses these.

### 2.2 Main window

Defined in `MainWindow.xaml` and `MainWindow.xaml.cs`.

- Title text: `Vozella` (hard-coded in XAML, not localized). Title bar is a custom `TitleBar` control with `x:Uid="AppTitleBar"` (`AppTitleBar.Title` = `Vozella` in both languages) and an icon source `Assets/AppIcon.ico`. Content extends into the title bar (`ExtendsContentIntoTitleBar = true`, `SetTitleBar(AppTitleBar)`) (`MainWindow.xaml.cs:24-26`).
- Backdrop: Mica (`MicaBackdrop`) (`MainWindow.xaml:6-8`).
- Window icon: `AppWindow.SetIcon("Assets/AppIcon.ico")` (relative path) (`MainWindow.xaml.cs:29`).
- Initial size: 1180 x 760 device-independent pixels, multiplied by `GetDpiForWindow(hwnd) / 96.0` at construction (`MainWindow.xaml.cs:32-34`). Position is whatever Windows chooses. No saved size or position, no saved maximized state.
- Minimum size: 960 x 680 DIP times the same scale, set through `OverlappedPresenter.PreferredMinimumWidth/Height` (`MainWindow.xaml.cs:38-45`). The scale is computed once, at construction. If the presenter is not overlapped it is switched to overlapped first. Reason in code comment: fixed-width history sidebars (260 and 280 px) must never be squeezed.
- Layout: two rows, `Auto` title bar and `*` frame. The frame navigates to `MainPage` once.
- Per-monitor-V2 DPI awareness via `app.manifest` (section 5).

### 2.3 Navigation shell (`MainPage`)

`MainPage` is a `Page` that owns one `NavigationView` (`NavView`), the content `Frame` (`ContentFrame`), the docked chat bar, a pane resize grip, and a top `InfoBar` for the call prompt. It is the only navigator of `ContentFrame`; child pages ask the workspace service to navigate (section 3.4).

Layout (`MainPage.xaml`):

- Row 0: `InfoBar` `CallPromptBar` (closable, informational). Row 1: `NavigationView` plus the pane grip overlaid.
- `NavigationView`: `PaneDisplayMode="Auto"` (expanded on wide windows, compact on narrower, minimal when very narrow, per the control defaults), back button collapsed, built-in Settings item visible.
- Menu items, in order: Record (`x:Uid="Nav_Record"`, icon Microphone, `Tag="Recording"`, automation id `NavItemRecording`); Library (`x:Uid="Nav_History"`, icon Folder, `Tag="History"`, automation id `NavItemHistory`). `Nav_Record.Content` = "Record", `Nav_History.Content` = "Library". The Settings item content is forced in code to `Nav_Settings` ("Settings") with automation id `NavItemSettings` (`MainPage.xaml.cs:44-48`), because the control otherwise localizes from the OS language.
- Content area: grid, row `*` = `ContentFrame`, row `Auto` = chat `Expander` (section 2.13).

Behaviors:

1. First load: if nothing is selected, select the first menu item (Record) (`MainPage.xaml.cs:56-60`). That selection navigates to the Record page.
2. Selecting a menu item or Settings navigates `ContentFrame` to the matching page type: `Recording` -> `RecordingPage`, `History` -> `HistoryPage`, `Settings` -> `SettingsPage`, `Session` -> `SessionPage` (`MainPage.xaml.cs:574-596`). Before navigating, the shell tag is published to the workspace (`SetCurrentShellTag`).
3. Navigating to the page type that is already showing is a no-op, except `Session`, which always navigates, passing `Workspace.SelectedMeetingId` (a nullable Guid) as the navigation parameter. Other pages get a null parameter.
4. Session is not a pane item. While the Session page is showing, the pane selection stays on Library (`SyncPane` maps `Session` to `History`) (`MainPage.xaml.cs:554-572`). Re-clicking Library while on Session must still return to the library list even though Library is already selected, so `ItemInvoked` handles that case: if the invoked tag is `History` and the frame's current page is `SessionPage`, navigate to `History` (`MainPage.xaml.cs:500-522`).
5. Navigation requests from elsewhere (`Workspace.NavigationRequested`) call `SyncPane(tag)` then `NavigateContent(tag)`. A re-entrancy flag `_isNavigating` suppresses selection-changed handling while the shell itself is selecting, and also silently drops a navigation request that arrives while another is being processed (`MainPage.xaml.cs:483-498`).
6. Settings invoked: `ItemInvoked` ignores it; `SelectionChanged` handles it with tag `Settings`.
7. Pane width: `NavView.OpenPaneLength` is set from `settings.ResolveNavigationPaneLength()` after load (section 3.3). A drag grip (8 DIP wide, west-east resize cursor, automation id `SizerNavigationPane`, tooltip and automation name `Nav_ResizePane` = "Resize navigation pane") sits over the pane's right edge at `Margin.Left = OpenPaneLength - 4`. Visible only when display mode is Expanded and the pane is open (`MainPage.xaml.cs:475-481`). Drag: on press capture the pointer and remember start X and start length; on move set `OpenPaneLength = clamp(startLength + dx, 200, 480)` and reposition the grip; on release or capture-lost, release capture, reposition, then load settings, set `NavigationPaneLength`, save (`MainPage.xaml.cs:434-473`). Persistence happens only on release, not during the drag. There is no keyboard way to resize.
8. `NavView_DisplayModeChanged`, `PaneOpened` and `PaneClosed` re-run the grip visibility rule.

### 2.4 Call prompt bar (top of the shell)

When the call watcher sees a meeting while idle, the workspace raises `CallPromptOffered`; `MainPage` sets `CallPromptBar.IsOpen = true` (`MainPage.xaml.cs:51`). The bar:

- Title `CallPrompt_Title` ("A call is happening"), message `CallPrompt_Body` ("Take notes in Vozella so you don't miss it."), closable (X button), severity informational, automation id `InfoCallPrompt`.
- Action button `CallPrompt_TakeNotes` ("Take notes"), automation id `BtnCallPromptTakeNotes`. On click: close the bar, then `Workspace.RequestTakeNotes()` (no calendar id), which flags a pending "take notes" and navigates to Record.
- The bar is raised even when the floating popup is disabled in settings, but not when capture is already active. It is never closed automatically: it stays open after the call ends and after recording starts until the user closes it or clicks the action (confirmed gap, section 7).

### 2.5 "Meeting detected" popup window (`MeetingPromptWindow`)

A second top-level window, created lazily on first detection by `App`, then reused. `Present()` shows it; `Dismiss()` hides it. It is closed (destroyed) only when the main window closes.

Appearance and placement:

- Size 480 x 72 DIP (scaled by the window's DPI, ceiling). Top-right of the primary display's work area, inset 24 DIP from the top and right edges, then clamped inside the work area (`MeetingPromptPlacement.TopRight`). Pure math: `x = areaX + areaW - width - margin`, `y = areaY + margin`, then `LiveCopilotPillPlacement.Clamp`.
- Always on top, not resizable, not maximizable, not minimizable, no border and no title bar, hidden from the taskbar and Alt+Tab (`IsShownInSwitchers = false`). Windows 11 rounded corners requested from DWM (`DWMWA_WINDOW_CORNER_PREFERENCE = 33`, `DWMWCP_ROUND = 2`), best effort.
- Shown with `AppWindow.Show(activateWindow: false)`: it never takes focus, and so it is not reachable by keyboard.
- Always dark theme (`RequestedTheme="Dark"` on the root), regardless of the app theme. Card: solid base-alt background, 1 px surface stroke, overlay corner radius. Contents: a 40 x 40 rounded tile with the 24 x 24 app icon (`Assets/Square44x44Logo.scale-200.png`), a two-line text block, and a split accent button.
- Text: title `MeetingPrompt_Title.Text` ("Meeting detected", body-strong, single line, ellipsis), subtitle `MeetingPrompt_Subtitle.Text` ("Take notes with Vozella", caption, secondary color).
- Split button on an accent surface: left button `MeetingPrompt_Start.Content` ("Start recording", height 40, padding 16,0); a 1 px divider at 35 percent opacity; right button "more" (40 x 40, glyph E70D, name and tooltip `MeetingPrompt_More.*` = "More options") opening a menu with `MeetingPrompt_Dismiss.Text` ("Dismiss") and `MeetingPrompt_NeverAgain.Text` ("Don't notify me again"). Automation ids: `TxtMeetingPromptTitle`, `TxtMeetingPromptSubtitle`, `BtnMeetingPromptStart`, `BtnMeetingPromptMore`, `MenuMeetingPromptDismiss`, `MenuMeetingPromptNeverAgain`.
- Hover: a subtle-fill overlay fades to opacity 1 over 150 ms and the auto-hide timer is stopped; on pointer exit the overlay clears and, if visible and not dismissing, the 30 s timer restarts.

Timing and animation:

- Auto-hide after 30 s (`AutoHideSeconds`), restarted on every `Present()`.
- Entrance (only if the OS "animation effects" setting is on): 280 ms cubic ease-out; fade 0 -> 1 and slide from +24 DIP on X to 0. Before starting, any running entrance/exit storyboard is stopped and the card is reset to opacity 1, translate 0, hover overlay 0, `_dismissing = false`.
- Exit: 150 ms cubic ease-in fade of the card to 0, then `AppWindow.Hide()`. Skipped (immediate hide) when `animate` is false or animations are off. A second `Dismiss()` while a fade-out runs is ignored. If `Present()` cancels a fade-out, the completion callback must not hide the window.
- `Dismiss()` on a hidden window only stops the timer.

Actions:

- Start recording: dismiss without animation; if the main window is minimized, restore it; activate it; `Workspace.RequestTakeNotes()` (navigates to Record and asks it to start a blank capture) (`MeetingPromptWindow.xaml.cs:219-228`).
- Dismiss: animated dismiss only.
- Don't notify me again: animated dismiss, then load settings, and if `MeetingPopupEnabled` is true set it to false and save. Errors are swallowed silently.

When it appears: only via the call watcher (section 2.6), and only if `MeetingPopupPolicy.ShouldShow(popupEnabled, captureActive, alreadyPrompted=false)`, i.e. `popupEnabled && !captureActive`. It is dismissed when the call windows disappear (`MeetingEnded`) or when recording starts (`ApplyRecordingHandoff` on the false-to-true transition).

### 2.6 Call detection watcher (`MeetingCallWatcher`)

Polls every 5 s on a UI-thread timer (`MeetingCallWatcher.cs:25-31`). State: `_armed` (starts true), `_windowFound`, `_ticking` (re-entrancy gate: a tick that finds the previous one still running returns immediately).

Per tick (`MeetingCallWatcher.cs:35-104`):

1. `inCall = MeetingWindowScanner.AnyMeetingWindow()`. If it changed from the last tick, log a debug line ("meeting window found" / "meeting window not found").
2. If not in a call: if currently disarmed, re-arm and raise `MeetingEnded`. Return.
3. In a call but disarmed: return (one prompt per call).
4. In a call, armed, and `Workspace.IsCaptureActive`: disarm, log, return. No prompt for the rest of this call, even if capture stops mid-call.
5. Otherwise: disarm, set `disarmedThisTick`, call `Workspace.OfferCallPrompt()` (shows the top InfoBar), load `MeetingPopupEnabled` (default true if settings cannot be read), and if `MeetingPopupPolicy.ShouldShow(...)` raise `MeetingDetected`; otherwise log the suppression reason. Clear `disarmedThisTick`.
6. Any exception: if it happened before the popup was handled, re-arm so the next tick retries; log only the exception type name; never crash.

`MeetingWindowScanner.AnyMeetingWindow()` (`MeetingWindowScanner.cs:11-50`): enumerates all top-level windows (`EnumWindows`), skipping invisible ones and ones with empty titles; reads the title; resolves the owning process id; skips process id 0; gets the process name (`Process.GetProcessById`); stops at the first window for which `MeetingCallDetector.IsMeeting(processName, title)` is true. `ArgumentException` (process gone) and `InvalidOperationException` are swallowed per window. Matched windows are logged to the debug stream with process name and title (titles can contain private text; they go only to the debugger, never to a file).

`MeetingCallDetector.IsMeeting(processName, windowTitle)` (`MeetingCallDetector.cs:15-38`):

- Process name is trimmed and lowercased; empty -> false.
- `cpthost` -> true regardless of title (Zoom's share host).
- `zoom` -> title contains (case-insensitive) "Zoom Meeting" or "Zoom Webinar".
- `teams` or `ms-teams` -> title contains "Meeting" or "Call" (case-insensitive).
- `chrome`, `msedge`, `firefox`, `brave`, `opera`, `vivaldi` -> title matches regex `\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b` (ignore case, invariant culture) AND contains "Meet" (case-insensitive). The landing page has no code, so it does not match.
- Everything else -> false.

### 2.7 Calendar reminder watcher (`CalendarReminderWatcher`)

Polls every 15 s (`CalendarReminder.PollInterval`) on a UI-thread timer, plus one immediate poll at start. Shows a Windows app notification (toast) for an upcoming meeting. It never toasts an error and never throws.

Start (`CalendarReminderWatcher.cs:30-53`): subscribe `AppNotificationManager.Default.NotificationInvoked`, then `Register()`. A `Register` failure (already registered) is swallowed and notifications still work. Any other failure sets `_notificationsReady = false`; polling still runs but toasts are skipped. Dispose: stop the timer; unsubscribe if ready. `Unregister` is never called.

Poll (`CalendarReminderWatcher.cs:70-115`), guarded by a re-entrancy flag:

1. Skip if `Workspace.IsCaptureActive`.
2. Load settings; skip if `CalendarNotificationsEnabled` is false.
3. `Calendar.GetUpcomingAsync(now, settings.DisabledCalendarIdsAsSet())`. If `Failure` is `AccessDenied` or `NoPackageIdentity`, stop quietly. Other failures continue with whatever events came back.
4. Re-check capture and the setting (state may have changed during the await).
5. `CalendarReminder.ForgetStarted(_notified, now)` removes ids whose recorded start is at or before now.
6. For each event, `CalendarReminder.ShouldNotify(event, now, alreadyNotified)`; if true and `ShowToast` succeeds, record `_notified[eventId] = event.Start` and add to the working set.
7. Any exception: swallowed.

`ShouldNotify` (`CalendarReminder.cs:74-94`): false if the event id is blank; false if already notified; false if `CalendarEventFilter.IsVisible(event)` is false (owned by the calendar module: it excludes all-day, declined, out-of-office, focus and free blocks); false unless `start - 90 s <= now < start`; then true only if `CountPeople(event) >= 2`.

`CountPeople`: number of non-blank names in `AttendeeDisplayNames`; plus one (the owner) when `OrganizedByCurrentUser` is true or `AttendeesIncludeCurrentUser` is false. The Windows store never sets `AttendeesIncludeCurrentUser`, so in production the owner is always added: one invitee means two people.

Toast content (`ShowToast`): skipped if notifications are not ready or the subject is blank. Text line 1: subject trimmed. Text line 2: `CalendarReminder_Body` ("This meeting is about to start."). One button labeled `CallPrompt_TakeNotes` ("Take notes"). Arguments on both the toast and the button: `action=open-calendar-event` and `eventId=<Uri.EscapeDataString(eventId)>`. Constants: `OpenEventAction = "open-calendar-event"`, `EventIdArgument = "eventId"`.

Activation (`OnNotificationInvoked`): requires `action == open-calendar-event` and a non-blank `eventId`; unescapes it; on the UI dispatcher calls `App.Window.Activate()` then `Workspace.RequestTakeNotes(eventId)`. It does not restore a minimized window (compare the popup's Start button, which does).

### 2.8 Recording start handoff and live copilot pill (shell side)

`App` subscribes to `AppServices.Recording.PropertyChanged`; only the `IsRecording` property matters. The handler marshals to the UI thread if needed and runs `ApplyRecordingHandoff` (`App.xaml.cs:335-373`):

1. `decision = LiveCopilotRecordingHandoff.Decide(wasRecording, isRecording)`. Both `MinimizeMainWindow` and `ShowStartedHint` equal `!wasRecording && isRecording`. Pause, resume, import, discard and stop do not take this path (they do not flip `IsRecording` false-to-true).
2. `_wasRecording = isRecording`.
3. If recording: dismiss the "Meeting detected" popup (the offer is moot).
4. If `MinimizeMainWindow` and the presenter is overlapped: `Minimize()`. Then set `_mainWindowActive = false` (after minimizing, so a re-entrant activation event cannot leave it true and hide the pill).
5. Set `_handingOff = decision.ShowStartedHint`; run `UpdateLiveCopilotPill()`; if `ShowStartedHint`, call `pill.ShowStartedHint()`; clear `_handingOff`.

The main window is never restored automatically when recording stops.

`UpdateLiveCopilotPill` (`App.xaml.cs:381-400`): `show = isRecording && (!mainWindowActive || handingOff)` (`LiveCopilotRecordingHandoff.ShouldShowPill`). If `show` is false and no pill exists, do nothing. Otherwise create the pill lazily (and null the reference when it closes), then fire-and-forget `SetVisibleAsync(show, collapse: !isRecording)`. `_mainWindowActive` is updated on each main-window `Activated` event: `state != Deactivated`.

Pill window facts the shell depends on (`LiveCopilotWindow.xaml.cs`; panel contents belong to the live-copilot spec):

- Title `LiveCopilot_Title` ("Live copilot"). Always on top, borderless, fixed-size, hidden from the taskbar and Alt+Tab, always dark theme. Shown with no activation so focus stays in the meeting app. Cut to a rounded silhouette with a GDI window region (not anti-aliased; a XAML outline draws the soft edge). The native frame bits `WS_CAPTION` and `WS_THICKFRAME` are removed and DWM border color is set to none (`DWMWA_BORDER_COLOR = 34`, value -2).
- Geometry (DIP): capsule short side 64; long side 240 when vertical (left or right edge) and 272 when horizontal (top or bottom); edge margin 16; chat panel 380 x 500; gap between capsule and panel 8; expanded corner radius 28; collapsed corner radius is half the short side (full capsule); drag threshold 4.
- Docking: persisted as an edge name plus a fraction along that edge (section 3.5). Default: right edge, centered (`along` 0.5). Position math is in `LiveCopilotPillDock` (section 3.5).
- Timing: entrance slide 300 ms (quint ease-out) from off-screen by its own thickness plus margin while fading in; exit 160 ms (cubic ease-in); snap-to-edge tween 240 ms; panel-in 220 ms (cubic ease-out, slide 16 DIP); started-hint pulse 180 ms auto-reversing to scale 1.08; started tooltip text `LiveCopilot_StartedMessage` ("Recording started") shown for 2500 ms (`StartedHintDuration`) on the icon tile, placed toward screen center; position save debounced 500 ms; tween frame timer 16 ms. With OS animations off, entrance and exit are instant.
- `SetVisibleAsync(true)`: loads the saved dock once (`_restoreTask`), re-checks `_wantVisible`, then docks and plays the entrance. `SetVisibleAsync(false)`: cancels a pending started hint; if `collapse`, folds the panel; saves the dock position immediately; plays the exit unless a show request arrived meanwhile.
- Drag: left-button press on the capsule (not on the logo tile) arms a drag; it starts after the cursor moves 4 DIP (physical cursor position via `GetCursorPos`); grabbing folds the panel; on release the capsule snaps to the nearest edge (section 3.5) with a tween, and the new edge and fraction are saved after 500 ms.
- Closing the main window closes the pill, which lets the process exit.

### 2.9 Close and exit gate

Triggered by `AppWindow.Closing` (`App.xaml.cs:150-164`) and by the language restart (`SettingsPage.xaml.cs`, section 2.10). The handler decides synchronously because `Cancel` is read when it first returns.

1. If `_closeApproved` is set, allow the close.
2. `HasWorkToProtect = Recording.RequiresCloseConfirmation || Recording.HasPendingSaves`. `RequiresCloseConfirmation` is true only in session phase `Recording`; `HasPendingSaves` is true in phase `Stopping` or while any pipeline run is still in flight (`RecordingPageViewModel.PipelineRun.cs:33-36`). If nothing to protect, allow the close.
3. Otherwise set `args.Cancel = true`, run `PrepareForExitAsync()`. If it returns true, set `_closeApproved = true` and call `Window.Close()` (which re-enters the handler and passes at step 1).

`PrepareForExitAsync` (`App.xaml.cs:175-198`): returns true immediately when there is nothing to protect. A second caller while the first is still deciding gets false (`_closeInProgress`). Any exception is logged to `crash.log` as `<ISO timestamp> close failed` plus the exception, and the result is false (staying open is the safe outcome).

`ConfirmAndSaveForCloseAsync` (`App.xaml.cs:201-240`):

1. Bring the main window to front: restore if minimized, then activate (a dialog in a minimized window would go unseen).
2. If `RequiresCloseConfirmation` (actively recording): confirm dialog. Title `AppClose_Recording_Title` ("Stop recording before closing?"), content `AppClose_Recording_Content`, primary `AppClose_Recording_StopAndSave` ("Stop and save", default), close button `AppClose_Recording_Keep` ("Keep recording"). Anything but primary returns false (stay open). If showing throws a COM exception (another dialog is already open), return false.
3. Save with a progress dialog (`SaveWithProgressAsync`): a content dialog titled `AppClose_Saving_Title` ("Saving your recording") with an indeterminate progress bar and no buttons, whose `Closing` event is cancelled until the save finishes. If another dialog is open (COM exception) the progress dialog is skipped; the save still runs. The work is `Recording.SaveAndFinishForCloseAsync()`: stop capture; wait for every in-flight run's first save; cancel all runs; wait up to 30 s (`CloseGracePeriod`) for their completion; result is true only if every take was saved as a meeting with its audio. Unfinished transcription and summary are cancelled and can be re-run from the saved meeting.
4. If the save succeeded, return true (exit). If it failed, show a second confirm: title `AppClose_SaveFailed_Title` ("The recording could not be saved"), content `AppClose_SaveFailed_Content`, primary `AppClose_SaveFailed_CloseAnyway` ("Close anyway"), close `AppClose_SaveFailed_Stay` ("Keep open", default is Close). Exit only on primary.

No path discards a take. Closing during phase `Preparing` (a start or import is underway) is not protected (section 7).

### 2.10 UI language

`AppSettings.UiLanguage` holds a BCP-47 tag (`en-US` or `es`), or null for "follow the system". At startup (`App.xaml.cs:413-442`):

1. Load settings; on any exception, return without changes.
2. If `UiLanguage` is blank, return (OS/ApplicationLanguages decides).
3. Set `ApplicationLanguages.PrimaryLanguageOverride = UiLanguage` on every launch (idempotent).
4. `UiLanguageResolver.ResolveCulture(tag)`: `null` for blank or unknown tags; otherwise a `CultureInfo`. If null, stop. Otherwise set `CurrentUICulture`, `CurrentCulture`, and both `DefaultThreadCurrent*Culture` values, so thread-pool threads inherit them. `Core` strings and date formats follow `CultureInfo`; WinUI `.resw` text follows `ApplicationLanguages`. The two systems are independent and are synced here.

Changing language in Settings (`UiLanguageSectionViewModel.ApplyLanguageAsync`, `SettingsPage.xaml.cs`): if the picked tag equals the current one return false; otherwise update the selection, set `PrimaryLanguageOverride` immediately, save `UiLanguage`, return true. When true, the page shows a confirm dialog (`SettingsLanguageRestart_Title` "Restart required", `_Content` "The language will apply once Vozella restarts. Restart now?", primary `_RestartNow` "Restart now", close `_Later` "Later", default Primary). On primary, the page calls `App.TryPrepareForExitAsync()` (the same gate as closing); if it returns false (user keeps recording, or a close decision is already open) nothing happens and the language applies on the next launch. If true, `AppInstance.Restart("")` ends the process and relaunches; if Restart returns a failure reason the app keeps running.

Already-loaded resource text never changes without a restart: `AppStrings` holds a process-lifetime `ResourceLoader`.

The picker options are fixed: `en-US` labelled `Settings_LanguageEnglish` ("English") and `es` labelled `Settings_LanguageSpanish` ("Español"); labels are the same in both languages by design. When `UiLanguage` is unset, the picker preselects the primary subtag match of `ApplicationLanguages.Languages[0]`, else English (`UiLanguageResolver.MatchPrimarySubtag`: compare the part before the first `-`, case-insensitive; "es-ES" matches "es", "en-GB" matches "en-US").

Meeting and summary content languages are separate settings (`TranscriptionLanguage`, `SummaryLanguage`, both default `es`); they are owned by the settings module.

### 2.11 Startup migrations

Three migrations run on the UI thread, in this order, inside one `try`; the first failure aborts the rest and is shown after the window appears (`App.xaml.cs:104-112`):

1. `UserDataLocationMigrationService.MigrateIfNeeded()` (synchronous): move meeting files from `%LOCALAPPDATA%\MeetingLive` to `Documents\MeetingLive`. Skips when every legacy path equals its new path. Creates the new meetings and recordings directories; moves each file from the legacy meetings and recordings directories if the destination file does not exist (never overwrites); moves legacy `folders.json` if no destination exists; rewrites the `audioFilePath:` line of every `*.md` under the new meetings directory when it points into the legacy recordings directory (new path = recordings directory + file name); deletes the legacy directories if empty. IO and permission errors on the empty-directory delete are swallowed; every other failure throws.
2. `MeetingLibraryLayoutMigrationService.MigrateIfNeededAsync()`: if the leftover meetings directory (`Documents\MeetingLive\Meetings`) has `*.md` files, parse each (skip unparseable ones), repair a missing audio path from `<leftover recordings>/<guid>.wav` if that file exists, and save through the meeting repository (which files it into the Inbox with a dated title and sidecar audio). Empty leftovers are removed.
3. `MeetingsMigrationService.MigrateIfNeededAsync()`: if the legacy single-file `%LOCALAPPDATA%\MeetingLive\meetings.json` exists, save every legacy record whose id is not already present as Markdown, then rename the file to `meetings.json.bak` (or `.bak.1`, `.bak.2`, ... the next free name). It never deletes the original, never overwrites an existing meeting, and never overwrites an existing backup.

Failure dialog text: `MigrationFailed_Title` ("Meeting history migration failed"), `MigrationFailed_Content` ("Vozella could not migrate your existing meeting history to the new format. Your original data was left untouched."). The text does not include the exception message in English or Spanish, although `AppStrings.Format("MigrationFailed_Content", ex.Message)` passes it as `{0}`; the English string has no `{0}` placeholder, so the message is dropped (`App.xaml.cs:444-452`).

### 2.12 Shutdown and teardown

On `Window.Closed` (`App.xaml.cs:119-132`): unsubscribe `Activated` and the recording property handler; close the pill and null it; dispose the call watcher; close the popup and null it; dispose the calendar watcher. Nothing else runs: no explicit flush, no notification unregistration. The process exits when all windows are closed. There is no tray to keep it alive: closing the window ends reminders and call detection.

### 2.13 Meeting chat dock (hosted by the shell)

The dock is part of `MainPage`. Its view-model (`MeetingChatViewModel`, `Chat`) belongs to the chat module; the shell wires UI events and dialogs. Shell-owned behavior:

Structure: an `Expander` (name `BarMeetingChat`, `x:Uid="Chat_Bar"` with automation name "Meeting chat", expands upward, stretched, automation id `BarMeetingChat`), bound two-way to `Chat.IsExpanded`, visible when `Chat.IsVisible`.

Header (three columns): a rounded chip (padding 10,4, radius 12, subtle fill, card stroke) with a scope glyph (`Chat.ScopeGlyph`, 14 px) and the scope label (`Chat.ScopeLabel`, body-strong, ellipsis, id `LblMeetingChatScope`); a history button (glyph E81C, name "Chat history", id `BtnMeetingChatHistory`) with a flyout; a new-chat button (glyph E710, "New chat", id `BtnMeetingChatNew`, command `Chat.NewChatCommand`).

History flyout (placement top-edge aligned right, 320 wide): "No chats yet." (`Chat_HistoryEmpty.Text`) when empty; a list (max height 280, click-to-open, id `ListMeetingChatHistory`) of threads showing title (ellipsis) and "Updated {0}" caption, each with a delete button (`Chat_DeleteThread`). Opening the flyout refreshes the thread list; a refresh error goes to the chat error bar (`Chat.ShowSendError`). Clicking a thread hides the flyout, opens the thread, scrolls the transcript to the end. Deleting asks `Chat_DeleteThreadTitle` ("Delete chat?") / `Chat_DeleteThreadContent` ("Delete "{0}"? This cannot be undone.") with primary `Chat_DeleteThreadPrimary` ("Delete") and close `Chat_DeleteThreadCancel` ("Cancel"), default Close.

Body (rows, 12 padding, 8 spacing): transcript list (max height 420, no selection, id `ListMeetingChat`, name "Chat messages"); error `InfoBar` (closable, severity error, title "Could not answer", id `InfoMeetingChatError`, bound to `Chat.IsErrorOpen` and `Chat.ErrorMessage`); scope-mismatch hint "This chat is from another scope. Sending starts a new chat." (when `Chat.ShowScopeMismatch`); starter chips (wrap panel, 8 spacing; each chip is a button, padding 12,4, radius 12, tooltip = the recipe prompt, shown when `Chat.ShowStarterRecipes`, id `ListMeetingChatStarters`, name "Suggested questions"); composer row.

Messages: user messages right-aligned in the right 3/4 column (padding 12,8, radius 8, secondary card fill, stroke, selectable text). Assistant messages: role label caption, Markdown block (shown when text exists; `WrapWholeWords`; link handler below), a 16 px progress ring plus "Thinking…" while thinking, and a 32 x 32 copy button (glyph E8C8, "Copy") visible when there is an answer. Roles: "You", "Assistant".

Composer row (columns `*`, auto, auto, auto): multi-line `TextBox` (placeholder "Ask about your meetings", name "Message", min height 32, max height 96, min width 180, vertical scrollbar auto, id `TxtMeetingChat`) bound two-way to `Chat.Draft`, updated on every change; Send button (accent style, glyph E724, name "Send", tooltip "Send (Enter)", id `BtnMeetingChatSend`, command `Chat.SendCommand`); personal-tasks button (TypeSafe icon 16 x 16, name and tooltip "What do I need to do", visible when `Chat.ShowPersonalTasksRecipe`, id `BtnMeetingChatPersonalTasks`); recipes button (glyph E8FD, "Recipes", id `BtnMeetingChatRecipes`) with a flyout.

Keyboard in the composer (`MainPage.xaml.cs:97-116`): Enter sends (marks handled, runs `SendCommand` if `CanExecute`); Shift+Enter inserts a newline (Enter with Shift held is passed through; Shift state read from `InputKeyboardSource`); Ctrl+Enter is a keyboard accelerator on the Send button and also sends.

Recipes:

- Typing a draft that `Chat.TryFilterRecipesFromDraft()` accepts (the slash-command filter) opens the recipe flyout anchored to the composer; otherwise the flyout hides. A flag `_suppressRecipeFlyout` prevents re-opening while a recipe is being applied; `_recipeFlyoutFromSlash` makes the flyout's `Opening` handler skip `ShowAllRecipes()` when the flyout was opened by the filter; opened from the button, `ShowAllRecipes()` runs.
- Flyout (320 wide, placement top-edge aligned right): "No recipes for this scope." when none; list (max 240) of recipes showing name and a 2-line prompt; delete button (glyph E74D) only when `CanDelete` (user-created recipes); "New recipe" button.
- Click a recipe: apply it to the draft, hide the flyout, focus the composer with the caret at the end; the suppress flag clears on the next dispatcher tick.
- Click a starter chip: `Chat.SendRecipeAsync(recipe)`; errors go to the error bar.
- New recipe dialog: title `Chat_CreateRecipeTitle` ("New recipe"); fields Name (header "Name", placeholder "Recipe name"), Prompt (header "Prompt", placeholder "What should this recipe ask?", multi-line, wrapping, min height 80), and a two-option radio group "Available for": "This meeting" / "Multiple meetings" (preselected from `Chat.PrefersMultipleRecipes`). Primary "Save", close "Cancel", default Primary. Closing with Primary is blocked (the dialog stays open, with no message) while name or prompt is blank/whitespace. On save: `Chat.CreateRecipeAsync(name, prompt, multiple)`.
- Delete recipe: confirm `Chat_DeleteRecipeTitle` ("Delete recipe?") / `Chat_DeleteRecipeContent` ("Delete "{0}"? Built-in recipes stay."), primary "Delete", close "Cancel", default Close.
- Personal tasks button: opens `PersonalTasksDialog` for `Chat.CurrentMeetingId`; a re-entrancy flag ignores clicks while it is opening.

Links in assistant Markdown (`ChatMarkdown_LinkClicked`): if `ChatPromptBuilder.TryParseMeetingLink(link, out id)`: if the meeting does not exist, show `Chat.ShowMeetingLinkMissing()` ("That meeting no longer exists."); otherwise `Workspace.SelectMeeting(id)` and `Workspace.OpenSession("Summary")`. Else if the link is an absolute http or https URI, launch it in the default browser. Any other scheme is ignored. Errors go to the error bar.

Copy: the copy button calls `Chat.CopyMessageCommand` if it can execute.

Scrolling: when the message collection changes, scroll to the last item at low dispatcher priority; for a pending (streaming) message, subscribe to its property changes and on each `Text` change scroll the transcript's scroll viewer to its extent height without animation (because `ScrollIntoView` stops at the top of a row taller than the viewport).

On first load: assign the provider-resolution callbacks to the chat view-model (`EnsureSummaryModelAsync`, `EnsureCliProviderAsync(kind)`, `EnsureXaiProviderAsync`, each given this page's `XamlRoot` so the resolver can show dialogs), then `Chat.InitializeAsync()`; errors go to the error bar.

### 2.14 Keyboard shortcuts (complete list)

Shell-level: none beyond those below. There are no global (OS-wide) hotkeys, no menu bar, no Ctrl+Tab, no F-key bindings.

| Keys | Scope | Action | Defined in |
| --- | --- | --- | --- |
| Enter | chat composer | send | `MainPage.xaml.cs:97` |
| Shift+Enter | chat composer | newline | same |
| Ctrl+Enter | chat Send button | send | `MainPage.xaml:325-330` |
| Ctrl+R | Record page | start or stop recording | `RecordingPage.xaml:330,550` |
| Ctrl+P | Record page | pause or resume | `RecordingPage.xaml:567` |
| Ctrl+Shift+D | Record page | discard take | `RecordingPage.xaml:624` |
| Ctrl+Enter | live ask box and live answer button (Record page and pill) | ask or answer, scoped to the control | `RecordingPage.xaml:862,895`, `LiveCopilotWindow.xaml:91,173` |

The pill's accelerators are scoped by setting `ScopeOwner` to the text box and the button after load, because a null owner would make them global (`LiveCopilotWindow.xaml.cs:182-187`). Standard `NavigationView` keyboard behavior (arrow keys on the rail, Enter to invoke) is inherited from the control.

### 2.15 Theme

There is no theme setting. The app follows the Windows light or dark setting. Resource dictionaries define three variants (Light, Dark, HighContrast) for the brand and folder-accent brushes (`App.xaml:12-46`). Two always-dark surfaces ignore the theme: the "Meeting detected" popup and the live copilot pill (`RequestedTheme="Dark"`). High-contrast mode maps folder accents to the system highlight color and the brand brush to the system window-text color. Windows 11 Mica provides the window backdrop. Shared styles (`App.xaml:49-59`): `CardSurface` (a Border style: card background and stroke, 1 px, control corner radius, padding 16, keyed because borders are also used for dots and pills) and `SecondaryCaptionTextBlockStyle` (caption with secondary text color).

### 2.16 Dialogs

`AppDialogFactory` (`AppDialogFactory.cs`) is the one construction point for content dialogs:

- `CreateConfirm(xamlRoot, title, content, primaryText, closeText, defaultButton)`: primary and close buttons; `content` may be text or any control.
- `CreateError(xamlRoot, title, content, closeText)`: close button only, default Close.
- Both use the app's `DefaultContentDialogStyle` resource.

WinUI allows only one content dialog at a time; a second `ShowAsync` throws a COM exception. The close and restart gate treats that exception as "another dialog is in front, stay open".

### 2.17 Composition root (`AppServices`)

A static class building singletons at first access (`AppServices.cs`). Access happens before any window exists (settings load in `ApplyPersistedUiLanguageAsync`), so a throwing static initializer kills startup. Members, all created once:

Audio and capture: `AudioCapture`, `AudioImport`, `Microphones`, `MicrophoneLevelMeter`. Transcription: `NemotronModels` (shares the model-download HTTP client), `NemoSpeechRuntime` (same client), `NemoSpeechEngine` (native), `HardwareDetection`, `AsrBackend`, `Transcription`, `LiveTranscription`. Local LLM: `LocalLlmModels` (model-download client). Data: `Meetings` (Markdown repository), `Calendar` (Windows appointment store), `Folders`, `ChatThreads`, `ChatRecipes`, `Settings`, `NoteTemplates`. Credentials and clouds: `XaiCredentials` (DPAPI file), `XaiOAuth`, `XaiApi`, `XaiAuth`, `TypeSafeCredentials` (DPAPI file), `TypeSafeApi`, `MeetingJev`. App state: `Workspace`, `Recording` (lazy, must be first touched on the UI thread), `Retranscription`.

HTTP clients: model download has an infinite timeout and is shared; the xAI client has a 5 minute timeout and `User-Agent: MeetingLive`; the TypeSafe client has a 2 minute timeout. All lazy.

Factories (not singletons, because the selection can change between recordings and the local provider owns model weights): `CreateSummaryProvider(kind, localModelPath)`, `CreateLiveAnswerProvider(kind, localModelPath, webSearch)` (web search flag only affects Claude Code and Codex), `CreateTranscriptPolisher(kind, localModelPath)`. Kinds: Local (requires a path, else `ArgumentNullException`), ClaudeCode, Codex, Xai; unknown kind throws `ArgumentOutOfRangeException`. Claude, Codex and xAI factories read model id and effort from a synchronous settings snapshot (`LoadSettingsSnapshot`): file missing or any error returns defaults; synchronous because awaiting `LoadAsync().GetResult()` can deadlock the UI thread. xAI model id passes through `XaiApiClient.ResolveModelId(selected, [])`.

---

## 3. Domain rules, constants, algorithms

### 3.1 Timings and thresholds (all in one place)

| Constant | Value | Source |
| --- | --- | --- |
| Call-detection poll | 5 s | `MeetingCallWatcher.cs:27` |
| Calendar poll | 15 s | `CalendarReminder.cs:35` |
| Calendar notify window | `[start - 90 s, start)` | `CalendarReminder.cs:32,40-44` |
| Popup auto-hide | 30 s | `MeetingPromptWindow.xaml.cs:21` |
| Popup size, margin | 480 x 72 DIP, 24 DIP | same, lines 22-24 |
| Popup entrance, exit | 280 ms, 150 ms; slide 24 DIP | same, lines 25-26 |
| Popup hover overlay fade | 150 ms | `MeetingPromptWindow.xaml:42` |
| Pill started hint | 2500 ms | `LiveCopilotRecordingHandoff.cs:7` |
| Pill save debounce | 500 ms | `LiveCopilotWindow.xaml.cs:190` |
| Pill tween tick | 16 ms | `:200` |
| Pill snap, entrance, exit | 240, 300, 160 ms | `:41-43` |
| Pill panel-in, pulse | 220 ms (16 DIP slide), 180 ms (scale 1.08) | `:44-45,38-39` |
| Pill sizes (DIP) | short 64; long 240 vertical, 272 horizontal; margin 16; panel 380 x 500; gap 8; expanded radius 28; drag 4 | `:29-37` |
| Window size | 1180 x 760 DIP x DPI scale | `MainWindow.xaml.cs:34` |
| Window minimum | 960 x 680 DIP x DPI scale | `:44-45` |
| Pane width | default 280, min 200, max 480 DIP | `AppSettings.cs:182-184` |
| Pane grip | 8 DIP wide, offset `OpenPaneLength - 4` | `MainPage.xaml:413`, `MainPage.xaml.cs:473` |
| Close grace for run completion | 30 s | `RecordingPageViewModel.PipelineRun.cs:11` |
| Chat stream flush | 80 ms (chat module) | `MeetingChatViewModel.cs:78` |
| Chat panel heights | transcript max 420, composer 32-96, history list max 280, recipes list max 240 | `MainPage.xaml` |
| Audio peaks poll | 150 ms, full refresh every 10th tick | `RecordingAudioSourcesViewModel.cs:17-18` |
| Audio bars animation | 33 ms | `AudioBarsControl.xaml.cs:60` |
| Elapsed timer | 1 s | `RecordingPageViewModel.cs:1806` |
| Copy-confirmation, highlight feedback | 2.5 s, 2 s | `RecordingPageViewModel.cs:1686,1695` |
| Provider feedback timers | 4 s (xAI, TypeSafe), 2.5 s (session copy) | view-models |

### 3.2 Background watcher inventory

Every watcher or timer running while the process lives, when it starts and when it stops:

| Watcher | Kind | Interval | Starts | Stops |
| --- | --- | --- | --- | --- |
| `MeetingCallWatcher` | UI-thread `DispatcherTimer` | 5 s | `OnLaunched`, after the window is activated | `Window.Closed` (dispose stops the timer). Not paused during recording; it is suppressed by state (disarmed while capture is active). |
| `CalendarReminderWatcher` | UI-thread `DispatcherTimer` plus WinRT notification subscription | 15 s, plus one poll at start | `OnLaunched`, after the call watcher | `Window.Closed`. Polls are skipped (not stopped) while capture is active or reminders are off. |
| Popup auto-hide timer | `DispatcherQueueTimer`, one shot | 30 s | each `Present()`; restarted on pointer exit | `Dismiss`, pointer enter, window closed |
| Pill timers: save-position (500 ms one-shot), started-hint (2.5 s one-shot), tween (16 ms repeating) | `DispatcherQueueTimer` | as listed | on drag end or dock change; on hint; during an animation | on hide, on cancel, on `Closed` |
| Pill audio bars | animation timer in `AudioBarsControl` (33 ms) | 33 ms | `SetVisibleAsync(true)` sets `IsRunning` | hide or close |
| Recording elapsed timer | `DispatcherQueueTimer` | 1 s | recording start | stop or discard (record module) |
| Record page audio-source meters | background `PeriodicTimer` task | 150 ms | Record page visible, idle | page hidden or recording starts (record module) |
| Settings microphone level meter | background meter | n/a | Settings page load | `SettingsPage.OnNavigatedFrom` -> `StopLevelMeter()` |
| Window `Activated`, recording `PropertyChanged` | event subscriptions | n/a | after window activation | `Window.Closed` |

There are no file-system watchers, no registry or power-event listeners, no audio device notification listeners in this module, no network heartbeat, and no update checker.

### 3.3 Pane length

`AppSettings.ResolveNavigationPaneLength()`: null -> 280; otherwise `clamp(value, 200, 480)`. Applied after `Chat.InitializeAsync()` returns on first page load (`MainPage.xaml.cs:66-87`).

### 3.4 Workspace service (navigation channel)

`WorkspaceService` (`MeetingLive.App/Services/WorkspaceService.cs`) is the app-lifetime store and the only way child pages request shell navigation.

- Tags: `Recording`, `History`, `Settings`, `Session` (strings, defined by `ChatScopeResolver`). Session tabs: `Transcript`, `Summary` (default `Transcript`); they are not shell destinations. `NavigateTo(tag)` throws `ArgumentOutOfRangeException` for a session tab or an unknown tag and `ArgumentException` for blank.
- State: `SelectedMeetingId` (nullable), `LastProcessedMeeting`, `SessionTab`, `CurrentShellTag` (default `Recording`), `SelectedFolderId` (null means Inbox, not "nothing loaded"), `LiveTranscript` (latest live transcript window; chat reads it only while `IsCaptureActive`), `IsCaptureActive`.
- Events: `NavigationRequested(string tag)`, `ScopeChanged` (raised on shell tag change, folder publish, selected meeting change, capture-state change; not on transcript text), `MeetingDeleted(id)`, `MeetingChanged(id)`, `TakeNotesRequested`, `CallPromptOffered`.
- `SetCurrentShellTag`: validates; ignores a repeat of the current tag; otherwise stores and raises `ScopeChanged`.
- `SelectMeeting(id)` sets the selection (raises `ScopeChanged` only if it changed). `ClearSelection()` also clears `LastProcessedMeeting` if it was the selected one. `NotifyDeleted(id)` clears `LastProcessedMeeting` if it matches (even if not selected), clears selection if it matches, then raises `MeetingDeleted`. `SetLastProcessed(record)` stores it and selects its id.
- `OpenSession(tab)`: sets the session tab (validates `Transcript` or `Summary`), then `NavigateTo(Session)`.
- Take-notes handshake: `RequestTakeNotes(calendarEventId?)` stores a pending flag and an optional event id (blank becomes null), raises `TakeNotesRequested`, then `NavigateTo(Recording)`. The pending state survives until the Record page is constructed and calls `ConsumeTakeNotes(out calendarEventId)`, which returns true once and clears both; a call without a pending flag returns false and a null id.

### 3.5 Live copilot dock math (`LiveCopilotPillDock`, `LiveCopilotPillPlacement`)

All values are physical pixels.

- `Clamp(x, y, w, h, area)`: `maxX = max(areaX, areaX + areaW - w)`, `maxY` likewise; result `(clamp(x, areaX, maxX), clamp(y, areaY, maxY))`. A window larger than the area pins to the area's top-left.
- `IsVertical(edge)`: Left or Right.
- `NearestEdge(centerX, centerY, area)`: distances `right = areaX + areaW - cx`, `left = cx - areaX`, `bottom = areaY + areaH - cy`, `top = cy - areaY`. Start with Right; replace with Left if strictly smaller, then Bottom, then Top. A tie prefers Right, then Left, then Bottom, then Top.
- `PositionFor(edge, along, w, h, area, margin)`: `t = finite(along) ? clamp(along, 0, 1) : 0.5`. Vertical: `x = left ? areaX + margin : areaX + areaW - w - margin`; `y = areaY + margin + round(t * travel)` where `travel = max(0, areaH - h - 2*margin)`. Horizontal: `x = areaX + margin + round(t * max(0, areaW - w - 2*margin))`; `y = top ? areaY + margin : areaY + areaH - h - margin`. Rounding is `Math.Round` (banker's rounding, midpoint to even).
- `AlongFor(edge, x, y, w, h, area, margin)`: inverse; offset = `y - areaY - margin` (vertical) or `x - areaX - margin` (horizontal) divided by travel; clamp 0..1; when travel <= 0 return 0.5.
- `ExpandedBounds(edge, capsule rect, panelW, panelH, gap, area)`: vertical edge: `width = min(capsuleW + gap + panelW, areaW)`, `height = min(max(capsuleH, panelH), areaH)`, `x = left ? capsuleX : capsuleX + capsuleW - width`, `y = capsuleY + (capsuleH - height) / 2` (integer division). Horizontal edge: `width = min(max(capsuleW, panelW), areaW)`, `height = min(capsuleH + gap + panelH, areaH)`, `x = capsuleX + (capsuleW - width) / 2`, `y = top ? capsuleY : capsuleY + capsuleH - height`. Then `Clamp`.
- `ParseEdge(raw)`: case-insensitive enum parse of `Left|Right|Top|Bottom`; null, blank, unknown or a numeric string that is not a defined member yields Right.
- `AppSettings.ResolveLiveCopilotPillAlong()`: clamp 0..1; null or non-finite -> 0.5.
- The "Meeting detected" popup uses `Clamp` for its top-right position.
- Work area: the pill uses the primary display's work area the first time it is shown, and afterwards the display nearest to its own rectangle (so a monitor change re-docks on the right screen). DPI is re-read from the window each time.

### 3.6 Start-handoff rules (`LiveCopilotRecordingHandoff`)

`Decide(was, is)` -> `(Minimize = !was && is, ShowHint = !was && is)`. `ShouldShowPill(isRecording, mainActive, handingOff) = isRecording && (!mainActive || handingOff)`. `StartedHintDuration = 2500 ms`.

### 3.7 Meeting popup policy

`MeetingPopupPolicy.ShouldShow(popupEnabled, captureActive, alreadyPrompted) = popupEnabled && !captureActive && !alreadyPrompted`. Production passes `alreadyPrompted: false` always; once-per-call is enforced by the watcher's armed flag.

### 3.8 Default meeting title

`AppStrings.MeetingTitle(when)` = `Format("MeetingTitleFormat", when.ToString(Get("MeetingTitleDateFormat"), CurrentCulture))`. English: format `Meeting {0}`, date `d MMM, HH:mm` (example "Meeting 2 Nov, 14:30"). Spanish: `Reunión {0}` with the same date pattern, culture-formatted (example "Reunión 2 nov, 14:30").

### 3.9 Settings access pattern

Every writer follows load, mutate, save (`AppSettingsService`). A single static `SemaphoreSlim` serializes each individual load and each individual save within the process, but not the load-mutate-save sequence, and does not coordinate across processes. Missing file returns a default `AppSettings`. JSON uses `JsonSerializerDefaults.Web` (camelCase, case-insensitive on read) and `WriteIndented = true`. Saving calls `EnsureDirectoriesExist()` first, which also best-effort deletes leftover Whisper caches (`%LOCALAPPDATA%\MeetingLive\WhisperModels`, `Models\ggml-base.bin`).

### 3.10 Provider-resolver contract used by the shell

`MainPage` supplies the chat view-model with three async delegates, each given the page's `XamlRoot` so they can open dialogs: `SummaryModelResolver.ResolveAsync(XamlRoot)`, `CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot)`, `XaiProviderResolver.EnsureAvailableAsync(XamlRoot)`. Their behavior belongs to the summary-provider spec.

---

## 4. Persistence and wire formats

### 4.1 Locations (`AppPaths`)

| Purpose | Path |
| --- | --- |
| App root (config, models, credentials, logs) | `%LOCALAPPDATA%\MeetingLive` |
| User data (visible to the user, follows OneDrive Documents) | `<Documents>\MeetingLive` |
| Inbox (unfiled meetings) | `<Documents>\MeetingLive\Inbox` (via `MeetingLibraryLayout.InboxDirectory`) |
| Library folders index | `<Documents>\MeetingLive\folders.json` |
| Legacy flat markdown | `<Documents>\MeetingLive\Meetings` |
| Legacy flat WAV | `<Documents>\MeetingLive\Recordings` |
| Settings | `%LOCALAPPDATA%\MeetingLive\settings.json` |
| Chat threads | `%LOCALAPPDATA%\MeetingLive\chat-threads.json` |
| User chat recipes | `%LOCALAPPDATA%\MeetingLive\chat-recipes.json` |
| Custom note template | `%LOCALAPPDATA%\MeetingLive\custom-note-template.json` |
| xAI credentials (DPAPI, current user) | `%LOCALAPPDATA%\MeetingLive\xai-credentials.bin` |
| TypeSafe credentials (DPAPI, current user) | `%LOCALAPPDATA%\MeetingLive\typesafe-credentials.bin` |
| Transcription models | `%LOCALAPPDATA%\MeetingLive\TranscriptionModels` |
| NeMo-Speech runtimes (`cpu\`, `cuda\`) | `%LOCALAPPDATA%\MeetingLive\NemoSpeech` |
| Summary models (GGUF) | `%LOCALAPPDATA%\MeetingLive\SummaryModels` |
| Legacy model cache | `%LOCALAPPDATA%\MeetingLive\Models` |
| Legacy meetings store | `%LOCALAPPDATA%\MeetingLive\meetings.json` (renamed `.bak`, `.bak.1`, ... after migration) |
| Legacy (pre-Documents) folders and files | `%LOCALAPPDATA%\MeetingLive\{Meetings,Recordings,folders.json}` |
| Crash log | `%LOCALAPPDATA%\MeetingLive\crash.log` |

`EnsureDirectoriesExist()` creates Inbox, TranscriptionModels, NemoSpeech and SummaryModels.

### 4.2 `settings.json`

Written with camelCase names, indented. Fields owned or touched by the shell are marked (S). Unknown keys on read are ignored (a test covers removed provider keys). Defaults apply for missing keys.

```json
{
  "selectedSummaryModelId": null,
  "selectedSummaryProvider": null,
  "selectedXaiModelId": null,
  "selectedXaiEffort": null,
  "selectedClaudeModelId": null,
  "selectedClaudeEffort": null,
  "selectedCodexModelId": null,
  "selectedCodexEffort": null,
  "transcriptionLanguage": null,
  "summaryLanguage": null,
  "selectedMicrophoneDeviceId": null,
  "recordMicrophoneKind": null,
  "recordMicrophoneDeviceId": null,
  "recordOutputKind": null,
  "recordAppExePath": null,
  "recordAppName": null,
  "liveTranscriptionEnabled": true,
  "speakerDiarizationEnabled": false,
  "typeSafeEnabled": true,
  "calendarNotificationsEnabled": true,
  "meetingPopupEnabled": true,
  "disabledCalendarIds": [],
  "uiLanguage": "es",
  "navigationPaneLength": 320.0,
  "liveCopilotPillX": null,
  "liveCopilotPillY": null,
  "liveCopilotPillEdge": "Right",
  "liveCopilotPillAlong": 0.5
}
```

Shell-relevant semantics:

| Field | Type, default | Meaning |
| --- | --- | --- |
| `uiLanguage` (S) | string or null; null = follow system | BCP-47 `en-US` or `es` |
| `navigationPaneLength` (S) | number or null; null = 280 | resolved with clamp 200..480 |
| `meetingPopupEnabled` (S) | bool, true | the floating popup; set false by "Don't notify me again" |
| `calendarNotificationsEnabled` (S) | bool, true | the one-minute toast |
| `disabledCalendarIds` (S) | string array, empty | calendars hidden from Coming up and reminders; compared ordinally; blank entries dropped |
| `liveCopilotPillEdge` (S) | `Left|Right|Top|Bottom` or null; null -> Right | dock edge |
| `liveCopilotPillAlong` (S) | number 0..1 or null; null -> 0.5 | fraction along the edge |
| `liveCopilotPillX`, `liveCopilotPillY` | int or null | legacy; no longer read, no longer written |
| `selectedSummaryProvider` | `Local|ClaudeCode|Codex|Xai` or null | null or unparseable -> Local |
| `transcriptionLanguage`, `summaryLanguage` | code or null | null -> `es` |
| Claude/Codex/xAI model and effort | string or null | null -> catalog defaults; effort default low |

All other fields belong to the settings and record modules. The port must keep the same names so existing files keep working.

### 4.3 `crash.log`

Append-only plain text, UTF-8. Two record shapes, each followed by a blank line:

```
2026-11-02T14:03:11.4821734-05:00
System.InvalidOperationException: message
   at ...stack...

2026-11-02T14:05:09.1200000-05:00 close failed
System.Runtime.InteropServices.COMException: ...
   at ...

```

First shape: XAML unhandled exception, header is `DateTimeOffset.Now` in round-trip ("o") format. Second shape: close-gate failure, header plus the literal text ` close failed`. The writer creates the directory, appends, and swallows every failure. No rotation, no size cap, no redaction, no structured fields.

### 4.4 Toast payload

App notification with: text 1 = trimmed subject, text 2 = `CalendarReminder_Body`, button "Take notes". Argument dictionary on both toast and button: `{ action: "open-calendar-event", eventId: "<percent-encoded event id>" }`. On invoke the `eventId` is percent-decoded once more before use.

### 4.5 Workspace navigation wire values

Strings `"Recording"`, `"History"`, `"Settings"`, `"Session"` for shell tags; `"Transcript"`, `"Summary"` for session tabs. `Frame.Navigate` parameter for Session is a nullable `Guid` (boxed) for the selected meeting.

### 4.6 String tables (shell-owned keys)

| Key | English | Spanish |
| --- | --- | --- |
| `AppTitleBar.Title` | Vozella | Vozella |
| `Nav_Record.Content` | Record | Grabar |
| `Nav_History.Content` | Library | Biblioteca |
| `Nav_Transcript.Content` (unused in shell nav) | Transcript | Transcripción |
| `Nav_Summary.Content` (unused in shell nav) | Summary | Resumen |
| `Nav_Settings` | Settings | Configuración |
| `Nav_ResizePane` | Resize navigation pane | Cambiar el tamaño del panel de navegación |
| `CallPrompt_Title` | A call is happening | Hay una llamada en curso |
| `CallPrompt_Body` | Take notes in Vozella so you don't miss it. | Toma notas en Vozella para no perder nada. |
| `CallPrompt_TakeNotes` | Take notes | Tomar notas |
| `MeetingPrompt_Title.Text` | Meeting detected | Reunión detectada |
| `MeetingPrompt_Subtitle.Text` | Take notes with Vozella | Toma notas con Vozella |
| `MeetingPrompt_Start.Content` | Start recording | Empezar a grabar |
| `MeetingPrompt_More.AutomationProperties.Name` and `.ToolTipService.ToolTip` | More options | Más opciones |
| `MeetingPrompt_Dismiss.Text` | Dismiss | Descartar |
| `MeetingPrompt_NeverAgain.Text` | Don't notify me again | No volver a avisarme |
| `SettingsLanguageRestart_Title` | Restart required | Reinicio necesario |
| `SettingsLanguageRestart_Content` | The language will apply once Vozella restarts. Restart now? | El idioma se aplicará al reiniciar Vozella. ¿Deseas reiniciar ahora? |
| `SettingsLanguageRestart_RestartNow` | Restart now | Reiniciar ahora |
| `SettingsLanguageRestart_Later` | Later | Más tarde |
| `Settings_LanguagePicker.Header` | App language | Idioma de la aplicación |
| `Settings_LanguagePicker.Description` | Changes the language of Vozella's own screens. Restart the app to finish switching. | Cambia el idioma de las pantallas propias de Vozella. Reinicia la aplicación para completar el cambio. |
| `Settings_LanguageEnglish` / `Settings_LanguageSpanish` | English / Español | English / Español |
| `CalendarReminder_Body` | This meeting is about to start. | Esta reunión está a punto de comenzar. |
| `MeetingTitleFormat` | Meeting {0} | Reunión {0} |
| `MeetingTitleDateFormat` | d MMM, HH:mm | d MMM, HH:mm |
| `MigrationFailed_Title` | Meeting history migration failed | Error al migrar el historial de reuniones |
| `MigrationFailed_Content` | Vozella could not migrate your existing meeting history to the new format. Your original data was left untouched. | Vozella no pudo migrar tu historial de reuniones existente al nuevo formato. Tus datos originales quedaron intactos. |
| `Dialog_OK` | OK | Aceptar |
| `AppClose_Recording_Title` | Stop recording before closing? | ¿Detener la grabación antes de cerrar? |
| `AppClose_Recording_Content` | Vozella is still recording. Stop and save keeps this take as a meeting, then closes or restarts the app. Any transcription or summary left unfinished can be run again from the meeting. | Vozella sigue grabando. Detener y guardar conserva esta toma como una reunión y luego cierra o reinicia la aplicación. La transcripción o el resumen que queden sin terminar se pueden volver a ejecutar desde la reunión. |
| `AppClose_Recording_StopAndSave` | Stop and save | Detener y guardar |
| `AppClose_Recording_Keep` | Keep recording | Seguir grabando |
| `AppClose_Saving_Title` | Saving your recording | Guardando la grabación |
| `AppClose_SaveFailed_Title` | The recording could not be saved | No se pudo guardar la grabación |
| `AppClose_SaveFailed_Content` | The meeting was not saved. Its audio file stays in your meetings folder. Keep the app open to see the error on the Record page. | La reunión no se guardó. Su archivo de audio permanece en la carpeta de reuniones. Mantén la aplicación abierta para ver el error en la página Grabar. |
| `AppClose_SaveFailed_CloseAnyway` | Close anyway | Cerrar de todos modos |
| `AppClose_SaveFailed_Stay` | Keep open | Mantener abierta |
| `LiveCopilot_Title` | Live copilot | Copiloto en vivo |
| `LiveCopilot_StartedMessage` | Recording started | Grabación iniciada |
| `LiveCopilot_Expand.*` | Expand live copilot | Expandir el copiloto en vivo |
| `LiveCopilot_Collapse.AutomationProperties.Name` | Collapse live copilot | Contraer el copiloto en vivo |
| `LiveCopilot_Collapse.ToolTipService.ToolTip` | Collapse | Contraer |

Chat dock keys (English; Spanish values live in the same resw and belong to the chat spec): `Chat_Bar.AutomationProperties.Name` Meeting chat; `Chat_Composer.PlaceholderText` Ask about your meetings; `Chat_Composer.AutomationProperties.Name` Message; `Chat_Send.AutomationProperties.Name` Send; `Chat_Send.ToolTipService.ToolTip` Send (Enter); `Chat_PersonalTasks.*` What do I need to do; `Chat_Recipes.*` Recipes; `Chat_History.*` Chat history; `Chat_New.*` New chat; `Chat_Transcript.AutomationProperties.Name` Chat messages; `Chat_Copy.*` Copy; `Chat_Error.Title` Could not answer; `Chat_Error.AutomationProperties.Name` Chat error; `Chat_SendFailed` Could not answer. {0}; `Chat_EmptyAnswer` The answer came back empty.; `Chat_CopyFailed` Could not copy. {0}; `Chat_UiMarshalFailed` Could not show the answer in the window.; `Chat_ScopeLive` Live; `Chat_ScopeMeeting` Meeting; `Chat_ScopeMeetingNamed` Meeting: {0}; `Chat_ScopeFolder` Folder; `Chat_ScopeFolderNamed` Folder: {0}; `Chat_ScopeAll` All meetings; `Chat_ScopeMismatch.Text` This chat is from another scope. Sending starts a new chat.; `Chat_RoleUser` You; `Chat_RoleAssistant` Assistant; `Chat_Thinking.Text` Thinking…; `Chat_Starters.AutomationProperties.Name` Suggested questions; `Chat_MeetingLinkMissing` That meeting no longer exists.; `Chat_Untitled` Untitled chat; `Chat_ThreadUpdated` Updated {0}; `Chat_HistoryEmpty.Text` No chats yet.; `Chat_NoRecipes.Text` No recipes for this scope.; `Chat_CreateRecipe.*`, `Chat_CreateRecipeTitle` New recipe; `Chat_CreateRecipePrimary` Save; `Chat_CreateRecipeCancel` Cancel; `Chat_RecipeName.Header/PlaceholderText` Name / Recipe name; `Chat_RecipePrompt.Header/PlaceholderText` Prompt / What should this recipe ask?; `Chat_RecipeAvailability.Header` Available for; `Chat_RecipeSingle` This meeting; `Chat_RecipeMultiple` Multiple meetings; `Chat_DeleteRecipe.*` Delete recipe; `Chat_DeleteRecipeTitle` Delete recipe?; `Chat_DeleteRecipeContent` Delete "{0}"? Built-in recipes stay.; `Chat_DeleteRecipePrimary` Delete; `Chat_DeleteRecipeCancel` Cancel; `Chat_DeleteThread.*` Delete chat; `Chat_DeleteThreadTitle` Delete chat?; `Chat_DeleteThreadContent` Delete "{0}"? This cannot be undone.; `Chat_DeleteThreadPrimary` Delete; `Chat_DeleteThreadCancel` Cancel.

Resource rules: key lookup returns an empty string for a missing key (no exception, no log). The English file is the default language. UI strings must not be hard-coded; the only hard-coded user-visible strings in the shell are the window title `Vozella` and the English-only debug logs.

### 4.7 Manifests and package identity

`Package.appxmanifest`:

- Identity name `68A4C6A1-6F51-4AFA-85FA-C8840003F1D7`, publisher `CN=AppPublisher` (placeholder), version `1.0.0.0`. Phone product id equals the identity name.
- Display name and tile description `Vozella`; publisher display name `AppPublisher`; store logo `Assets\StoreLogo.png`.
- Target device family: Windows.Universal and Windows.Desktop, min `10.0.17763.0`, max tested `10.0.26226.0`. `Resource Language="x-generate"` (languages come from the resw folders).
- Application id `App`, executable token, `runFullTrust`. Visual elements: transparent background; 150x150 and 44x44 logos; wide 310x150 default tile; splash `Assets\SplashScreen.png`.
- Capabilities: `runFullTrust` (restricted), `appointmentsSystem` (restricted; needed to read all calendars), `systemAIModels` (Windows AI models).

`app.manifest`: assembly identity `MeetingLive.App.app` 1.0.0.0; `supportedOS` Windows 10 GUID `{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}` (required for the custom title bar in unpackaged runs); `dpiAwareness` `PerMonitorV2`.

`MeetingLive.App.csproj`: .NET 10, `net10.0-windows10.0.26100.0`, min platform `10.0.17763.0`, platforms x86/x64/ARM64 (never AnyCPU; building the solution file fails with MSB4126), Windows App SDK 2.4.0, CommunityToolkit.Mvvm 8.4.2, CommunityToolkit.WinUI.UI.Controls.Markdown 7.1.2 (chat Markdown), CommunityToolkit.WinUI.Controls.SettingsControls 8.2.251219. Release builds use ReadyToRun and trimming. LangVersion pinned to 12 in `Directory.Build.props`. Launch profiles: `MeetingLive.App (Package)` (MSIX) and `MeetingLive.App (Unpackaged)`.

### 4.8 Brand assets and generation (`scripts/make_icons.py`)

The mark is five flat vertical bars hanging from one top line; lengths trace a V and a sound level. 24-unit grid; bar width 2, gap 1, left 5, top 6, lengths in order 3, 8, 13, 8, 3 (units): bars at x = 5, 8, 11, 14, 17, y = 6, heights 3, 8, 13, 8, 3. Colors: ink `#0a0a0a`, paper `#ffffff`. Tile corner radius = 0.225 of the side (5.4 on the 24-unit SVG). Hinted whole-pixel grids: 16 px (units 16, bar 1, gap 1, left 3, top 4, lengths 2, 5, 9) and 32 px (units 32, bar 2, gap 2, left 7, top 7, lengths 4, 11, 18). All other sizes use the master grid. Rendering: 8x supersampling, rectangle fills with rounded coordinates, box-filter downscale (Lanczos adds a halo on thin bars). Requires Pillow; the app does not.

Outputs: `Square150x150Logo.scale-200.png` (300 px), `Square44x44Logo.scale-200.png` (88), `Square44x44Logo.targetsize-24_altform-unplated.png` (24), `Square44x44Logo.targetsize-48_altform-lightunplated.png` (48), `StoreLogo.png` (50), all as ink tile with paper mark; `LockScreenLogo.scale-200.png` (48, paper mark only, no tile, because Windows tints it); `Wide310x150Logo.scale-200.png` (620 x 300, 200 px tile centered on transparent); `SplashScreen.scale-200.png` (1240 x 600, 300 px tile centered); `AppIcon.ico` (frames 16, 24, 32, 48, 64, 256, ink tile). SVGs in `docs/brand/`: `vozella-tile-dark.svg` (ink tile, paper bars), `vozella-tile-light.svg` (paper tile, ink bars), `vozella-mark-ink.svg`, `vozella-mark-paper.svg` (bars only). The website favicon is the dark tile inlined as an SVG data URI.

### 4.9 Design tokens (from `website/index.html`, to be reused as the design system)

Light theme (default) and dark theme (`prefers-color-scheme: dark`, or `data-theme="dark"`):

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#ffffff` | `#0a0a0a` | page and window background |
| `--paper-raised` | `#f5f5f5` | `#171717` | cards, nav rail, raised surfaces |
| `--ink` | `#0a0a0a` | `#ffffff` | primary text, primary button fill, selected nav item |
| `--on-ink` | `#ffffff` | `#0a0a0a` | text on ink |
| `--ink-muted` | `#525252` | `#a3a3a3` | secondary text |
| `--ink-faint` | `#6e6e6e` | `#8a8a8a` | tertiary text, captions |
| `--on-ink-muted` | `#a3a3a3` | `#525252` | secondary text on ink surfaces |
| `--border-control` | `#8a8a8a` | `#6b6b6b` | input and control borders |
| `--hairline` | `#e5e5e5` | `#262626` | dividers, card borders |
| `--hairline-on-ink` | `#333333` | `#d4d4d4` | dividers on ink surfaces |
| `--signal` | `#d92d20` | `#ff5a4f` | live and recording state (the only chromatic color) |

Type: sans `"Schibsted Grotesk", "Segoe UI Variable", system-ui, sans-serif` (weights 400, 500, 600); mono `"IBM Plex Mono", Consolas, monospace` (400, 500; tabular numerals on timestamps). Body 16/24, weight 400. Button 14/20 weight 500. Mono label 13/20. Lead 20/30. Panel heading 20/28 weight 600, tracking -0.01em. Section heading `clamp(32px, 4.4vw, 56px)/1.04`, weight 600, tracking -0.03em. Hero `clamp(56px, 11.4vw, 164px)/.92`, tracking -0.05em. Wordmark 20 px weight 600. Geometry: 4 px corner radius on buttons, cards, inputs, checkboxes; 50 percent on the status dot (8 px); tile radius 22.5 percent. Borders: 1 px hairline for dividers, 1 px control border for inputs and the product window frame, 1 px ink for section rules. Spacing: 8 px base (4, 8, 12, 16, 24, 32). Touch targets: buttons min height 44 (compact 32 to 36), language toggles 40. Focus: `outline: 2px solid var(--ink); outline-offset: 2px` (on ink surfaces the outline is `--on-ink`). Motion: opacity transitions 160 ms (buttons), 320 ms (panel swap), 420 ms (list line fade); `prefers-reduced-motion: reduce` removes all transitions and smooth scrolling. Tone: monochrome, no gradients, no shadows, one accent (`--signal`) reserved for live state.

The WinUI app has not yet adopted these tokens: it uses Fluent system brushes plus the folder-accent and Claude brand brushes below. The port should treat the table above as the single palette and map each Fluent resource used by the shell to a token:

| Fluent resource used in shell XAML | Port token |
| --- | --- |
| `CardBackgroundFillColorDefaultBrush` | `--paper-raised` |
| `CardBackgroundFillColorSecondaryBrush`, `SubtleFillColorSecondaryBrush` | `--paper-raised` (hover or secondary fill) |
| `CardStrokeColorDefaultBrush`, `SurfaceStrokeColorDefaultBrush`, `ControlStrokeColorDefaultBrush` | `--hairline` (cards) or `--border-control` (inputs) |
| `TextFillColorPrimaryBrush` | `--ink` |
| `TextFillColorSecondaryBrush` | `--ink-muted` |
| `AccentFillColorDefaultBrush`, `TextOnAccentFillColorPrimary*` | `--ink` and `--on-ink` (accent button is an ink button) |
| `SystemFillColorCriticalBrush`, live copilot stop color (`#C42B1C` light, `#E5484D` dark) | `--signal` |
| `SolidBackgroundFillColorBaseAltBrush` (popup, pill) | `--paper` in dark theme (popup and pill stay dark) |

Folder accent colors (`App.xaml:14-44`), per theme (Light / Dark): Blue `#2563EB` / `#60A5FA`; Teal `#0F766E` / `#2DD4BF`; Green `#15803D` / `#4ADE80`; Amber `#B45309` / `#FBBF24`; Orange `#C2410C` / `#FB923C`; Red `#B91C1C` / `#F87171`; Purple `#6D28D9` / `#A78BFA`; Neutral `#64748B` / `#94A3B8`. High contrast: all accents use the system highlight color except Neutral (window text). `ClaudeBrandBrush` is `#D97757` in light and dark, system window-text in high contrast. Live copilot stop button: `#C42B1C` on light, `#E5484D` on dark, white label; high contrast uses system highlight and highlight-text.

---

## 5. Native and OS dependencies

| Dependency | Used for | Windows-only or portable | Port note |
| --- | --- | --- | --- |
| WinUI 3 / Windows App SDK 2.4 windowing (`AppWindow`, `OverlappedPresenter`, `DisplayArea`) | main window, popup, pill, min size, minimize/restore, work area, always on top, hide from switchers | Windows-only API; concept portable | Electron `BrowserWindow` options: `alwaysOnTop`, `skipTaskbar`, `focusable:false`, `showInactive()`, `minWidth/minHeight`, `screen.getDisplayNearestPoint().workArea`. macOS panel windows need `type: 'panel'` and level tuning. |
| Mica backdrop, custom `TitleBar` | window look | Windows 11 only | Electron: `backgroundMaterial: 'mica'` (Windows 11), `titleBarOverlay`; macOS vibrancy. |
| DWM attributes (`DwmSetWindowAttribute`: corner preference 33, border color 34) | rounded popup corners, no pill border | Windows-only | Electron: `roundedCorners` and transparent frameless windows. |
| `user32`: `GetDpiForWindow`, `EnumWindows`, `GetWindowText*`, `GetWindowThreadProcessId`, `IsWindowVisible`, `GetCursorPos`, `GetWindowLong/SetWindowLong`, `SetWindowPos`, `GetClientRect`, `SetWindowRgn`; `gdi32`: `CreateRoundRectRgn`, `DeleteObject` | DPI, window enumeration for call detection, pill drag and shaping | Windows-only | Call detection needs a native addon or helper per OS (macOS: CGWindowList or accessibility, with screen-recording permission for titles). Pill shape: transparent window plus CSS radius; no HRGN needed. Cursor: `screen.getCursorScreenPoint()`. |
| `System.Diagnostics.Process` | process name for detection | Portable (.NET); process names differ per OS | Process names per OS must be re-mapped (Zoom `zoom.us` on macOS, Teams `MSTeams`). |
| Windows App SDK app notifications (`AppNotificationManager`, `AppNotificationBuilder`) | calendar toast with an action button and activation arguments | Windows-only | Electron `Notification` with actions (Windows requires an AppUserModelID and, for action buttons, toast XML or the `notification` activator); macOS `UNUserNotificationCenter`. |
| `AppInstance.Restart` | restart after UI-language change | Windows-only | Electron `app.relaunch()` then `app.exit()`. |
| `Windows.Globalization.ApplicationLanguages`, `.resw` resource loader | UI language | Windows-only | Replace with an i18n library (resource files keyed as above) and `app.getLocale()` for the system default. |
| `Windows.ApplicationModel.Appointments` (`AppointmentManager`), capability `appointmentsSystem`, requires package identity | calendar source for reminders | Windows-only, needs MSIX identity | An unpackaged Electron app has no identity, so this store returns `NoPackageIdentity`. See the calendar spec: use Graph or ICS, or a packaged-with-identity helper. |
| `UISettings.AnimationsEnabled` | skip animations | Windows-only | Electron: CSS `prefers-reduced-motion` and `systemPreferences.getAnimationSettings()`. |
| `Launcher.LaunchUriAsync` | open http/https links from chat | Windows-only API | Electron `shell.openExternal` after the same scheme check. |
| DPAPI (`FileDpapiXaiCredentialStore`, `FileDpapiTypeSafeCredentialStore`) | credential files | Windows-only | Electron `safeStorage`; define a migration for existing `.bin` blobs (data module). |
| `Microsoft.Windows.SDK.BuildTools.WinApp`, MSIX tooling | packaging | Windows-only | Replaced by the packaging spec (electron-builder or similar). |
| `System.Text.Json`, file IO, `Documents` and `LocalAppData` | persistence | Portable concept | Map to `app.getPath('documents')` and `app.getPath('appData')` equivalents; keep the on-disk names and layouts of section 4. |
| Static `SemaphoreSlim` settings lock | in-process settings serialization | Portable | Use a main-process write queue and atomic replace. |

---

## 6. Existing test coverage (`MeetingLive.Core.Tests`)

There is no test project for `MeetingLive.App`. Everything in `App` (window, navigation, dialogs, watchers' timers, popup, pill, AppServices) is untested. Core tests that cover shell rules, with the cases that must carry over:

- `Models/AppSettingsTests`: resolve transcription language unset -> `es`, set -> pinned code; summary language unset -> `es`, `en`; `ResolveNavigationPaneLength` unset -> default 280, clamps to 200..480; defaults when JSON omits fields (diarization false, TypeSafe true, calendar notifications true, popup true, disabled calendar ids empty); round trips for the three booleans set false; `DisabledCalendarIds` round trip and blank dropping; deserialize ignores removed provider keys; legacy pill X/Y null by default and round trip including negative coordinates; pill dock defaults null and resolves to right, centered; `ResolveLiveCopilotPillAlong` clamps out-of-range; `ResolveLiveCopilotPillEdge` falls back to right when unrecognized.
- `Services/AppPathsTests`: inbox, meetings, recordings and folders paths are under My Documents; settings and xAI credential paths are under LocalAppData.
- `Services/CalendarReminderTests`: notify window boundaries (inside at 90 s and 60 s; outside before 90 s or at start); a 15 s poll cannot miss the one-minute mark; `IncludesCurrentUser` false when organized by the user even if a name matched, follows the match otherwise; `CountPeople` (one other person = two; organizer not double counted; list already including owner not re-added; blank names not counted); `ShouldNotify` positive (one other person, in window), negatives (owner alone, no other person, blocked by event filter, free block without meeting signal, already notified, after start); `ForgetStarted` drops after start and keeps before.
- `Services/MeetingCallDetectorTests`: process/title matrix (`CptHost` any title true; `zoom` + "Zoom Meeting" true; `Zoom` + "Zoom Workplace" false; `ms-teams` + "Standup | Meeting" true; `Teams` + "Chat | Microsoft Teams" false; `msedge` + "Inbox - Gmail" false; `notepad` + "Zoom Meeting" false); browsers with a Meet code (`chrome`, `msedge` with en dash, `firefox` upper-case, `brave`, `opera`, `vivaldi`) true; landing and non-call tabs false (Meet landing, plain "Meet", Google Meet marketing title, "Standup - Google Meet", Zoom room in Edge, Teams home in Chrome, code without "Meet", malformed code `abcd-efg-hij`).
- `Services/MeetingPopupPolicyTests`: show when enabled, idle, not prompted; hidden when setting off, while recording, or already prompted.
- `Services/MeetingPromptPlacementTests`: top-right with margin; non-zero origin; margin that does not fit still stays inside.
- `Services/LiveCopilotRecordingHandoffTests`: decide minimizes and hints only on false-to-true; no handoff when already recording, stopping, or idle; `ShouldShowPill` on handoff while main active is true, recording and main active false, recording and main inactive true, not recording false; hint duration 2.5 s.
- `Services/LiveCopilotPillDockTests` (24 cases): vertical only for left/right; default right centered; nearest edge (closest, screen center snaps to an edge, tie order right > left > bottom, non-zero origin); `PositionFor` (right, left, top, bottom, non-zero origin, out-of-range along, capsule larger than edge); `AlongFor` (vertical and horizontal round trip, clamped past ends, no travel returns default); `ExpandedBounds` (right, left, top, bottom, near the end shifted inside, panel larger than area shrinks); `ParseEdge` fallback.
- `Services/LiveCopilotPillPlacementTests`: clamp inside, outside, non-zero origin, window larger than area, window exactly filling the area.
- `Services/UiLanguageResolverTests`: culture for `en-US`, `es`; null for blank and unknown tags; primary-subtag matching both directions, case-insensitive, null/blank candidate, no match.
- `Services/UserDataLocationMigrationServiceTests`: moves meetings, recordings and folders and rewrites the audio path; does not overwrite an existing destination; idempotent; `RewriteAudioFilePathLine` rewrites a legacy path and leaves an already-new path.
- `Services/MeetingLibraryLayoutMigrationServiceTests`: moves GUID files into the Inbox with a title and sidecar WAV.
- `Services/MeetingsMigrationServiceTests`: missing legacy file does nothing; first run saves all and renames to `.bak`; rerun after partial failure keeps later edits and migrates the missing ones; existing `.bak` kept and a new one written; several backups use the next free name.
- `Services/RecordingSessionGateTests` (close-gate input): `RequiresCloseConfirmation` only while a take is being captured, plus the phase transition cases that decide `HasPendingSaves`.
- `Strings/CoreStringsTests`: English and Spanish lookup under the matching culture.

Not covered anywhere (a port must add tests): `WorkspaceService` (tag validation, take-notes handshake, scope events, delete notifications), `AppSettingsService` (concurrency, corrupt file, missing directory), `LoadSettingsSnapshot` (case handling), `MeetingWindowScanner`, watcher state machines (`MeetingCallWatcher` arm/disarm and retry; `CalendarReminderWatcher` dedupe and capture suppression), close gate and `SaveAndFinishForCloseAsync`, resource key parity between English and Spanish, pane width persistence, toast activation parsing, `AppDialogFactory`.

---

## 7. Bugs, races, and uncovered cases

Evidence is `file:line`. "Confirmed" means demonstrated from code (one item also reproduced in a scratch run, noted). "Suspected" means plausible from code but not demonstrated.

### 7.1 Confirmed

1. **Claude, Codex and xAI model and effort selections are ignored by provider factories.** `AppServices.LoadSettingsSnapshot` deserializes `settings.json` with default `JsonSerializer` options (`AppServices.cs:194`), which are case-sensitive, while `AppSettingsService` writes camelCase with `JsonSerializerDefaults.Web` (`AppSettingsService.cs:9`) and `AppSettings` has no `JsonPropertyName` attributes. The properties never bind, so every `Resolve*` call returns the catalog default. Reproduced with a scratch class: `{"selectedClaudeModelId":"opus"}` deserialized with default options yields null. Affects `CreateClaudeSummary`, `CreateCodexSummary`, both polishers, `ResolveXaiModelId`, `ResolveXaiEffort` (`AppServices.cs:141-182`). The Settings UI shows the user's pick, but the CLI is invoked with defaults. The fix is to use the same options as the service (or call a shared deserializer).
2. **A corrupt or truncated `settings.json` crashes the app on every launch.** `MainPage.Loaded` awaits `Settings.LoadAsync()` outside its `try` (`MainPage.xaml.cs:86`) inside an async-void lambda; `PaneGrip_PointerReleased` does the same (`MainPage.xaml.cs:467`). A `JsonException` escapes to the XAML unhandled-exception handler, which logs and lets the process die (`App.xaml.cs:75-88`). Only `ApplyPersistedUiLanguageAsync` (`App.xaml.cs:415-421`) and a few watchers guard the read.
3. **Settings writes are not atomic.** `SaveAsync` opens the target with `File.Create` (truncate in place) and serializes into it (`AppSettingsService.cs:40-41`). A crash, power loss or kill during the write leaves an empty or partial file, which triggers bug 2 on the next start.
4. **Lost-update race on `settings.json`.** The semaphore guards each load and each save separately, not the sequence (`AppSettingsService.cs:14,18,36`). Writers do load, mutate, save from independent code paths: pane resize (`MainPage.xaml.cs:467-469`), pill position (`LiveCopilotWindow.xaml.cs:343-353`), popup opt-out (`MeetingPromptWindow.xaml.cs:232-248`), settings sections. Two overlapping sequences make the later save overwrite the earlier field with a stale value. The lock is also in-process only, so a second process (no single-instance guard, see 7.3) can clobber it too.
5. **The call prompt bar never closes by itself.** `MainPage` only ever sets `CallPromptBar.IsOpen = true` (`MainPage.xaml.cs:51`); `MeetingEnded` and the recording-start handoff dismiss the floating popup only (`App.xaml.cs:327,355-357`). After the call ends or recording starts, the bar stays until the user closes it.
6. **Global exception handling is thin.** Only the XAML `UnhandledException` is hooked; it appends to `crash.log` and never sets `e.Handled`, so the app terminates with no user-facing message (`App.xaml.cs:71,75-88`). No `AppDomain.UnhandledException` or `TaskScheduler.UnobservedTaskException` handler exists (searched), so faults in fire-and-forget work (`_ = TickAsync()` at `MeetingCallWatcher.cs:28`, `_ = PollAsync()` at `CalendarReminderWatcher.cs:27,53`, `_ = _liveCopilotPill.SetVisibleAsync` at `App.xaml.cs:399`) leave no trace. `crash.log` grows without bound and has no rotation.
7. **Startup migrations share one `try` and run on the UI thread before the window is shown.** If the first migration throws, the other two are skipped for that launch (`App.xaml.cs:104-112`). All three run before `Window.Activate()` (`App.xaml.cs:115`), so a large library delays the first paint; `UserDataLocationMigrationService.MigrateIfNeeded` is fully synchronous file IO. The failure dialog also drops the exception message because the English and Spanish strings contain no `{0}` while the code passes `ex.Message` as an argument (`App.xaml.cs:444-452`).
8. **The close gate does not protect phase `Preparing`.** `HasWorkToProtect` is `Recording` or `Stopping`/in-flight runs (`App.xaml.cs:166-167`, `RecordingPageViewModel.PipelineRun.cs:33-36`, `RecordingSessionGate.cs:39`). While a start or import is underway (`Preparing`) a close proceeds immediately and can abandon the new WAV or the import. Consequence is suspected (depends on how long `Preparing` lasts); the gap is confirmed.
9. **The toast click path does not restore a minimized window.** `OnNotificationInvoked` calls `App.Window.Activate()` only (`CalendarReminderWatcher.cs:161`), while `MeetingPromptWindow.Start_Click` restores a minimized presenter first (`MeetingPromptWindow.xaml.cs:223-226`) and `App.BringMainWindowToFront` does the same (`App.xaml.cs:287-293`). The inconsistency is confirmed; whether `Activate()` alone restores a minimized window was not verified.

### 7.2 Suspected

10. **UI-thread stalls from call detection.** The scanner runs synchronously on the UI thread every 5 s (`MeetingCallWatcher.cs:43`), calling `Process.GetProcessById` for every visible titled window (`MeetingWindowScanner.cs:31`). Machines with hundreds of windows may hitch periodically.
11. **Teams false positives.** Any `teams`/`ms-teams` window whose title contains "Meeting" or "Call" matches (`MeetingCallDetector.cs:28-29`), for example a chat or channel named "Weekly meeting". The popup and the bar would fire with no call. Zoom's `cpthost` returns true regardless of title (`MeetingCallDetector.cs:22`). Webex, Slack huddles, Discord and similar are never detected.
12. **Cold-start toast activation.** `OnLaunched` ignores its arguments (`App.xaml.cs:94`) and nothing reads the app-lifecycle activation kind. A toast clicked after the app has exited either launches the app without opening the event or depends on `NotificationInvoked` firing for a cold start; neither is verified. Reminders only fire while the process runs, and closing the window ends the process (no tray).
13. **Minimum size uses the DPI of the monitor where the window was first created** (`MainWindow.xaml.cs:32-45`). Moving to a monitor with a different scale leaves the minimum wrong.
14. **`AppWindow.SetIcon("Assets/AppIcon.ico")` uses a relative path** (`MainWindow.xaml.cs:29`); in an unpackaged run it resolves against the working directory.
15. **Navigation requests can be silently dropped.** `OnWorkspaceNavigationRequested` returns when `_isNavigating` is already set (`MainPage.xaml.cs:485-486`), including a legitimate request raised from inside a page's `OnNavigatedTo`.
16. **Pane width applies late.** The saved width is applied only after `Chat.InitializeAsync()` completes (`MainPage.xaml.cs:66-87`), so a slow chat initialization leaves the default pane width on screen first.
17. **A missing resource key returns an empty string with no log** (`AppStrings.cs:12`; `ResourceLoader.GetString` returns empty for unknown names). There is no parity test between the English and Spanish files, so a missing translation shows a blank label.
18. **The popup is unreachable by keyboard or screen reader.** It is shown without activation and has no global shortcut (`MeetingPromptWindow.xaml.cs:101`); a user who navigates by keyboard can only use the top InfoBar.
19. **One-frame flash on popup show.** `Present()` shows the window with the card at opacity 1 and only then starts an entrance that begins at opacity 0 (`MeetingPromptWindow.xaml.cs:97-111`).
20. **`AppNotificationManager.Unregister()` is never called** on exit (`CalendarReminderWatcher.cs:55-67`).
21. **`AppServices` static initialization is a single point of failure.** One throwing constructor (native engine, appointment store, credential stores) raises `TypeInitializationException` during the first settings load, before the window exists, in an async-void `OnLaunched`. The failure surfaces only through the unhandled-exception path.
22. **Stale comment.** `MainPage.xaml.cs:41-43` says the app is English-only; Spanish is a supported UI language. The explicit Settings label override is still correct.
23. **Mismatch in the chat send hint.** The send tooltip says "Send (Enter)" while Ctrl+Enter also works and Shift+Enter inserts a newline.

### 7.3 Uncovered cases (confirmed absences)

- No single-instance enforcement (only `AppInstance.Restart` is used; no key registration, no mutex). A second launch opens a second process with its own window, watchers (duplicate toasts) and settings writes.
- No tray icon or background mode. Closing the window ends call detection and reminders.
- No window size, position, maximized or monitor persistence; every launch is 1180 x 760 DIP at the OS-chosen position.
- No theme setting and no high-contrast verification for the popup and pill (always dark).
- No logging framework: only `Debug.WriteLine` (seven call sites, debugger-only) and `crash.log`.
- No update mechanism, no telemetry, no crash reporter upload.
- No keyboard resize for the pane grip; no keyboard access to the popup.
- Settings language picker shows English if the OS language is neither English nor Spanish; no further languages.

---

## 8. Parity checklist

Tick each line in the port. Numbering is stable; add new items at the end.

Startup and lifecycle
1. XAML-equivalent unhandled-exception hook is registered before any UI is created.
2. Startup order is: restore UI language, create window and shell, capture dispatcher, run migrations, show window, subscribe events, start watchers, show migration error if any.
3. UI language restore loads settings, ignores load errors, and does nothing when `uiLanguage` is blank.
4. A non-blank `uiLanguage` is re-applied to the resource system on every launch.
5. A resolvable language also sets the process culture and the default for new threads; an unknown tag leaves the culture alone.
6. Migration 1 moves legacy meetings, recordings and `folders.json` into Documents without overwriting, rewrites `audioFilePath:` lines, and removes empty legacy directories.
7. Migration 2 files leftover `Documents\MeetingLive\Meetings\*.md` into the Inbox layout, repairing audio paths from `<guid>.wav`, skipping unparseable files.
8. Migration 3 imports `meetings.json` records not already present, then renames it to the next free `.bak`, `.bak.1`, ... and never deletes it.
9. A migration failure is shown in a single-button error dialog after the window is visible, with the original data untouched.
10. Launch arguments are accepted without error (none are acted on) or, if added, are documented as a deliberate extension.
11. The process exits when the main window closes; the popup and pill are closed with it.
12. On close the call watcher and calendar watcher are disposed, window event handlers are unsubscribed.

Main window
13. Window title is "Vozella"; window icon is the Vozella app icon.
14. Custom title bar with the icon and the text "Vozella"; content extends into the title bar.
15. Window material is Mica (or the closest per-OS equivalent).
16. Initial size is 1180 x 760 DIP scaled by display scale.
17. Minimum size is 960 x 680 DIP scaled by display scale.
18. The window is created once and the shell page is shown inside it.
19. High-DPI per-monitor scaling is enabled.

Navigation shell
20. Left rail contains Record and Library, plus Settings as the built-in bottom item.
21. Rail labels are localized; the Settings label is forced to the app's own language, not the OS language.
22. Automation ids exist: `NavItemRecording`, `NavItemHistory`, `NavItemSettings`, `SizerNavigationPane`.
23. First load selects Record.
24. Selecting a rail item navigates the content frame to its page and publishes the shell tag to the workspace.
25. Navigating to the page already shown is a no-op, except Session, which always re-navigates with the selected meeting id.
26. Session is not on the rail; the rail stays on Library while Session shows.
27. Re-clicking Library while Session shows returns to the library list.
28. Programmatic navigation requests sync the rail selection and then the frame, with a re-entrancy guard.
29. Rail display mode adapts to window width (expanded, compact, minimal).
30. Pane open width defaults to 280 DIP, with a minimum of 200 and a maximum of 480.
31. The saved pane width is restored on startup and clamped.
32. A drag handle on the pane's right edge resizes the pane live, with a west-east resize cursor, and is visible only when the rail is expanded and open.
33. The new pane width is persisted on drag end (also on pointer-capture loss), not during the drag.
34. The handle has a localized tooltip and accessible name "Resize navigation pane".

Call prompt bar
35. An informational, closable bar at the top of the shell shows "A call is happening" / "Take notes in Vozella so you don't miss it." with a "Take notes" button.
36. "Take notes" closes the bar, flags a pending take-notes request, and navigates to Record.
37. The bar is offered once per call, only when capture is not active, regardless of the popup setting.
38. (Improvement, optional) The bar closes when the call ends or recording starts.

Call detection
39. Detection polls every 5 s and never overlaps a running tick.
40. Detection state machine: armed -> (call found, not capturing) disarm, offer bar, maybe show popup; disarmed -> re-arm and signal "ended" when no meeting window remains.
41. If capture is already active when a call is found, the watcher disarms and stays silent for that call, even if capture stops mid-call.
42. A failure before the popup is handled re-arms so the next tick retries; no failure crashes the app.
43. Window scan skips invisible windows, empty titles, and process id 0; resolves the process name; tolerates exited processes.
44. Detection rules: `cpthost` always; `zoom` + "Zoom Meeting"/"Zoom Webinar"; `teams`/`ms-teams` + "Meeting"/"Call"; six browsers + Meet code regex + "Meet".
45. Process names are trimmed and lowercased; titles compared case-insensitively.
46. The Meet code regex is `\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b`, ignore-case, invariant.
47. Each existing detector test case passes unchanged (section 6).

"Meeting detected" popup
48. Shown only when the setting is on and capture is not active.
49. Size 480 x 72 DIP, top-right of the primary work area, 24 DIP inset, clamped inside the work area.
50. Always on top, no border or title bar, not resizable, not minimizable, not in the taskbar or Alt+Tab, not focus-stealing.
51. Rounded corners; always dark theme.
52. Content: app icon tile, "Meeting detected", "Take notes with Vozella", split button "Start recording" + overflow.
53. Overflow menu has "Dismiss" and "Don't notify me again".
54. Auto-hides after 30 s; hover stops the timer; leaving restarts it; each show restarts it.
55. Hover lightens the card (150 ms fade).
56. Entrance 280 ms ease-out fade and 24 DIP slide; exit 150 ms ease-in fade; both skipped when OS animations are off.
57. Showing resets any stale animation state; a cancelled exit never hides a freshly shown popup.
58. A second dismiss during a fade-out is ignored; dismissing a hidden popup only stops the timer.
59. "Start recording" dismisses immediately, restores and activates the main window, and requests take-notes.
60. "Don't notify me again" dismisses, then sets the popup setting off and saves; failures are silent; a no-op if already off.
61. The popup is created lazily, reused across meetings, and recreated if it was closed.
62. The popup is dismissed when the call windows disappear and when recording starts.
63. The popup has the listed automation ids.

Calendar reminder
64. Polls every 15 s, plus once immediately at start.
65. Skipped while capture is active and when reminders are off; the setting is re-checked after the store call.
66. Disabled calendar ids are passed to the store; `AccessDenied` and `NoPackageIdentity` end the poll quietly.
67. Notify window is `[start - 90 s, start)`.
68. Requires a non-blank event id, not already notified, visible per the event filter, and at least two people.
69. People count: non-blank attendee names, plus the owner when they organized the event or are not listed.
70. Notified ids are remembered with their start time and forgotten once the start has passed.
71. Toast: subject (trimmed) as title, "This meeting is about to start." as body, "Take notes" button; skipped for a blank subject or when notifications are unavailable.
72. Toast arguments carry `action=open-calendar-event` and a percent-encoded `eventId`.
73. Clicking the toast activates the main window and requests take-notes with that event id.
74. (Improvement, optional) Clicking restores a minimized window.
75. Errors never surface as toasts or crashes; registration "already registered" is tolerated.

Recording handoff and pill
76. On the false-to-true transition of recording the main window minimizes and the "started" hint plays; no other transition does either.
77. Recording start dismisses the popup.
78. After minimizing, the main window is treated as inactive immediately.
79. The pill is visible while recording and the main window is not active, or during the handoff.
80. The pill is created lazily and re-created if closed; it never takes focus.
81. When recording stops the pill hides, folds its panel, and saves its position first.
82. The pill docks to one of four edges (default right, centered), vertical on left and right, horizontal on top and bottom.
83. Pill sizes, margins and panel size follow section 2.8 and 3.1.
84. A drag starts after 4 DIP of movement, snaps to the nearest edge on release, with deterministic tie-breaking.
85. The dock edge and the 0..1 fraction are saved 500 ms after a change and on hide, and are read back clamped with fallbacks.
86. The pill re-docks on the display it is on, re-reading DPI and work area on every show.
87. Entrance and exit animations match the timings; the started hint shows "Recording started" for 2.5 s and pulses once; both skip when animations are off.
88. Grabbing the capsule folds an open panel; the panel opens toward the screen center and is shifted inside the work area.
89. Closing the main window closes the pill.

Close, exit and restart gate
90. Closing with no recording and no pending save proceeds immediately.
91. Closing while recording asks "Stop recording before closing?" with "Stop and save" (default) and "Keep recording".
92. The main window is restored and activated before any close dialog is shown.
93. Choosing "Stop and save" shows a "Saving your recording" progress dialog that cannot be dismissed until the save ends.
94. The save stops capture, waits for every first save, cancels remaining runs, waits up to 30 s for them to end, and succeeds only if every take was saved.
95. A failed save offers "Close anyway" or "Keep open" (default Keep open); no path discards a take.
96. A second close or restart request while one is deciding is refused.
97. An exception in the gate is logged to `crash.log` as `<timestamp> close failed` and leaves the app open.
98. A dialog collision (another dialog open) keeps the app open or skips the progress dialog without blocking the save.
99. The gate is shared by window close and by language-change restart.
100. A closing request approved once does not re-ask when the window closes itself.
101. (Improvement, optional) The gate also covers the Preparing phase.

UI language
102. Settings picker offers English (`en-US`) and Español (`es`), labelled in their own language.
103. With no saved choice, the picker preselects the language the app actually resolves, matched by primary subtag.
104. Changing the language updates the live override, persists `uiLanguage`, and offers a restart prompt only when the value changed.
105. "Restart now" passes the exit gate, then relaunches; "Later" or a refused gate leaves the app running.
106. A failed relaunch leaves the app running.
107. All shell strings in section 4.6 exist in English and Spanish with identical keys.

Workspace and navigation channel
108. Shell tags `Recording`, `History`, `Settings`, `Session`; session tabs `Transcript`, `Summary` (default `Transcript`).
109. `NavigateTo` rejects session tabs, unknown tags and blank input.
110. `SetCurrentShellTag` validates, ignores repeats, raises a scope change on change.
111. Selection, last processed meeting, folder selection (null = Inbox), live transcript and capture-active state are held app-wide.
112. Deleting a meeting clears matching last-processed and selection and raises a deleted event.
113. `OpenSession(tab)` sets the tab then navigates to Session.
114. `RequestTakeNotes(eventId?)` flags a pending request (blank id = null), raises an event, navigates to Record; `ConsumeTakeNotes` returns true once and clears both values.
115. Scope-changed events are not raised for live transcript text updates.

Meeting chat dock
116. A bottom expander in the content area, expanding upward, bound to the chat view-model's expanded and visible state.
117. Header shows scope glyph and label, a history button, and a new-chat button.
118. History flyout lists threads (title, "Updated {0}"), shows "No chats yet." when empty, refreshes on open, opens a thread on click and scrolls to the end, and deletes with a confirmation.
119. Transcript shows user messages right-aligned in a bubble and assistant messages with role label, Markdown, thinking indicator and a copy button when an answer exists.
120. Error bar shows "Could not answer" with the message and is closable.
121. A scope-mismatch hint shows when the open chat belongs to another scope.
122. Starter chips send their recipe on click and show the prompt as tooltip.
123. Composer: Enter sends, Shift+Enter newline, Ctrl+Enter sends; multi-line, 32 to 96 DIP high, draft updates on every keystroke.
124. A slash-filtered draft opens the recipe flyout; the flyout button shows all recipes; choosing a recipe fills the draft, focuses the composer with the caret at the end, and does not re-open the flyout.
125. Recipe flyout lists name and two-line prompt, delete only for user recipes, and a "New recipe" button.
126. New recipe dialog needs a non-blank name and prompt (Save is blocked otherwise) and offers "This meeting" / "Multiple meetings", preselected from the view-model.
127. Deleting a recipe confirms with the name; built-in recipes stay.
128. The personal-tasks button appears per the view-model, opens the personal tasks dialog for the current meeting, and ignores double clicks.
129. Assistant links: `meeting:` links open that meeting's Summary tab, or show "That meeting no longer exists."; http and https links open in the default browser; other schemes are ignored.
130. The transcript auto-scrolls to new messages and follows a streaming answer to the bottom of its scroll extent.
131. Copy uses the view-model's copy command.
132. The chat view-model receives the three provider-resolution callbacks, each given the page root for dialogs, before it initializes.

Dialogs and strings
133. One factory builds confirm dialogs (primary + close, default chosen by caller) and error dialogs (close only, default Close).
134. Only one dialog may be open; collisions are handled as in item 98.
135. Dialog content may be text or interactive controls.
136. No UI string is hard-coded except the product name; keys resolve in the active language; the default language is English.
137. The default meeting title is "Meeting {0}" / "Reunión {0}" with date format `d MMM, HH:mm` in the current culture.

Keyboard
138. Record page shortcuts: Ctrl+R record or stop, Ctrl+P pause or resume, Ctrl+Shift+D discard.
139. Ctrl+Enter shortcuts for live ask and live answer are scoped to their controls, not global.
140. There are no global OS-wide hotkeys unless added deliberately.

Settings persistence
141. `settings.json` lives at `%LOCALAPPDATA%\MeetingLive\settings.json`, camelCase keys, indented, unknown keys ignored, missing keys default.
142. Defaults: popup on, calendar notifications on, TypeSafe on, live transcription on, diarization off, languages `es`, pane 280, pill right/0.5.
143. Load-mutate-save callers cannot lose each other's fields (improvement over the current race).
144. A corrupt settings file does not crash the app and is recoverable (improvement).
145. Writes are atomic (write temp then replace) (improvement).
146. Provider factories read Claude, Codex and xAI model and effort with the same serializer options as the writer (fixes bug 1).
147. Legacy pill X/Y fields are tolerated on read and not written.

Error handling and logging
148. Unhandled UI-thread exceptions are appended to `%LOCALAPPDATA%\MeetingLive\crash.log` as an ISO timestamp line, the exception text, and a blank line; the logger never throws.
149. Close-gate failures append `<timestamp> close failed` plus the exception.
150. Background watcher failures never crash the app and never show a toast; the call watcher logs only the exception type name to the debug stream.
151. (Improvement) Handlers for unobserved task and process-level exceptions log to the same file; log rotation applies.

Packaging and platform
152. Package identity keeps the same name GUID and display name "Vozella" so Windows consent and user data stay attached.
153. Capabilities include calendar access and full trust equivalents; the app declares per-monitor DPI awareness.
154. Platform builds exist for x64, ARM64 and x86 (or a documented subset).
155. Both a packaged and an unpackaged run mode exist for development.

Brand and design system
156. The mark is five bars at x = 5, 8, 11, 14, 17, y = 6, widths 2, heights 3, 8, 13, 8, 3 on a 24-unit grid; ink `#0a0a0a`, paper `#ffffff`.
157. Tile corner radius is 22.5 percent of the side.
158. Hinted pixel grids exist for 16 and 32 px; all other sizes use the master grid, rendered with 8x supersampling and a box filter.
159. Generated assets match the list in section 4.8, including the multi-frame `.ico` (16, 24, 32, 48, 64, 256).
160. The four brand SVGs exist and are generated from the same geometry.
161. Palette tokens in section 4.9 are the single source for both themes; the signal color is reserved for live state.
162. Type tokens: Schibsted Grotesk and IBM Plex Mono with the stated fallbacks and scale.
163. Radii 4 px, hairline and control borders, no shadows, no gradients.
164. Focus ring is 2 px ink with 2 px offset (on-ink on dark surfaces).
165. Reduced-motion preference removes all non-essential motion.
166. Folder accent palette (eight colors, light and dark, high contrast fallbacks) is preserved.
167. Always-dark surfaces: the popup and the pill, regardless of theme.
168. The theme follows the OS light or dark setting; there is no in-app theme switch.

Watchers and timers
169. The watcher inventory in section 3.2 is complete: only the call watcher and the calendar watcher run for the app's life; all others are scoped to a window, page or action and stop as listed.
170. No watcher runs after the main window closes.
