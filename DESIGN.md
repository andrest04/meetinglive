---
name: Vozella
description: Every meeting, written down.
colors:
  ink: "#0a0a0a"
  on-ink: "#ffffff"
  paper: "#ffffff"
  paper-raised: "#f5f5f5"
  ink-muted: "#525252"
  ink-faint: "#6e6e6e"
  on-ink-muted: "#a3a3a3"
  border-control: "#8a8a8a"
  hairline: "#e5e5e5"
  hairline-on-ink: "#333333"
  signal: "#d92d20"
  on-signal: "#ffffff"
  ink-dark: "#ffffff"
  paper-dark: "#0a0a0a"
  paper-raised-dark: "#171717"
  ink-muted-dark: "#a3a3a3"
  ink-faint-dark: "#8a8a8a"
  border-control-dark: "#6b6b6b"
  hairline-dark: "#262626"
  signal-dark: "#ff5a4f"
  folder-blue: "#3b6bd0"
  folder-teal: "#2f7f78"
  folder-green: "#3f7d4f"
  folder-amber: "#a9742a"
  folder-orange: "#b9632f"
  folder-red: "#b04545"
  folder-purple: "#7c5aa8"
  folder-neutral: "#7a7a7a"
typography:
  title:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  read:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  ui-lg:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  ui:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI Variable', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono:
    fontFamily: "'IBM Plex Mono', Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "'tnum'"
rounded:
  control: "4px"
  overlay: "6px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.ui-lg}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui-lg}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui-lg}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-sm:
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui-lg}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.ui-lg}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  nav-item-active:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  badge:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "0 6px"
    height: "20px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  stop-button:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.full}"
    size: "36px"
---

# Design System: Vozella

## Overview

**Creative North Star: "The Quiet Stenographer"**

Vozella should feel like someone writing quietly in the corner of the room. The interface is ink on paper: one near-black ink, white or deep-black paper, and grey steps between them. It is precise and dense, and it does not compete with the meeting. Nothing decorates. Hierarchy comes from weight, size, and tonal layering, not from color.

The system has exactly one loud moment, and that moment is recording. The signal red appears only when Vozella is capturing audio. It shows as a pulsing dot, a live badge, or the stop button on the pill. Everywhere else the stenographer stays out of sight. Primary actions are ink, focus rings are ink, and selection is a darker tint of paper.

The same tokens drive the desktop app (`apps/desktop`) and the landing page (`website/`). The tokens were taken from the landing page and ported into the app. Light is the default and dark follows the system. In-call surfaces (the recording pill and the call popup) are always dark, so they sit quietly over whatever app is on screen.

**Key Characteristics:**
- Monochrome ink on paper, light and dark, with high-contrast neutrals.
- One signal color, reserved for recording.
- Flat, tonal depth: paper, raised paper, hover tint, pressed tint. A shadow appears only on true overlays.
- Small, consistent corners: 4px on controls and 6px on overlays.
- Compact desktop density: 28px and 32px controls, on a 4px rhythm.
- Uniform, quick motion: 150ms ease-out, fully respecting reduced motion.

## Colors

The palette is a strict neutral ramp plus one red that only ever means "recording".

### Primary
- **Stenographer's Ink** (`ink`): primary buttons, the checked switch, the active tab indicator, focus outlines, and tooltips. It inverts to white in dark mode (`ink-dark`). Ink is the brand's action color, which is why the system needs no chromatic primary.

### Secondary
- **Tally Red** (`signal`, `signal-dark` in dark mode): recording state only. It appears in the Pulse dot and halo, the live Badge dot, and the stop button on the pill. Text on it is `on-signal`.

### Neutral
- **Paper** (`paper` / `paper-dark`): the base canvas and the fill of inputs and secondary buttons.
- **Raised Paper** (`paper-raised` / `paper-raised-dark`): the sidebar, popups, badges, notices, and the pill surface.
- **Muted Ink** (`ink-muted` / `ink-muted-dark`): secondary text and inactive navigation.
- **Faint Ink** (`ink-faint` / `ink-faint-dark`): placeholders, timestamps, and date columns.
- **Control Edge** (`border-control` / `border-control-dark`): borders on inputs, selects, secondary buttons, and the pill pause ring. These are interactive edges.
- **Hairline** (`hairline` / `hairline-dark`): dividers, list-row separators, card and notice borders, and the sidebar edge. These are structural edges.
- **On-Ink pair** (`on-ink`, `on-ink-muted`, `hairline-on-ink`): text and dividers on inverted ink surfaces.
- **Interaction tints** (derived in `tokens.css`): hover is ink mixed into transparent at 6%, pressed is ink at 12%, and the scrim is #0a0a0a at 45%.

### Folder Accents
- **Folder palette** (`folder-blue`, `folder-teal`, `folder-green`, `folder-amber`, `folder-orange`, `folder-red`, `folder-purple`, `folder-neutral`, each with a lighter dark-mode value in `tokens.css`): user-chosen labels for library folders and nothing else. They are muted on purpose so a folder color never reads as status.

### Named Rules
**The Tally Light Rule.** Signal red means "recording now". It is never used for errors, deletion, emphasis, branding, or folders. If nothing is recording, no signal red is on screen.

**The Ink Is the Accent Rule.** There is no chromatic primary. Emphasis comes from ink (`ink`) against paper, from weight, and from the pressed tint.

**The No Status Colors Rule.** Success, warning, and error do not get colors. Notices and toasts look the same in every tone; the icon and the ARIA role carry the meaning.

## Typography

**Body Font:** Schibsted Grotesk Variable (with Segoe UI Variable, system-ui)
**Label/Mono Font:** IBM Plex Mono (with Consolas), weights 400 and 500

**Character:** A sturdy, slightly editorial grotesk for words, paired with a typewriter-adjacent mono for anything time-like. It reads like a clean transcript with timestamps in the margin.

### Hierarchy
- **Title** (600, 30/36, −0.02em): page titles and the editable meeting title.
- **Heading** (600, 20/28, −0.01em): section and dialog titles, and the recording timer when it is set in mono.
- **Read** (400, 15/24; 16/26 for `read-lg`): transcripts, notes, summaries, and chat. Reading measure is about 62ch.
- **UI Large** (400 or 500, 14/20): navigation, buttons (md), inputs, and the app name.
- **UI** (400, 13/20): dense controls, small buttons, and tooltips.
- **Caption** (400 or 500, 12/16): badges, metadata, and source lists.
- **Mono** (400, 12/16, tabular numbers): elapsed time, dates in library rows, and the pill timer.

### Named Rules
**The Timestamp Rule.** Time, dates, and durations are set in IBM Plex Mono with tabular numbers. Prose is never set in mono.

**The Two Weights Rule.** Use 500 for interactive emphasis (buttons, active nav, tabs) and 600 for headings. No other weights.

## Layout

The desktop shell is a 232px sidebar on raised paper, separated by a hairline, beside a content column. A 40px drag strip at the top acts as the title bar and holds the 20px mark and the app name. The content column is padded 40px horizontally and 32px at the top, with a 720px maximum width (960px on the record screen). The library is the exception: a full-bleed, two-pane view whose list pane is `clamp(340px, 38%, 440px)`. An AI panel docks on the right of the content column on raised paper (hairline handle, no shadow at rest), 320 to 520px wide (380 by default), opened from a round ink launcher at the bottom right or with Ctrl+J. When docking would leave the page under 560px it floats over the page as a right-anchored sheet with the overlay shadow, sliding in over 150ms. Its top 40px is drag strip, like the content column, so its buttons stay clear of the caption buttons.

Spacing follows Tailwind's 4px base. Controls are 28px (sm) or 32px (md) tall. Setting rows use 14px vertical padding. Navigation items are 32px with a 1px gap. The app is a fixed-size desktop window, not a responsive layout, so breakpoints are effectively absent.

## Elevation & Depth

The system is flat and tonal. Depth is a stack of paper → raised paper → hover tint (6%) → pressed tint (12%), with hairlines marking boundaries. Shadows exist only for things that genuinely float above the page.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 6px 24px -6px color-mix(in srgb, var(--ink) 22%, transparent)`): menus, select popups, popovers, dialogs, and toasts.
- **Pill** (`box-shadow: 0 2px 6px color-mix(in srgb, var(--ink) 32%, transparent)`): the floating recording pill only.

### Named Rules
**The Paper Stack Rule.** Surfaces are flat at rest. Use a tint or a hairline to separate them; reach for the overlay shadow only when an element floats over content and dismisses.

## Shapes

Corners are small and consistent: 4px (`rounded.control`) on every control, badge, chip, and nav item, and 6px (`rounded.overlay`) on popups, dialogs, and logo tiles. Fully round (`rounded.full`) is reserved for the pill, the Pulse dot, and circular pill buttons. Borders are 1px. Control Edge marks things you can type into or press, and Hairline marks structure. Icons are Lucide at a 1.5 stroke in 12, 14, 16, or 20px.

## Components

### Buttons
Restrained and certain: ink does the talking.
- **Shape:** gently squared (4px).
- **Primary:** ink fill with on-ink text, medium weight. Hover drops opacity to 0.85 and active to 0.70.
- **Secondary:** paper fill with a Control Edge border. Hover uses the hover tint and active the pressed tint.
- **Quiet:** transparent, with the same hover and pressed tints. This is the default for icon buttons.
- **Sizes:** sm is 28px tall, 10px padding, UI text, 14px icon. md is 32px tall, 12px padding, UI Large text, 16px icon.
- **Icon buttons:** square at 28px or 32px, and always paired with a tooltip.
- **Focus:** a global 2px solid ink outline at a 2px offset.
- **Disabled:** 50% opacity with a not-allowed cursor.
- **Transitions:** background and opacity over 150ms with `ease-out-quick`.
- There is deliberately no danger variant.

### Inputs / Fields
- **Style:** paper fill, Control Edge border, 4px corners, 32px tall, 10px padding, UI Large text, Faint Ink placeholder. Hover uses the hover tint.
- **Title field:** 48px tall in Title type, with no border at rest. A hairline appears on hover and a Control Edge border on focus.
- **Textarea:** Read type, at least 64px tall.
- **Select:** the same surface as an input, with a minimum width of 160px and a 14px up-down chevron. Its popup is raised paper with a hairline border, 6px corners, and the overlay shadow, and it enters with a 150ms fade and a 4px rise.
- **Disabled:** 60% opacity.

### Chips and Badges
- **Badge:** 20px tall in Caption at medium weight, 4px corners. The neutral tone is raised paper with muted ink, there is an outline tone, and the live tone adds an 8px Tally Red dot.
- **Starter chips:** 28px tall with a hairline border and 12px padding.

### Navigation
- **Sidebar items:** 32px tall in UI Large, Muted Ink, 4px corners. Hover uses the hover tint with ink text. Active uses the pressed tint, ink text, and medium weight.
- **Tabs:** 36px tall with a 20px gap. The active tab is marked by a 2px ink underline that slides into place.

### Overlays
- **Dialog:** 20px padding and a 16px gap, at most 30rem wide. The title uses Heading type, over the 45% scrim.
- **Tooltip:** an inverted ink surface with UI text, 4px × 8px padding, offset 6px from its trigger.
- **Toast:** 320px wide with 12px padding, bottom right, closing after 5 seconds. It uses the overlay shadow.

### Recording Pill (signature)
The stenographer's only public appearance. It always uses dark tokens and floats over other apps. It is a fully rounded raised-paper capsule with a hairline border and the pill shadow. It holds a 32px logo tile, live audio bars, a mono timer, a 36px pause button ringed in Control Edge, a 36px **Tally Red** stop button, and a 32px chat toggle. When it hints, it scales from 1 to 1.08 in two 180ms legs. The expanded copilot panel uses 28px corners.

### Pulse and Recording Bar (signature)
- **Pulse:** a 10px Tally Red dot inside an 18px halo. The halo breathes between 0.15 and 0.45 opacity over 1.2s. With reduced motion it holds still at 0.3.
- **Recording bar:** a hairline box with 16px × 12px padding, holding the Pulse, a mono timer at Heading size, and the title with its sources.

### Library Rows (signature)
Flat rows divided by hairlines, with a 72px mono date column in Faint Ink. Hover and selected rows use the hover tint, and the keyboard cursor row uses the pressed tint.

## Do's and Don'ts

### Do:
- **Do** use ink (`ink`) for the single primary action on a screen, and secondary or quiet buttons for everything else.
- **Do** separate surfaces with raised paper, the 6% and 12% tints, and hairlines before considering a shadow.
- **Do** set every time, date, and duration in IBM Plex Mono with tabular numbers.
- **Do** use only the radius tokens: 4px for controls, 6px for overlays, full for the pill and dots.
- **Do** animate with 150ms `cubic-bezier(0.2, 0.7, 0.2, 1)` and honor reduced motion with `useReducedMotion` or the global CSS override.
- **Do** keep in-call surfaces (the pill and the call popup) on dark tokens.

### Don't:
- **Don't** use signal red (`signal`) for anything except active recording: no errors, no deletion, no emphasis.
- **Don't** introduce success, warning, or error colors; carry the meaning with the icon and the ARIA role.
- **Don't** add shadows to cards, rows, or panels at rest.
- **Don't** use arbitrary radii (`[3px]`, `[2px]`, `[1.5px]`) or undefined tokens such as `rounded-card`. These exist today and are drift, not precedent.
- **Don't** use off-scale type sizes such as the 17px h2 in the notepad. Map to the scale instead.
- **Don't** use folder accents (`folder-*`) for status or for branding.
