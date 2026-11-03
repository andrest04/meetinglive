import { sendFailedFailure, tryParseMeetingLink } from '@vozella/core';
import { useCallback, useRef, type MouseEvent } from 'react';
import { toCoreT } from './chat-core-t';
import { useT } from '../../i18n/I18nProvider';

export type ChatLinkTarget =
  | { readonly kind: 'meeting'; readonly meetingId: string }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'ignored' };

function decoded(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** A citation to a meeting, a web address for the system browser, or anything else (ignored). */
export function classifyChatLink(href: string): ChatLinkTarget {
  // The Markdown reader normalizes addresses, so a braced id arrives as %7B...%7D.
  const meetingId = tryParseMeetingLink(decoded(href));
  if (meetingId !== null) return { kind: 'meeting', meetingId };
  try {
    const url = new URL(href.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'external', url: url.href };
    }
  } catch {
    // Not an address at all.
  }
  return { kind: 'ignored' };
}

/**
 * Click handler for links inside an answer. The page never navigates by itself: a citation selects
 * the meeting and opens its Summary tab, a web link goes to the system browser, and every failure
 * is reported through `report` (the chat error notice). Works while the answer still streams.
 */
export function useChatLinks(report: (message: string) => void) {
  const t = useT();
  const latest = useRef({ report, t });
  latest.current = { report, t };

  return useCallback((href: string, event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    const target = classifyChatLink(href);
    if (target.kind === 'ignored') return;
    void (async () => {
      try {
        if (target.kind === 'meeting') {
          const found = await window.vozella.invoke('chat.meetingExists', {
            meetingId: target.meetingId,
          });
          if (!found.exists || found.meetingId === null) {
            latest.current.report(latest.current.t('Chat_MeetingLinkMissing'));
            return;
          }
          await window.vozella.invoke('workspace.dispatch', {
            action: { type: 'selectMeeting', id: found.meetingId },
          });
          await window.vozella.invoke('workspace.dispatch', {
            action: { type: 'openSession', tab: 'Summary' },
          });
          return;
        }
        const opened = await window.vozella.invoke('chat.openExternal', { url: target.url });
        if (opened.status === 'failed') {
          latest.current.report(
            sendFailedFailure(new Error(opened.detail), toCoreT(latest.current.t)).message,
          );
        }
      } catch (error) {
        latest.current.report(sendFailedFailure(error, toCoreT(latest.current.t)).message);
      }
    })();
  }, []);
}
