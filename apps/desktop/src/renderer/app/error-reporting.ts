import type { VozellaApi } from '@vozella/contracts';

type Source = 'error' | 'unhandledrejection' | 'react';

export function reportRendererError(api: VozellaApi, source: Source, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  api
    .invoke('app.reportRendererError', {
      source,
      message: message.slice(0, 2000),
      ...(stack ? { stack: stack.slice(0, 10_000) } : {}),
    })
    .catch(() => {
      // Reporting must never throw back into the page.
    });
}

/** Sends uncaught errors and unhandled rejections to the main process log. */
export function installRendererErrorReporting(target: Window): void {
  target.addEventListener('error', (event) => {
    reportRendererError(target.vozella, 'error', event.error ?? event.message);
  });
  target.addEventListener('unhandledrejection', (event) => {
    reportRendererError(target.vozella, 'unhandledrejection', event.reason);
  });
}
