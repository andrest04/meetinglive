import type { SourcePickerStateDto } from '@vozella/contracts';
import { useCallback, useEffect, useState } from 'react';

export interface SourcePickerModel {
  /** Null until the first state arrives. */
  readonly state: SourcePickerStateDto | null;
  /** Null selects all system audio. A user pick: it is remembered. */
  readonly select: (processId: number | null) => void;
  readonly dismissSuggestion: (processId: number) => void;
  readonly closeFallback: () => void;
}

/**
 * Main owns the picker (apps, meters, remembered app, suggestion). This hook starts the
 * poller while `active` (page visible, not recording, not processing), shows each state that
 * arrives and sends the user's picks back.
 */
export function useSourcePicker(active: boolean): SourcePickerModel {
  const [state, setState] = useState<SourcePickerStateDto | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const unsubscribe = window.vozella.on('audio.sources.changed', (next) => {
      if (alive) setState(next);
    });
    window.vozella.invoke('audio.sources.start', {}).then(
      (first) => {
        if (alive) setState(first);
      },
      () => {
        // Meters are best effort: the system card stays.
      },
    );
    return () => {
      alive = false;
      unsubscribe();
      window.vozella.invoke('audio.sources.stop', {}).catch(() => {
        // Nothing to undo.
      });
    };
  }, [active]);

  const apply = useCallback((request: Promise<SourcePickerStateDto>) => {
    request.then(setState, () => {
      // The next published state corrects the page.
    });
  }, []);

  const select = useCallback(
    (processId: number | null) => {
      apply(window.vozella.invoke('audio.sources.select', { processId }));
    },
    [apply],
  );
  const dismissSuggestion = useCallback(
    (processId: number) => {
      apply(window.vozella.invoke('audio.sources.dismissSuggestion', { processId }));
    },
    [apply],
  );
  const closeFallback = useCallback(() => {
    apply(window.vozella.invoke('audio.sources.closeFallback', {}));
  }, [apply]);

  return { state, select, dismissSuggestion, closeFallback };
}
