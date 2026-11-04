import type { ShellTag } from '@vozella/core';
import { Library, Mic, Settings, type LucideIcon } from 'lucide-react';
import type { StringKey } from '../../i18n/translate';

export type RailRoute = '/record' | '/library' | '/settings';

export interface NavEntry {
  readonly to: RailRoute;
  readonly label: StringKey;
  readonly icon: LucideIcon;
  /** The automation id of the WinUI NavigationViewItem (spec 2.3). */
  readonly automationId: 'NavItemRecording' | 'NavItemHistory' | 'NavItemSettings';
}

/**
 * Rail order (items 20, 21): Record, Library, then Settings. The labels are catalog keys, so the
 * Settings label follows the app language and never the OS language.
 */
export const NAV: readonly NavEntry[] = [
  { to: '/record', label: 'Nav_Record.Content', icon: Mic, automationId: 'NavItemRecording' },
  { to: '/library', label: 'Nav_History.Content', icon: Library, automationId: 'NavItemHistory' },
  { to: '/settings', label: 'Nav_Settings', icon: Settings, automationId: 'NavItemSettings' },
];

const ROUTE_OF_TAG: Readonly<Record<ShellTag, RailRoute | '/session'>> = {
  Recording: '/record',
  History: '/library',
  Settings: '/settings',
  Session: '/session',
};

export const routeOfTag = (tag: ShellTag): RailRoute | '/session' => ROUTE_OF_TAG[tag];

/** The tag published to the workspace for a path (item 24); null for a path with no tag. */
export function tagOfPath(pathname: string): ShellTag | null {
  const match = (Object.entries(ROUTE_OF_TAG) as [ShellTag, string][]).find(
    ([, route]) => route === pathname,
  );
  return match ? match[0] : null;
}

/** Which rail entry is selected: Session is not on the rail, so Library stays selected (item 26). */
export function railRouteOf(pathname: string): RailRoute | null {
  if (pathname === '/session') return '/library';
  return NAV.find((entry) => entry.to === pathname)?.to ?? null;
}
