/** The renderer is served from this custom, privileged scheme in builds. */
export const APP_SCHEME = 'vozella';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

export interface TrustedOrigins {
  /** Vite dev server origin, only when running unpackaged in dev. */
  readonly devServerOrigin?: string | undefined;
}

/** True for URLs that belong to the app itself (custom scheme, or the dev server). */
export function isTrustedUrl(raw: string, trusted: TrustedOrigins = {}): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) {
    return true;
  }
  if (trusted.devServerOrigin) {
    try {
      return url.origin === new URL(trusted.devServerOrigin).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Structural subset of Electron's WebFrameMain, so this logic is testable without Electron. */
export interface FrameLike {
  readonly url: string;
  /** null for the top frame of a page. */
  readonly parent: unknown;
}

export interface IpcEventLike {
  readonly sender: { readonly id: number };
  readonly senderFrame: FrameLike | null | undefined;
}

/**
 * IPC sender check. A message is accepted only from the top frame of a window this app
 * created, and only while that frame shows the app's own content.
 */
export function isTrustedIpcSender(
  event: IpcEventLike,
  knownWebContentsIds: ReadonlySet<number>,
  trusted: TrustedOrigins = {},
): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame.parent !== null) return false;
  if (!knownWebContentsIds.has(event.sender.id)) return false;
  return isTrustedUrl(frame.url, trusted);
}
