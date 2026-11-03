import {
  appGetInfo,
  appReportRendererError,
  appSetThemePreference,
  diagnosticsNativeSelfTest,
  type AppInfo,
  type ThemePreference,
} from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface HandlerDeps {
  readonly server: IpcServerDeps;
  readonly logger: Logger;
  readonly info: () => AppInfo;
  readonly setThemePreference: (preference: ThemePreference) => 'light' | 'dark';
  readonly nativeSelfTest: () => Promise<{
    backend: 'native' | 'fake';
    platformSupported: boolean;
  }>;
}

/** Wires every request channel the app serves. One line per channel. */
export function registerHandlers(deps: HandlerDeps): void {
  registerRequest(deps.server, appGetInfo, () => deps.info());

  registerRequest(deps.server, appReportRendererError, (report) => {
    deps.logger.error('renderer error', {
      source: report.source,
      message: report.message,
      stack: report.stack,
    });
    return { logged: true as const };
  });

  registerRequest(deps.server, diagnosticsNativeSelfTest, () => deps.nativeSelfTest());

  registerRequest(deps.server, appSetThemePreference, ({ preference }) => ({
    resolved: deps.setThemePreference(preference),
  }));
}
