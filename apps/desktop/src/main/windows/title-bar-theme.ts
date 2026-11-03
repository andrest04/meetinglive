export type ResolvedTheme = 'light' | 'dark';

/** Height of the custom title bar and of the Windows caption-button overlay, in CSS px. */
export const TITLE_BAR_HEIGHT = 40;

/** Window chrome colors. They are the `paper` and `ink` tokens of the renderer. */
const PALETTE: Readonly<Record<ResolvedTheme, { paper: string; ink: string }>> = {
  light: { paper: '#ffffff', ink: '#0a0a0a' },
  dark: { paper: '#0a0a0a', ink: '#ffffff' },
};

export function windowBackground(theme: ResolvedTheme): string {
  return PALETTE[theme].paper;
}

/** Solid overlay behind the native caption buttons, matching the renderer title bar. */
export function titleBarOverlayFor(theme: ResolvedTheme): {
  color: string;
  symbolColor: string;
  height: number;
} {
  const { paper, ink } = PALETTE[theme];
  return { color: paper, symbolColor: ink, height: TITLE_BAR_HEIGHT };
}
