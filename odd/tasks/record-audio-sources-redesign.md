# Record page audio sources redesign

## Objective

Make choosing what to record on the Record page obvious and honest: a live-metered mic picker, and meeting-audio cards that show only apps that are actually playing audio, one card per app, with real icons.

## Problem / why

- `RecordingAppEnumerator` lists every visible titled window (ApplicationFrameHost, TextInputHost, SystemSettings, explorer "Program Manager", WindowsTerminal), labeled `process — window title`, no icons, no audio signal.
- Capture is per process tree (`ProcessLoopbackCapture` `ForIncludeProcessTree`), not per window/tab. Listing Chrome windows/tabs implies a choice that does not exist; picking "chrome — YouTube" records all of Chrome.
- Mic meter maps linear RMS (~0.05 for speech) to 0–100, so it reads as a flat line; it is collapsed until preview starts.
- 220 px ComboBoxes inside SettingsCard right slots truncate ("Predeterminado del sistema", "Todo el audio del siste…"); app popup overflows.
- Sources live in a collapsed Expander; nothing is remembered between meetings.

Research (sources): Granola zero-config defaults (https://docs.granola.ai/help-center/troubleshooting/transcription-issues), Zoom/Teams live input meter (https://uctoday.com/microsoft-teams-microphone-test-pre-join), OBS app capture matched by executable (https://obsproject.com/kb/application-audio-capture-guide), Windows per-session peak meters (https://learn.microsoft.com/en-gb/windows/win32/coreaudio/peak-meters).

## Approved design (user, 2026-10-01)

```
 Sources (always visible, above Record; no Expander)
 Mic      [ System default                 v ]
          [######..........]  dB-scaled meter, always visible
 Meeting audio
 [ All system audio ✓ ] [ Zoom  meter ] [ Chrome  meter ]   one card per app with active audio
 (i) Zoom detected in a call · [Use Zoom]
          [ Record ]  [ Import ]
 While recording: collapses to "Mic: Default · Audio: Zoom".
```

Defaults: All system audio by default; detected meeting app is a one-click suggestion, never auto-switch. Remember mic and output kind; never auto-reselect an app that is not currently playing. No "Test audio" button in v1. Browser card shows a short "records all tabs" hint. No window thumbnails (capture is per app).

## Scope

- T1 Core: active audio session enumeration (default render endpoint), mapped to the owning app process (walk parent chain for child audio processes, e.g. Chrome utility process → chrome.exe root), one entry per app, friendly name (FileDescription/ProductName), exe path for icons, per-app peak level; system processes and our own process excluded.
- T2 App: new Sources section (cards, icons, live meters, dB mic meter, no truncation, collapsed summary while recording), strings en-us + es.
- T3 App/Core: remember mic + output kind (load-mutate-save AppSettings), detected meeting app suggestion via existing `MeetingCallDetector`.

## Out of scope

- Window/tab thumbnails, per-tab capture, a Test audio button, Settings page redesign.

## Constraints

- C# 12 classic `[ObservableProperty]` private fields. Strings via resw (en-us + es). Artifacts in English.
- AppSettings: load-mutate-save, never construct a fresh AppSettings.
- Native interop via `dotnet-pinvoke`; prefer NAudio's existing session API if it covers the need (verify against the package).
- Poll meters only while the page is visible (~100–200 ms).
- Strict TDD for Core logic; UI verified by build + user check (do not launch/screenshot the app).

## TDD

- Mode: strict, enabled. Source: user global config.
- Runner: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`.

## Tasks

- [x] T1 Core: active-audio app enumeration + parent mapping + friendly name + peak; tests. Route: delegated (sonnet writer; native + 4+ files).
- [x] T2 App: Sources section with app cards, icons, meters, collapsed recording summary; resw en+es. Route: delegated (sonnet writer; XAML + VM + resw).
- [x] T3 Remember choices + meeting-app suggestion; tests. Route: delegated (sonnet writer).

## Acceptance criteria

- Picker never shows ApplicationFrameHost, TextInputHost, SystemSettings, explorer, WindowsTerminal, or MeetingLive itself unless they have an active audio session (and known shell/system hosts are always excluded).
- One card per app; Chrome with several windows/tabs is one card.
- A silent app does not appear; a playing app appears with a moving meter.
- Mic meter visibly moves with normal speech.
- No truncated labels at the page's normal width.
- Choosing an app still records via process-tree capture (existing `RecordingCaptureSources.ProcessTree`).
- Mic + output kind survive an app restart; a remembered app that is not playing is not reselected.

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Delivery

Forecast ~900–1300 authored lines across 3 work-unit commits. Repo convention: work-unit commits straight to main (no PRs), Conventional Commits, no AI attribution. Push is the user's call.

## Progress

- Created 2026-10-01. Design approved by user.
- T1 done (commit b6593ac, route: delegated sonnet writer). Used NAudio 2.2.1 (`AudioSessionManager.Sessions`, `AudioSessionControl.GetProcessID/State/IsSystemSoundsSession/AudioMeterInformation.MasterPeakValue`); no new P/Invoke for sessions. Process facts via hand-written DllImport (OpenProcess, QueryFullProcessImageNameW, GetProcessTimes, NtQueryInformationProcess).
  - RED: 53 tests failed (stub threw NotImplementedException). GREEN: 53 passed; full Core suite 714 passed, 0 failed. App build x64 succeeded, 0 errors. Runtime against a real audio device not exercised (no app launch).
  - API for T2: `ActiveAudioAppService(new NAudioAudioSessionSource(), new WindowsProcessInfoProvider(), (uint)Environment.ProcessId)` implementing `IActiveAudioAppService`. `Refresh()` returns `ActiveAudioApp(ProcessId, ExePath?, FriendlyName, IsBrowser, IsKnownMeetingApp, Peak)`. `ReadPeaks()` returns rootPid to peak (0..1) for the last Refresh; cheap, poll ~150 ms. Call `Refresh()` every ~1-2 s to pick up new or ended apps. Browser meeting detection needs a window title (MeetingCallDetector), so IsKnownMeetingApp is false for browsers. `RecordingAppEnumerator` left untouched for T2 to swap.

- T2 done (commit 5844669, route: delegated sonnet writer). Core: `AudioLevelMeter.ToMeterValue` (dB mapping, -60..0 dBFS), `ActiveAppEntries.Merge/IsStillRunning` (keeps a vanished selected app as unavailable; record-time process check rejects reused pids). RED: 19 failed (stubs threw NotImplementedException). GREEN: 19 passed; full Core suite 733 passed, 0 failed. App build x64 succeeded, 0 errors. UI not launched (user checks).
  - App: always-visible Sources card (full-width mic ComboBox with label, dB meter, `GridView` of cards: All system audio + one per active app with shell icon via `AppIconCache` (StorageFile thumbnail), live meter, Detected tag, "Records all tabs" on browsers, dimmed "Not playing" when the selected app vanished). One background loop (`RecordingAudioSourcesViewModel`) owns the NAudio source: Refresh ~1.5 s, ReadPeaks ~150 ms, only while the page is visible and idle. Recording bar shows "Mic: X · Audio: Y". `RecordingAppEnumerator` and `RecordingAppOption` deleted. Mic preview now also runs idle after a finished meeting (HasLastMeeting no longer gates it).
  - System card shows no meter (no system-wide peak is read; faking one would mislead).

- T3 done (commit 0ee935e, route: delegated sonnet writer). Core: `RecordAudioSourceMemory` (Remember*/Restore* over `AppSettings`, new fields `RecordMicrophoneKind/DeviceId`, `RecordOutputKind`, `RecordAppExePath/Name`) and `MeetingAppSuggestion.Pick`. RED: 25 failed (stubs). GREEN: 25 passed; full Core suite 758 passed, 0 failed. App build x64 succeeded, 0 errors.
  - App: mic and card choices persist via load-mutate-save only on user change (`SelectRecordingMicrophone`, `SelectCard`); mic restore on page load (unplugged device falls back to system default); remembered app reselected only if its exe is in the first active list, else silent system audio; InfoBar "X is in a call · Use X" while system audio is selected, never auto-switches, dismissal remembered per pid for the VM lifetime.
  - Deviation: browser meeting-title detection through `MeetingCallDetector` was not wired (needs window enumeration per pid, which was retired with `RecordingAppEnumerator`); the suggestion uses `IsKnownMeetingApp` only. Browser cards still show "Records all tabs".

## Next step

User checks the Record page in the running app (cards, icons, meters, restore, suggestion). Push is the user's call.
