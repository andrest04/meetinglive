import type { FolderRecord } from '@vozella/core';
import { flattenFolderPaths } from '@vozella/core';

export interface Destination {
  /** Null is the Inbox. */
  readonly folderId: string | null;
  readonly path: string;
}

/** Inbox first, then the folder tree depth first as `Parent / Child` (spec 2.2, item 190). */
export function buildDestinations(
  folders: readonly FolderRecord[],
  inboxLabel: string,
  locale: string,
): Destination[] {
  return flattenFolderPaths(folders, inboxLabel, locale);
}

/** The reload keeps the chosen folder while it exists and falls back to the Inbox otherwise. */
export function retainDestination(
  folderId: string | null,
  destinations: readonly Destination[],
): string | null {
  return destinations.some((destination) => destination.folderId === folderId) ? folderId : null;
}

/** The Select works with strings; the Inbox needs a value of its own. */
export const INBOX_VALUE = '__inbox__';
export const toOptionValue = (folderId: string | null): string => folderId ?? INBOX_VALUE;
export const fromOptionValue = (value: string): string | null =>
  value === INBOX_VALUE ? null : value;
