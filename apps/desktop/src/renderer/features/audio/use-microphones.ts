import type { MicrophoneChoiceDto, MicrophoneOptionDto } from '@vozella/contracts';
import { sameMicrophoneOptions } from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';

const FALLBACK_OPTIONS: readonly MicrophoneOptionDto[] = [
  { kind: 'None', deviceId: null, name: null },
  { kind: 'SystemDefault', deviceId: null, name: null },
];

const SYSTEM_DEFAULT: MicrophoneChoiceDto = { kind: 'SystemDefault', deviceId: null };

export interface MicrophonesModel {
  readonly options: readonly MicrophoneOptionDto[];
  /** Null until the first answer. */
  readonly selected: MicrophoneChoiceDto | null;
  /** The user's pick: remembered, and kept over later reloads. */
  readonly choose: (choice: MicrophoneChoiceDto) => void;
  /** Reads the devices again. Called when the page is shown and when the dropdown opens. */
  readonly reload: () => void;
}

/**
 * The Record page microphone list (spec 2.1). A reload that yields the same list keeps the
 * current array so an open dropdown is not rebuilt, a stale answer (a newer reload started, or
 * the page left) is dropped, and a failed load leaves only None and System default.
 */
export function useMicrophones(): MicrophonesModel {
  const [options, setOptions] = useState<readonly MicrophoneOptionDto[]>(FALLBACK_OPTIONS);
  const [selected, setSelected] = useState<MicrophoneChoiceDto | null>(null);
  const generation = useRef(0);
  const touched = useRef<MicrophoneChoiceDto | null>(null);
  const alive = useRef(true);

  const reload = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    const accept = (
      next: readonly MicrophoneOptionDto[],
      pick: MicrophoneChoiceDto | null,
    ): void => {
      if (!alive.current || mine !== generation.current) return;
      setOptions((current) => (sameMicrophoneOptions(current, next) ? current : next));
      if (pick) setSelected(pick);
    };
    window.vozella.invoke('audio.microphones.load', { userChoice: touched.current }).then(
      (loaded) => {
        accept(loaded.options, loaded.selected);
      },
      () => {
        accept(FALLBACK_OPTIONS, touched.current ?? SYSTEM_DEFAULT);
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const choose = useCallback((choice: MicrophoneChoiceDto) => {
    touched.current = choice;
    setSelected(choice);
    window.vozella.invoke('audio.microphones.remember', { choice }).catch(() => {
      // A locked settings file must not break picking.
    });
  }, []);

  return { options, selected, choose, reload };
}
