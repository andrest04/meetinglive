import {
  ACCENT_KEYS,
  ICON_KEYS,
  resolveAccentKey,
  resolveIconKey,
  type AccentKey,
  type FolderNode,
  type IconKey,
} from '@vozella/core';
import {
  BookOpen,
  Briefcase,
  Calendar,
  Flag,
  Folder,
  GraduationCap,
  Globe,
  Heart,
  House,
  Inbox,
  Lock,
  Mail,
  MessageSquare,
  Pin,
  Star,
  Tag,
  Toolbox,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { TreeNode } from '../../ui';

export { ACCENT_KEYS, ICON_KEYS };
export type { AccentKey, IconKey };

/** The 18 icon keys of the spec, drawn with the kit's line icons instead of Segoe Fluent. */
export const FOLDER_ICONS: Readonly<Record<IconKey, LucideIcon>> = {
  folder: Folder,
  briefcase: Briefcase,
  people: Users,
  home: House,
  star: Star,
  heart: Heart,
  flag: Flag,
  globe: Globe,
  lock: Lock,
  calendar: Calendar,
  mail: Mail,
  chat: MessageSquare,
  video: Video,
  book: BookOpen,
  pin: Pin,
  tag: Tag,
  education: GraduationCap,
  toolbox: Toolbox,
};

export const INBOX_NODE_ID = '__inbox__';

/** CSS color for an accent key. The values live in tokens.css, per theme. */
export function accentColor(key: AccentKey): string {
  return `var(--accent-${key})`;
}

export interface FolderLike {
  readonly id: string;
  readonly colorKey: string | null;
  readonly iconKey: string | null;
}

export function folderAccent(folder: FolderLike): string {
  return accentColor(resolveAccentKey(folder.colorKey, folder.id));
}

export function folderIcon(folder: FolderLike): LucideIcon {
  return FOLDER_ICONS[resolveIconKey(folder.iconKey)];
}

/** Inbox first and always virtual, then the real folders as the tree wants them. */
export function buildTreeNodes(tree: readonly FolderNode[], inboxLabel: string): TreeNode[] {
  const toNode = (node: FolderNode): TreeNode => ({
    id: node.folder.id,
    label: node.folder.name,
    icon: folderIcon(node.folder),
    accent: folderAccent(node.folder),
    children: node.children.map(toNode),
  });
  return [{ id: INBOX_NODE_ID, label: inboxLabel, icon: Inbox, accent: null }, ...tree.map(toNode)];
}
