import {
  LIVE_QUESTIONS_MODES,
  resolveLiveQuestionsMode,
  type LiveQuestionsMode,
} from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Select, SettingRow } from '../../ui';

const LABELS: Record<LiveQuestionsMode, StringKey> = {
  off: 'Ui_LiveQuestionsOff',
  rules: 'Ui_LiveQuestionsRules',
  'rules+ai': 'Ui_LiveQuestionsRulesAi',
};

const isMode = (value: string): value is LiveQuestionsMode =>
  (LIVE_QUESTIONS_MODES as readonly string[]).includes(value);

/**
 * Live question detection (Off, On, On and checked by the summary engine). It reads the saved
 * value; an unset one shows the default for the current engine and is not written until changed.
 * `selectedProvider` re-reads it, so the default follows a change of engine on the same page.
 */
export function LiveQuestionsSection({ selectedProvider }: { readonly selectedProvider: string }) {
  const t = useT();
  const [mode, setMode] = useState<LiveQuestionsMode | null>(null);
  const alive = useRef(true);

  const read = useCallback(async () => {
    try {
      const settings = await window.vozella.invoke('settings.get', {});
      if (alive.current) setMode(resolveLiveQuestionsMode(settings));
    } catch {
      // The select stays disabled until a read works.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read, selectedProvider]);

  const change = (value: string): void => {
    if (!isMode(value)) return;
    setMode(value);
    window.vozella
      .invoke('settings.update', { patch: { liveQuestions: value } })
      .then(
        (saved) => {
          if (alive.current) setMode(resolveLiveQuestionsMode(saved));
        },
        () => read(),
      )
      .catch(() => undefined);
  };

  return (
    <div data-testid="live-questions-section">
      <SettingRow
        title={t('Ui_LiveQuestionsHeader')}
        description={t('Ui_LiveQuestionsDescription')}
      >
        {() => (
          <Select
            testId="SelectLiveQuestions"
            label={t('Ui_LiveQuestionsLabel')}
            value={mode}
            disabled={mode === null}
            options={LIVE_QUESTIONS_MODES.map((value) => ({ value, label: t(LABELS[value]) }))}
            onValueChange={change}
          />
        )}
      </SettingRow>
    </div>
  );
}
