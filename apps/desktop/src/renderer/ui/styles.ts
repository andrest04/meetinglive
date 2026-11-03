// Shared class recipes. Anything used by more than one component lives here so the
// kit stays visually consistent. Colors are tokens only (see styles/index.css).

/** Bordered form control surface: Input, Textarea, Select trigger, Combobox. */
export const controlSurface =
  'rounded-control border border-border-control bg-paper text-ink text-ui-lg placeholder:text-ink-faint ' +
  'transition-colors duration-150 ease-out-quick hover:not-data-disabled:not-disabled:bg-hover ' +
  'data-disabled:opacity-60 disabled:opacity-60 data-disabled:cursor-not-allowed disabled:cursor-not-allowed ' +
  'forced-colors:data-disabled:border-[GrayText] forced-colors:disabled:border-[GrayText]';

/** Floating surface for menus, listboxes, popovers. Hairline edge plus the one allowed shadow. */
export const popupSurface =
  'rounded-overlay border shadow-overlay outline-none ' +
  'origin-[var(--transform-origin)] transition-[opacity,translate] duration-150 ease-out-quick ' +
  'data-starting-style:opacity-0 data-starting-style:translate-y-1 ' +
  'data-ending-style:opacity-0 data-ending-style:translate-y-1 forced-colors:border-[CanvasText]';

export const popupColors = 'border-hairline bg-paper-raised text-ink';

/** A row inside a popup (menu item, option). */
export const popupItem =
  'flex min-h-7 cursor-default items-center gap-2 rounded-control px-2 py-1 text-ui-lg outline-none select-none ' +
  'data-highlighted:bg-hover data-disabled:opacity-50 ' +
  'forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText]';

export const popupSeparator = 'my-1 h-px bg-hairline forced-colors:bg-[GrayText]';
