import type { UiLanguageTag } from '@vozella/core';
import { UI_LANGUAGE_OPTIONS } from '@vozella/core';
import { useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Notice, SectionHeader, Select, SettingRow } from '../../ui';

/**
 * The language of Vozella's own screens. The choice is saved first and the windows switch at once;
 * the prompt offers a restart for the parts that read the language only at start (spec 2.1).
 */
export function LanguageSection({
  current,
  onChange,
}: {
  current: UiLanguageTag | null;
  onChange: (tag: string) => Promise<boolean>;
}) {
  const t = useT();
  const [prompt, setPrompt] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const restartRef = useRef<HTMLButtonElement | null>(null);

  const choose = async (tag: string): Promise<void> => {
    if (tag === current) return;
    setProblem(null);
    if (await onChange(tag)) setPrompt(true);
  };

  const restart = async (): Promise<void> => {
    setRestarting(true);
    try {
      const result = await window.vozella.invoke('app.restart', {});
      // A refused gate (a recording is running) leaves everything as it was, and says so.
      if (result.status === 'refused') setProblem(t('Ui_RestartRefused'));
      else if (result.status === 'failed') setProblem(t('Ui_RestartFailed', result.message));
    } catch (error) {
      setProblem(t('Ui_RestartFailed', error instanceof Error ? error.message : String(error)));
    } finally {
      setRestarting(false);
      setPrompt(false);
    }
  };

  return (
    <div>
      <SectionHeader level={2} compact title={t('Settings_Language.Text')} className="pb-2" />
      {problem ? (
        <Notice
          tone="warning"
          className="mb-2"
          onDismiss={() => {
            setProblem(null);
          }}
          dismissLabel={t('Ui_Close')}
        >
          {problem}
        </Notice>
      ) : null}
      <SettingRow
        title={t('Settings_LanguagePicker.Header')}
        description={t('Settings_LanguagePicker.Description')}
      >
        <Select
          label={t('Settings_LanguagePicker.Header')}
          value={current}
          onValueChange={(tag) => {
            void choose(tag);
          }}
          options={UI_LANGUAGE_OPTIONS.map((option) => ({
            value: option.tag,
            label: t(option.labelKey),
          }))}
        />
      </SettingRow>
      <Dialog
        open={prompt}
        onOpenChange={setPrompt}
        title={t('SettingsLanguageRestart_Title')}
        description={t('SettingsLanguageRestart_Content')}
        closeLabel={t('Ui_Close')}
        initialFocus={restartRef}
        actions={
          <>
            <Button
              variant="quiet"
              onClick={() => {
                setPrompt(false);
              }}
            >
              {t('SettingsLanguageRestart_Later')}
            </Button>
            <Button
              ref={restartRef}
              variant="primary"
              disabled={restarting}
              onClick={() => {
                void restart();
              }}
            >
              {t('SettingsLanguageRestart_RestartNow')}
            </Button>
          </>
        }
      />
    </div>
  );
}
