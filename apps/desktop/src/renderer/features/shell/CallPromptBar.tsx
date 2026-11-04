import { useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice } from '../../ui';

/**
 * The in-app call bar (calendar-detection items 111 and 112). Main offers it whenever a call is
 * detected, even if the popup setting is off. It closes when the user closes it, when Take notes is
 * pressed (which also asks for a blank take), and by itself when main reports the call ended or a
 * recording started (bug 5, item 38).
 */
export function CallPromptBar() {
  const t = useT();
  const [offered, setOffered] = useState(false);

  useEffect(
    () =>
      window.vozella.on('workspace.callPromptOffered', () => {
        setOffered(true);
      }),
    [],
  );

  useEffect(
    () =>
      window.vozella.on('workspace.callPromptClosed', () => {
        setOffered(false);
      }),
    [],
  );

  if (!offered) return null;

  const takeNotes = (): void => {
    setOffered(false);
    void window.vozella
      .invoke('workspace.dispatch', { action: { type: 'requestTakeNotes' } })
      .catch(() => undefined);
  };

  return (
    <div id="InfoCallPrompt" className="mb-6">
      <Notice
        onDismiss={() => {
          setOffered(false);
        }}
        dismissLabel={t('Ui_Close')}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="font-medium">{t('CallPrompt_Title')}</p>
            <p className="text-ink-muted">{t('CallPrompt_Body')}</p>
          </div>
          <Button id="BtnCallPromptTakeNotes" variant="primary" size="sm" onClick={takeNotes}>
            {t('CallPrompt_TakeNotes')}
          </Button>
        </div>
      </Notice>
    </div>
  );
}
