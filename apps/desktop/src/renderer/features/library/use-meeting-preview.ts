import type { MeetingRecordDto } from '@vozella/contracts';
import { useEffect, useRef, useState } from 'react';
import { useLibraryStore } from './library-store';

/** Arrow keys pass over rows faster than a file should be read. */
export const PREVIEW_DEBOUNCE_MS = 120;
/** A read faster than this shows no skeleton, so moving between rows does not flicker. */
export const PREVIEW_SKELETON_MS = 150;
const CACHE_SIZE = 16;

export interface MeetingPreviewState {
  /** The last record read. While the next one loads it stays up until the skeleton takes over. */
  readonly record: MeetingRecordDto | null;
  readonly phase: 'idle' | 'ready' | 'waiting' | 'skeleton' | 'unreadable';
}

const IDLE: MeetingPreviewState = { record: null, phase: 'idle' };

/**
 * The record of the row under the cursor. It never tells the workspace: `selectMeeting` emits a
 * scope change, which is right for opening a meeting and wrong for each arrow key.
 */
export function useMeetingPreview(meetingId: string | null): MeetingPreviewState {
  // A finished load is how a change arrives here: every list read replaces this array.
  const listed = useLibraryStore((state) => state.meetings);
  const [state, setState] = useState<MeetingPreviewState>(IDLE);
  const cache = useRef(new Map<string, MeetingRecordDto>());
  const lastListed = useRef(listed);
  const lastId = useRef(meetingId);

  useEffect(() => {
    const changed = lastListed.current !== listed;
    const sameRow = lastId.current === meetingId;
    lastListed.current = listed;
    lastId.current = meetingId;
    if (changed) cache.current.clear();
    if (meetingId === null) {
      setState(IDLE);
      return;
    }
    const known = cache.current.get(meetingId);
    if (known) {
      setState({ record: known, phase: 'ready' });
      return;
    }

    let current = true;
    setState((previous) => ({ record: previous.record, phase: 'waiting' }));
    const skeleton = setTimeout(() => {
      setState((previous) =>
        previous.phase === 'waiting' ? { record: null, phase: 'skeleton' } : previous,
      );
    }, PREVIEW_SKELETON_MS);
    const read = setTimeout(
      () => {
        void window.vozella
          .invoke('library.getMeeting', { id: meetingId })
          .then(({ record }) => {
            if (!current) return;
            clearTimeout(skeleton);
            if (!record) {
              setState({ record: null, phase: 'unreadable' });
              return;
            }
            cache.current.delete(meetingId);
            cache.current.set(meetingId, record);
            const oldest = cache.current.keys().next().value;
            if (cache.current.size > CACHE_SIZE && oldest !== undefined) {
              cache.current.delete(oldest);
            }
            setState({ record, phase: 'ready' });
          })
          .catch(() => {
            if (!current) return;
            clearTimeout(skeleton);
            setState({ record: null, phase: 'unreadable' });
          });
      },
      // The same row read again after a change has no arrows to wait for.
      changed && sameRow ? 0 : PREVIEW_DEBOUNCE_MS,
    );
    return () => {
      current = false;
      clearTimeout(skeleton);
      clearTimeout(read);
    };
  }, [meetingId, listed]);

  return state;
}
