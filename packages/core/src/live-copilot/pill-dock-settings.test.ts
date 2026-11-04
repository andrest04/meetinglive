import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  readSettings,
  serializeSettings,
  type AppSettings,
} from '../library/settings';
import { dockPatch, resolveDock, shouldSaveDock } from './pill-dock-settings';

const base = (over: Partial<AppSettings>): AppSettings => ({ ...readSettings({}), ...over });

describe('resolveDock', () => {
  it('defaults to Right and 0.5', () => {
    expect(resolveDock(base({}))).toEqual({ edge: 'Right', along: 0.5 });
  });

  it('reads the stored edge case-insensitively and clamps along', () => {
    expect(resolveDock(base({ liveCopilotPillEdge: 'top', liveCopilotPillAlong: 7 }))).toEqual({
      edge: 'Top',
      along: 1,
    });
    expect(resolveDock(base({ liveCopilotPillEdge: 'Bottom', liveCopilotPillAlong: -2 }))).toEqual({
      edge: 'Bottom',
      along: 0,
    });
  });

  it('unknown edge and non finite along fall back', () => {
    expect(
      resolveDock(base({ liveCopilotPillEdge: '2', liveCopilotPillAlong: Number.NaN })),
    ).toEqual({ edge: 'Right', along: 0.5 });
    expect(resolveDock(base({ liveCopilotPillAlong: Number.POSITIVE_INFINITY })).along).toBe(0.5);
  });

  it('bug 8: legacy X and Y are never read', () => {
    expect(resolveDock(base({ liveCopilotPillX: -1200, liveCopilotPillY: 340 }))).toEqual({
      edge: 'Right',
      along: 0.5,
    });
  });
});

describe('shouldSaveDock', () => {
  const saved = (edge: string | null, along: number | null) => ({
    liveCopilotPillEdge: edge,
    liveCopilotPillAlong: along,
  });

  it('skips the write when the edge is equal and along within 0.0005', () => {
    expect(shouldSaveDock(saved('Left', 0.25), { edge: 'Left', along: 0.25 })).toBe(false);
    expect(shouldSaveDock(saved('Left', 0.25), { edge: 'Left', along: 0.25049 })).toBe(false);
  });

  it('writes when along moved by more than 0.0005', () => {
    expect(shouldSaveDock(saved('Left', 0.25), { edge: 'Left', along: 0.2506 })).toBe(true);
  });

  it('writes when the edge differs, including nothing saved yet', () => {
    expect(shouldSaveDock(saved('Left', 0.25), { edge: 'Top', along: 0.25 })).toBe(true);
    expect(shouldSaveDock(saved(null, null), { edge: 'Right', along: 0.5 })).toBe(true);
    expect(shouldSaveDock(saved('Right', null), { edge: 'Right', along: 0.5 })).toBe(true);
  });
});

describe('dockPatch and the settings round trip', () => {
  it('carries only edge and along', () => {
    expect(dockPatch({ edge: 'Top', along: 0.25 })).toEqual({
      liveCopilotPillEdge: 'Top',
      liveCopilotPillAlong: 0.25,
    });
  });

  it('edge and along survive serialize and read; legacy X and Y round trip untouched', () => {
    const raw = { liveCopilotPillX: -1200, liveCopilotPillY: 340, futureThing: 1 };
    const next = applySettingsPatch(raw, dockPatch({ edge: 'Bottom', along: 0.4 }));
    const text = serializeSettings(next);
    const back = readSettings(JSON.parse(text) as Record<string, unknown>);
    expect(resolveDock(back)).toEqual({ edge: 'Bottom', along: 0.4 });
    expect(back.liveCopilotPillX).toBe(-1200);
    expect(back.liveCopilotPillY).toBe(340);
    expect(text).toContain('futureThing');
  });
});
