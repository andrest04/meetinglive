import { describe, expect, it } from 'vitest';
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  isPanelToggle,
  panelMode,
  parseStoredOpen,
  parseStoredWidth,
} from './ai-panel-layout';

const key = (overrides: Partial<Parameters<typeof isPanelToggle>[0]>) => ({
  key: 'j',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

describe('panelMode', () => {
  it('docks while the content keeps at least 560 px beside the panel', () => {
    expect(panelMode(940, 380)).toBe('dock');
    expect(panelMode(1080, 520)).toBe('dock');
  });

  it('overlays when docking would leave the content under 560 px', () => {
    expect(panelMode(939, 380)).toBe('overlay');
    // The window minimum leaves 728 px beside the sidebar.
    expect(panelMode(728, PANEL_MIN_WIDTH)).toBe('overlay');
  });

  it('docks before the first measurement arrives', () => {
    expect(panelMode(null, 380)).toBe('dock');
  });
});

describe('stored preferences', () => {
  it('reads a width inside the limits and falls back to the default otherwise', () => {
    expect(parseStoredWidth('420')).toBe(420);
    expect(parseStoredWidth('100')).toBe(PANEL_MIN_WIDTH);
    expect(parseStoredWidth('9000')).toBe(PANEL_MAX_WIDTH);
    expect(parseStoredWidth(null)).toBe(PANEL_DEFAULT_WIDTH);
    expect(parseStoredWidth('wide')).toBe(PANEL_DEFAULT_WIDTH);
  });

  it('opens only on an explicit true', () => {
    expect(parseStoredOpen('true')).toBe(true);
    expect(parseStoredOpen('false')).toBe(false);
    expect(parseStoredOpen(null)).toBe(false);
  });
});

describe('isPanelToggle', () => {
  it('matches Ctrl+J and Ctrl+Shift+J', () => {
    expect(isPanelToggle(key({}))).toBe(true);
    expect(isPanelToggle(key({ key: 'J', shiftKey: true }))).toBe(true);
  });

  it('ignores other chords', () => {
    expect(isPanelToggle(key({ ctrlKey: false }))).toBe(false);
    expect(isPanelToggle(key({ altKey: true }))).toBe(false);
    expect(isPanelToggle(key({ key: 'k' }))).toBe(false);
  });
});
