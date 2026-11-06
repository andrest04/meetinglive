import { hasMeetingPrefix, sendFailedFailure, tryParseMeetingCitation } from '@vozella/core';
import { useCallback, useRef, type MouseEvent } from 'react';
import { toCoreT } from './chat-core-t';
import { useT } from '../../i18n/I18nProvider';
import { requestTranscriptReveal } from '../session/transcript-reveal';
import { decodedHref } from '../summaries/markdown';

export type ChatLinkTarget =
  | {
      readonly kind: 'meeting';
      readonly meetingId: string;
      /** A moment of its transcript (T3), or null for the meeting itself. */
      readonly seconds: number | null;
    }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'ignored' };

/**
 * A citation to a meeting (optionally at a moment), a web address for the system browser, or
 * anything else (ignored). A broken meeting citation is ignored too: its fake host must never
 * reach the system browser.
 */
export function classifyChatLink(href: string): ChatLinkTarget {
  // The Markdown reader normalizes addresses, so a braced id arrives as %7B...%7D.
  const link = decodedHref(href).trim();
  const citation = tryParseMeetingCitation(link);
  if (citation !== null) return { kind: 'meeting', ...citation };
  if (hasMeetingPrefix(link)) return { kind: 'ignored' };
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
 * the meeting and opens its Summary tab; a time citation (T3) opens its Transcript tab at that
 * moment instead (the tab highlights the line and plays from there when the meeting has audio).
 * A web link goes to the system browser, and every failure
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
          if (target.seconds !== null) requestTranscriptReveal(found.meetingId, target.seconds);
          await window.vozella.invoke('workspace.dispatch', {
            action: {
              type: 'openSession',
              tab: target.seconds === null ? 'Summary' : 'Transcript',
            },
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
