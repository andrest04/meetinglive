import { useEffect } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { useDialogs } from './dialog-service';

const SHOWN_KEY = 'vozella.startupNoticeShown';

/**
 * Spec 2.1 step 8 (item 9): once the window is up, a failed startup migration is told in a
 * one-button dialog. It carries the exception message, which the WinUI dialog dropped (bug 7).
 * Shown once per launch; the Library page keeps its own notice. Opening the notice is read only,
 * so there is no extra IPC.
 */
export function StartupNotice() {
  const t = useT();
  const dialogs = useDialogs();

  useEffect(() => {
    if (sessionStorage.getItem(SHOWN_KEY) !== null) return;
    let cancelled = false;
    void window.vozella
      .invoke('library.getLocation', {})
      .then((location) => {
        if (cancelled || location.startupError === null) return;
        sessionStorage.setItem(SHOWN_KEY, '1');
        return dialogs.error({
          title: t('MigrationFailed_Title'),
          closeText: t('Dialog_OK'),
          content: (
            <p className="text-ui-lg whitespace-pre-line text-ink-muted">
              {t('MigrationFailed_Content', location.startupError).replace(/\r\n/g, '\n')}
            </p>
          ),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The check runs once per mount; the language at that moment is the one shown.
  }, []);

  return null;
}
