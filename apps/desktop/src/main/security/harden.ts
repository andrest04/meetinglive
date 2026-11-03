import type { Session, WebContents } from 'electron';
import { isSafeExternalUrl } from './external-url';
import { buildCsp } from './csp';
import { isTrustedUrl, type TrustedOrigins } from './trusted-origin';

/**
 * Applies the baseline to every web contents the app ever creates: no navigation away
 * from app content, no new windows, no webviews.
 */
export function hardenWebContents(
  contents: WebContents,
  trusted: TrustedOrigins,
  onBlocked: (kind: string, url: string) => void,
  /** Opens an allowed https link outside the app. A window is never opened either way. */
  openExternal?: (url: string) => void,
): void {
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, trusted)) {
      event.preventDefault();
      onBlocked('navigate', url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url, trusted)) {
      event.preventDefault();
      onBlocked('redirect', url);
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    onBlocked('webview', '');
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (openExternal && isSafeExternalUrl(url)) openExternal(url);
    else onBlocked('window-open', url);
    return { action: 'deny' };
  });
}

/** Session level defaults: deny every permission until a feature asks for one explicitly. */
export function hardenSession(
  session: Session,
  options: { devServerOrigin: string | undefined },
): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  if (options.devServerOrigin) {
    // In dev the page comes from Vite, whose responses carry no CSP header.
    const csp = buildCsp({ dev: true });
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      });
    });
  }
}
