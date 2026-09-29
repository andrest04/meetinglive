# Record Tab Design Plan: MeetingLive

Four work units, Record page first, ordered by impact per effort. Each unit is one commit containing its XAML, code-behind and en-us/es `.resw` changes. I checked a few premises against the code:
- `IsSessionActive` exists on the ViewModel (`RecordingPageViewModel.cs:243`).
- These helpers exist in `RecordingPage.xaml.cs`: `Not`, `BoolToVisibility`, `InvertBoolToVisibility`, `NonEmptyVisibility`, `DiscardLabel`.
- `tk:WrapPanel` is used only in `RecordingPage.xaml` (lines 12 and 461).
- `controls:SettingsCard` is already imported and used on the Record page.

## Conflicts resolved
- **Page title:** keep `TitleTextBlockStyle` so it matches History and Settings, and add a caption subtitle. The suggested downgrade to `SubtitleTextBlockStyle` is dropped.
- **Recording bar order:** Stop (accent), Pause, Highlight, Copy, then Discard last and icon-only with a 16px gap before it. This puts the primary action first in tab order, which the accessibility review asked for.
- **Audio sources:** convert to SettingsCards and wrap them in an Expander that collapses in the RESULT state. The alternative, keeping the Border card and hiding it, is dropped.
- **Card style:** add one keyed `CardSurface` style in `App.xaml`. It is created in U1 and every later unit uses it, so no unit writes new literal card Borders.

## U1: Session states and feedback (RECORDING / PROCESSING / RESULT)
**Goal:** keep the idle form off screen during a session, show clear processing progress, and put the saved result first.

**Changes**
- `App.xaml`: add `<Style x:Key="CardSurface" TargetType="Border">` with these setters:
  - Background `CardBackgroundFillColorDefaultBrush`
  - BorderBrush `CardStrokeColorDefaultBrush`
  - BorderThickness 1
  - CornerRadius `ControlCornerRadius`
  - Padding 16
  
  It must not be an implicit style, because Border is also used for dots and pills.
- `RecordingPage.xaml`, idle StackPanel (around line 68): change its Visibility to `InvertBoolToVisibility(ViewModel.IsSessionActive)`.
- New processing bar directly above the transcript:
  - A `CardSurface` Border with Padding "16,12", visible when `BoolToVisibility(ViewModel.IsProcessing)`.
  - Grid with columns `*` and `Auto`.
  - Column 0: a BodyStrong `StatusText` with `LiveSetting=Polite`, and an indeterminate ProgressBar.
  - Column 1: the existing Cancel button, moved here with its x:Uid, `CancelProcessingCommand` and AutomationId `BtnCancelProcessing`.
  - Delete the old ProgressRing/Cancel StackPanel (lines 309-315) so the AutomationId appears only once.
- Last-meeting card (Row 2, around line 814):
  - Visibility becomes `LastMeetingVisibility(HasLastMeeting, IsSessionActive)`, a new static helper that returns `has && !active`.
  - BorderThickness "3,1,1,1" with BorderBrush `AccentFillColorDefaultBrush`.
  - A CheckMark FontIcon (E73E) in `SystemFillColorSuccessBrush`.
  - `BtnViewSummary` gets `AccentButtonStyle`.
- Error InfoBar (lines 561-566): move it into the idle column directly under the hero Grid, with Margin "0,8,0,0". Add the new `RecordPage_StatusErrorTitle` string for its Title.
- Idle `StatusText`: wrap it so the existing Visibility stays on an outer panel, and put `NonEmptyVisibility(StatusText)` on the TextBlock. Add `LiveSetting=Polite`.
- `.resw` en-us and es: add `RecordPage_StatusErrorTitle.Title`.

**Files:** `App.xaml`, `RecordingPage.xaml`, `RecordingPage.xaml.cs`, `Strings/en-us/Resources.resw`, `Strings/es/Resources.resw`. About 150 lines.

**Risks**
- The idle panel may host elements needed while processing, such as the setup panel. Confirm nothing is collapsed that the processing state still needs.
- The error InfoBar now sits inside a panel that hides during a session, so a session error must still be visible. Either keep a copy in the recording header or confirm that `IsStatusError` only fires while idle. **Verify this before moving it.**
- Moving Cancel must not duplicate its AutomationId.

**Acceptance checks**
- Build is clean.
- Existing tests pass with every AutomationId unchanged (`BtnCancelProcessing`, `BtnViewSummary`, `BtnToggleRecording`).
- Manual state walk:
  - IDLE shows the form.
  - RECORDING hides the form and the last-meeting card.
  - PROCESSING shows only the bar and the transcript.
  - RESULT shows the promoted last-meeting card.
- Error surfaces in both idle and session states.
- en-us and es keys match.

## U2: Idle hero and form polish
**Goal:** make Record the hero, cut form density, align the page to Windows Settings.

**Changes**
- **Header:** wrap the title in a StackPanel with Spacing 4 and add a caption subtitle `RecordPage_Subtitle` in `TextFillColorSecondaryBrush`.
- **Destination field:**
  - In the destination ItemTemplate TextBlock add `TextTrimming=CharacterEllipsis`, MaxWidth 260, and a tooltip bound to `Path`.
  - Change column 1 to a fixed Width 240.
- **Audio sources (lines 102-216):**
  - Replace the hand-built Border and its 140px label grids with three `controls:SettingsCard` items (Microphone E720, Meeting audio E767, App) in a StackPanel with Spacing 2.
  - The existing x:Uid strings become the card headers; the app caption becomes the Description.
  - Keep the `ShowAppPicker` bind, every AutomationId and every handler.
  - The mic level meter moves into the card content with a reserved MinWidth.
  - RadioButtons use horizontal layout.
  - Put the group inside an `Expander` whose header is the existing `RecordPage_AudioSources` string, with `IsExpanded="{x:Bind local:RecordingPage.Not(ViewModel.HasCanvasTranscript), Mode=OneWay}"`.
- **Setup panel (lines 238-274):**
  - Drop the outer card so it is no longer card-in-card.
  - Set MaxWidth 720 so it aligns with the rest of the column.
  - The headline becomes a secondary caption.
  - The button aligns right instead of stretching.
  - Status glyphs only if VM booleans already exist; otherwise keep text only in the secondary brush.
- **Hero:**
  - `BtnToggleRecording` (idle state) gets MinWidth 200, MinHeight 48, Padding "32,12", CornerRadius `OverlayCornerRadius`, a 20px glyph and a BodyStrong label.
  - `BtnImportAudio` drops its Background and BorderThickness overrides so it uses the standard button look, and gets MinHeight 48.
  - Ctrl+R and all AutomationIds stay.
- **Spacing scale (8/16/24):**
  - Idle column Spacing 24.
  - Title and pickers grouped in an inner StackPanel with Spacing 12.
  - Remove Margin "0,4,0,0" on the action Grid.
  - Set the row-0 wrapper Spacing to 0.
- **Coming up:**
  - Drop the inner Border and style the Button itself with the card brushes, Padding "12,8", `ControlCornerRadius`, MinHeight 64 and VerticalAlignment Top. This restores hover and pressed feedback.
  - ScrollViewer: `HorizontalScrollBarVisibility=Hidden` and Padding "0,0,0,4".
  - Chevron buttons become 40x40.
  - `TxtComingUpEmpty` uses `TextFillColorSecondaryBrush` and `BodyTextBlockStyle`.
- **Copy:** add `RecordPage_Subtitle.Text` and shorten `RecordingSetup_Headline.Text`, in both en-us and es.

**Files:** `RecordingPage.xaml`, both `Resources.resw`. About 350 lines, mostly replacements in the Audio sources block.

**Risks**
- Converting to SettingsCard can change the named-element tree that UI tests query. Keep `x:Name` and AutomationId on the inner ComboBox and RadioButtons, not on the cards.
- The `IsExpanded` OneWay binding resets when `HasCanvasTranscript` flips, which is acceptable.
- A 720px column with SettingsCards on a narrow window needs a check.

**Acceptance checks**
- Build is clean and UI tests pass.
- Ctrl+R still works.
- Mic level meter shows without the ComboBox width jumping.
- A long destination path is trimmed and the tooltip shows the full path.
- Coming-up cards show hover, pressed and focus states.
- In RESULT the Audio sources group is collapsed and can be expanded by hand.
- Light, Dark and High Contrast all render correctly; Import is visible in High Contrast.

## U3: Recording bar and transcript as the protagonist
**Goal:** a single bar that does not reflow, a readable live transcript, and safer controls.

**Changes**
- **Merge the header (lines ~420-559)** into one `CardSurface` Grid with columns `*`, `Auto`, `Auto`:
  - Column 0: pulse, `TxtRecordingElapsed` (BodyStrong), and `TxtRecordingTitle` as a trimmed caption. The destination path moves into the title's tooltip, and the `TxtRecordingDestination` element is kept.
  - Column 1: the mic meter at Width 96.
  - Column 2: buttons in the order Stop (accent, Ctrl+R), Pause (Ctrl+P), Highlight (icon only), Copy (icon only, E8C8), Discard.
  - Discard: icon only (E74D), subtle background, `SystemFillColorCriticalBrush` foreground, `DiscardLabel()` tooltip, Margin "16,0,0,0", Ctrl+Shift+D kept.
  - All buttons get MinHeight 40.
  - Remove `tk:WrapPanel` and `xmlns:tk`. Remove the package reference only if no other code uses it (the XAML search found none; check the csproj).
- **Feedback text:** `TxtHighlightFeedback` and `TxtRecordingStatus` move into the transcript heading row with `LiveSetting=Polite` and MaxWidth 360.
- **Transcript styling:**
  - Border Background `LayerFillColorDefaultBrush`, Padding "24,20".
  - Content MaxWidth 760.
  - `LiveTranscriptBlock` FontSize 16, LineHeight 26, `TextFillColorPrimaryBrush`.
  - Empty-state hint becomes Body, centered, with a microphone glyph.
- **Live badge:** `LiveVisibility(IsRecording, IsPaused)` helper plus the new `RecordPage_LiveBadge.Text` string.
- **Jump to latest:** add `BtnJumpToLatest` with the new `RecordPage_JumpToLatest` tooltip. Toggle it in `LiveTranscriptScroll_ViewChanged`; Click calls `ChangeView` to the end and sets `_stickToTranscriptEnd = true`.
- **Copy confirmation:** `InfoCopyLiveTranscript` overlays the transcript cell (top-right, MaxWidth 320) and its Auto row is removed.
- **Motion and accessibility:**
  - `UpdateRecordingPulse` only calls `Begin()` when `UISettings().AnimationsEnabled` is true; otherwise Opacity stays at 0.3.
  - Pulse, dot ellipses, both mic meters and the decorative FontIcons get `AccessibilityView=Raw`.
  - Meters also get `IsHitTestVisible=False`.

**Files:** `RecordingPage.xaml`, `RecordingPage.xaml.cs`, both `Resources.resw`, and possibly the csproj. About 380 lines.

**Risks**
- Icon-only buttons need their existing `AutomationProperties.Name` kept.
- Tests may depend on the button order; confirm none assert tab order.
- Removing the WrapPanel means the bar can overflow on very narrow windows. Keep Column 0 trimming and check at the Narrow trigger width.
- Jump-to-latest must not break auto-follow.

**Acceptance checks**
- Build is clean and UI tests pass.
- Every accelerator (Ctrl+R, Ctrl+P, Ctrl+Shift+D) still works.
- The bar does not reflow when Copy, the status text or the highlight feedback appear.
- Scrolling up shows the jump button, and clicking it resumes following the transcript.
- With Windows animation effects off, the pulse stays static.
- Narrator announces status and highlight changes and does not announce the meter.

## U4: Cross-page consistency (secondary)
**Goal:** apply the tokens from U1-U3 to the other tabs.

**Changes**
- **HistoryPage.xaml:** move its 2 card Borders (lines ~91 and ~186) to `CardSurface`.
- **Secondary text:** replace `Opacity="0.7"` with `TextFillColorSecondaryBrush` in SettingsPage (lines 80, 311, 376, 381, 411) and SessionPage (line 99). Add `SecondaryCaptionTextBlockStyle` (BasedOn `CaptionTextBlockStyle`) to `App.xaml` and use it for the five Settings captions.
- **Duplicate titles:** in SummaryPage and TranscriptPage, remove the header TextBlock if it duplicates the SessionPage title (check first); otherwise switch it to `SubtitleTextBlockStyle`.
- **Vertical rhythm:** History, Summary and Transcript use RowSpacing 16; SessionPage Padding becomes "24,24,24,16".

**Files:** `App.xaml`, `HistoryPage.xaml`, `SettingsPage.xaml`, `SessionPage.xaml`, `SummaryPage.xaml`, `TranscriptPage.xaml`. About 80 lines, no new strings.

**Risks:** removing a header that is not actually duplicated would lose the meeting context. Verify on SessionPage first.

**Acceptance checks**
- Build is clean and tests pass.
- Contrast holds in Light and Dark.
- Secondary text is visible in High Contrast.
- The title sits at the same vertical position across tabs.

## Deferred
| Finding | Reason |
|---|---|
| Red record dot inside the accent button | Contrast risk on accent; polish only. |
| Expander around the brief section | Low value; hides content that exists for the user to read. |
| Reworking the ask/answer dock (answer card while answering, row reorder, ActionButton InfoBar) | Second-screen feature; the ActionButton half cannot keep the Dismiss AutomationId. Can come after U3. |
| Notes side-panel heading and icon-only save-template button | Low impact; needs a new string. Good first follow-up. |
| Narrow-layout MinHeight setters and RootGrid padding | Needs runtime checks on short windows. Revisit after U3 changes the header height. |
| NavigationView `LeftCompact` / `OpenPaneLength` and a lower AdaptiveTrigger | Changes how the app navigates across the whole shell; needs the user's decision. |
| Moving History Rename/Delete into a flyout | Changes discoverability; the critique itself says to ask the user first. |
| Chat Expander card treatment on MainPage | Only matters if the footers visibly clash; that is not confirmed. |
| `SectionHeaderTextBlockStyle` and Settings group spacing | After U2, Record no longer has in-card headers, so the style would serve Settings only. Low value. |
| `PageContentSpacing` / `PagePadding` tokens | The literals are already identical on most pages, so tokens remove little. |
| RichTextBlock for very long transcripts | Only worth doing if truncation is reported. |