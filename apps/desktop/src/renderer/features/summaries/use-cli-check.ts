import type { SummaryCliKindDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { CLI_FACTS } from './cli-hint';

export interface CliCheck {
  /** The text under the title: the first miss, then "still not found" after a failed retry. */
  readonly message: string;
  readonly checking: boolean;
  readonly recheck: () => void;
  /** The CLI's display name, for titles. */
  readonly name: string;
}

/**
 * Looks for the CLI on PATH. The check tests PATH only (B32): a CLI that is installed but not
 * signed in is found here and fails later with a classified NotSignedIn message at summarize time.
 * `onFound` is called when a check succeeds; `check` decides which request it sends.
 */
export function useCliCheck(
  kind: SummaryCliKindDto,
  check: (kind: SummaryCliKindDto) => Promise<boolean>,
  onFound: () => void,
  firstMessageKey: 'Cli_NotFound' | 'Cli_NotFoundCheckAgain',
): CliCheck {
  const t = useT();
  const facts = CLI_FACTS[kind];
  const [stillMissing, setStillMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const latest = useRef({ check, onFound });
  latest.current = { check, onFound };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recheck = useCallback((): void => {
    setChecking(true);
    void latest.current
      .check(kind)
      .catch(() => false)
      .then((found) => {
        if (!alive.current) return;
        setChecking(false);
        if (found) latest.current.onFound();
        else setStillMissing(true);
      });
  }, [kind]);

  const message = stillMissing
    ? t('Cli_StillMissing', facts.executable)
    : t(firstMessageKey, facts.executable, t(facts.hintKey));
  return { message, checking, recheck, name: t(facts.nameKey) };
}
