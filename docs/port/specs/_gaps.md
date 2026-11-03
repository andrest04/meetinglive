# Port spec gaps

Source of truth: C# and XAML on branch `feat/electron-port`. This file covers items that no spec in this folder describes. A coverage pass matched every `.cs` and `.xaml` file under `MeetingLive.App` and `MeetingLive.Core` (286 files) by type name against the 12 specs. Files that match nothing by name are either interfaces whose implementation is specified (for example `IAppSettingsService`, `ICalendarStore`, `IFolderRepository`, `IXaiCredentialStore`), or are listed below. `CalendarBusyStatus` and `CalendarSeriesId` are covered in `calendar-detection.md` by behavior (busy values and roaming-id rule). The five main pages (Session, History, Recording, Main, Settings) were skimmed for user-facing features; all features found are specified except those below.

## 1. Provider brand icons

Files: `MeetingLive.App/Controls/ClaudeCodeIcon.xaml`, `CodexIcon.xaml`, `GrokIcon.xaml` (and their `.xaml.cs`, which are empty code-behind).

### Features
- Three vector marks, each a single `Path` inside a 24 x 24 canvas scaled uniformly to the control size (`Viewbox Stretch=Uniform`).
- Used in `SettingsPage.xaml:68-84` (16 x 16, inside the three CLI/xAI summary-provider radio buttons, left of the provider name) and in `SummaryModelSetupDialog.xaml:34,49,64` (24 x 24, left column of the engine choice buttons).
- The path data is in each file's `Data` attribute (`F1` fill rule for Claude Code and Codex, `F0` for Grok). The Electron port must copy these path strings verbatim into SVG `<path d="...">` with `viewBox="0 0 24 24"` and the matching `fill-rule` (`nonzero` for `F1`, `evenodd` for `F0`).

### Rules
- Claude Code mark fill is `ClaudeBrandBrush`: `#D97757` in light and dark, system window-text color in high contrast (`App.xaml:14,25,36`).
- Codex and Grok marks are monochrome and follow the primary text color of the current theme (`TextFillColorPrimaryBrush`). They must invert with the theme.
- Icons are decorative; the adjacent text label carries the accessible name. Mark the SVG `aria-hidden`.
- The marks are third-party trademarks; keep them only as provider indicators next to the provider name, never as the app brand.

### Parity checklist
- [ ] Three SVG components with path data identical to the XAML.
- [ ] Claude mark orange `#D97757` in both themes; forced-colors mode uses `CanvasText`.
- [ ] Codex and Grok marks switch with theme text color.
- [ ] Shown at 16 px in Settings provider radios and 24 px in the summary engine chooser.

## 2. Native recognizer handle lifetime

Files: `MeetingLive.Core/Native/NemoSpeechSafeHandles.cs`, `MeetingLive.Core/Services/NativeNemoSpeechAsrEngine.cs`, `INemoSpeechAsrEngine.cs`. `transcription.md` section 3.5 specifies the C ABI structs and exports but not ownership rules.

### Features
- Every native object (recognizer, stream, per-result handle) is owned by a handle object. No raw pointers cross the engine boundary.
- The loaded DLL is itself a handle. Each owned object takes a reference on the library handle when created and releases it when freed, so the DLL stays loaded until the last recognizer, stream, or result is released.
- Result handles are consumed one by one while draining a stream: call `stream_next` until it returns null; for each handle read `is_final`, transcript, audio-processed, word count, and per word start ms, end ms, speaker tag, and text; then release the result handle immediately (`nemo_speech_asr_result_destroy`).
- Word times convert from milliseconds to durations; the word array length equals the reported word count.
- Disposing a stream releases the stream handle once and is idempotent.

### Rules
- Creating a handle with a null native pointer is an error.
- A release callback that throws reports failure to the handle layer but must still drop the library reference (release the library in a `finally`).
- Freeing order: result before stream before recognizer before library. In the Electron port, wrap the binding (N-API addon or similar) so that destroy calls are paired with create calls and a finalizer or explicit `dispose()` runs exactly once.
- Do not retain any result data (strings, word arrays) after its handle is released; copy first.

### Parity checklist
- [ ] Recognizer, stream, and result objects each have a single owner and a single idempotent dispose.
- [ ] The native library cannot unload while any child handle is alive.
- [ ] Each drained result is released as soon as it is copied.
- [ ] A throwing destroy still releases the library reference.
- [ ] A null native pointer is rejected at construction.

## 3. Keyboard accelerators not listed in a single place

Behavior is described across `recording.md`, `live-copilot.md`, and `chat.md`. This table consolidates the accelerators found in XAML so the shell can register them once.

| Keys | Where | Action | Source |
|---|---|---|---|
| Ctrl+R | Record page record/stop buttons | Toggle recording | `RecordingPage.xaml:331,551` |
| Ctrl+P | Pause button | Toggle pause | `RecordingPage.xaml:568` |
| Ctrl+Shift+D | Discard button | Discard recording | `RecordingPage.xaml:625` |
| Ctrl+Enter | Live answer button | Answer armed question | `RecordingPage.xaml:862` |
| Ctrl+Enter | Live ask text box | Send typed question | `RecordingPage.xaml:896` |
| Ctrl+Enter | Chat send button | Send chat message | `MainPage.xaml:326` |

### Rules
- Accelerators are scoped to their control (button or text box), not global. They only fire when that control is enabled and the command can execute.
- The same chord (Ctrl+Enter) is used in three places and must not collide: scope each to its own focused region.
- Tooltips must show the chord (for example "Ask (Ctrl+Enter)").

### Parity checklist
- [ ] Each chord triggers only its own action and only when enabled.
- [ ] Ctrl+Enter in the live ask box does not send chat, and vice versa.
- [ ] Tooltips list the chord.

## 4. Not found

No other user-facing feature in the five pages lacked a spec. Layout-only names (`WideState`, `NarrowState`, `ContentScroll`, `SidePanel*`, `FolderSplitView`, `LayoutStates`) and window-width breakpoints (Recording 1100, History 820) are specified in `recording.md`, `library-storage.md`, and `shell-platform.md` under responsive behavior. Speaker-model download and delete buttons (`Settings_DownloadSpeakers`, `Settings_DeleteSpeakers`) are covered in `transcription.md` section on speaker diarization.
