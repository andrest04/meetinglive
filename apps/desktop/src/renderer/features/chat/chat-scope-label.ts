import type { ChatScopeDecision, ChatScopeKind } from '@vozella/core';
import { FileText, Folder, Layers, Radio, type LucideIcon } from 'lucide-react';
import type { Translate } from '../../i18n/translate';

/** Four distinct glyphs, same meaning as the WinUI ones (spec 2.1, item 7). */
export const SCOPE_ICON: Readonly<Record<ChatScopeKind, LucideIcon>> = {
  Live: Radio,
  Meeting: FileText,
  Folder,
  AllMeetings: Layers,
};

/** The name is a meeting title or a folder name. Blank counts as missing. */
export function scopeLabel(
  t: Translate,
  decision: Pick<ChatScopeDecision, 'isVisible' | 'kind'>,
  name: string | null,
): string {
  if (!decision.isVisible) return '';
  const named = name !== null && name.trim() !== '' ? name : null;
  switch (decision.kind) {
    case 'Live':
      return t('Chat_ScopeLive');
    case 'Meeting':
      return named === null ? t('Chat_ScopeMeeting') : t('Chat_ScopeMeetingNamed', named);
    case 'Folder':
      return named === null ? t('Chat_ScopeFolder') : t('Chat_ScopeFolderNamed', named);
    case 'AllMeetings':
      return t('Chat_ScopeAll');
  }
}
