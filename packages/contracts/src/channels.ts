import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';

/** No input. An object keeps room to add optional fields without breaking callers. */
const empty = z.object({}).strict();

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  arch: z.string(),
  isPackaged: z.boolean(),
  /** True when VOZELLA_FAKE_NATIVE selected the fake native adapters. */
  fakeNative: z.boolean(),
  dataRoot: z.object({
    appData: z.string(),
    meetings: z.string(),
    source: z.enum(['env', 'default', 'dev-fallback']),
  }),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const appGetInfo = defineRequest('app.getInfo', {
  input: empty,
  output: appInfoSchema,
});

export const appReportRendererError = defineRequest('app.reportRendererError', {
  input: z.object({
    message: z.string().max(2_000),
    stack: z.string().max(10_000).optional(),
    source: z.enum(['error', 'unhandledrejection', 'react']),
  }),
  output: z.object({ logged: z.literal(true) }),
});

export const diagnosticsNativeSelfTest = defineRequest('diagnostics.nativeSelfTest', {
  input: empty,
  output: z.object({
    backend: z.enum(['native', 'fake']),
    platformSupported: z.boolean(),
  }),
});

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/**
 * Sets the window chrome theme. The main process applies it to nativeTheme (so
 * prefers-color-scheme follows) and recolors the title bar overlay.
 */
export const appSetThemePreference = defineRequest('app.setThemePreference', {
  input: z.object({ preference: themePreferenceSchema }),
  output: z.object({ resolved: z.enum(['light', 'dark']) }),
});

export const appFocusChanged = defineEvent('app.focusChanged', {
  payload: z.object({ focused: z.boolean() }),
});

export const requestChannels = {
  [appGetInfo.name]: appGetInfo,
  [appReportRendererError.name]: appReportRendererError,
  [diagnosticsNativeSelfTest.name]: diagnosticsNativeSelfTest,
  [appSetThemePreference.name]: appSetThemePreference,
} as const;

export const eventChannels = {
  [appFocusChanged.name]: appFocusChanged,
} as const;

export type RequestChannels = typeof requestChannels;
export type EventChannels = typeof eventChannels;
export type RequestName = keyof RequestChannels;
export type EventName = keyof EventChannels;
