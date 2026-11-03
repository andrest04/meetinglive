import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { SectionHeader, SettingRow, Switch } from '../../ui';

/**
 * The call detection block of Settings (calendar-detection spec 2.4, popup toggle only). It reads
 * the saved value and never writes it back on first paint. A change patches only this field, so
 * the rest of the settings file, calendar fields included, is kept as it is. Main broadcasts the
 * "Never again" choice of the popup, and the toggle follows it.
 */
export function CallDetectionSection() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const alive = useRef(true);

  const read = useCallback(async () => {
    try {
      const settings = await window.vozella.invoke('settings.get', {});
      if (alive.current) setEnabled(settings.meetingPopupEnabled);
    } catch {
      // The toggle stays disabled until a read works.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read();
    const off = window.vozella.on('settings.meetingPopupChanged', (payload) => {
      if (alive.current) setEnabled(payload.enabled);
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [read]);

  const change = (next: boolean): void => {
    setEnabled(next);
    window.vozella
      .invoke('settings.update', { patch: { meetingPopupEnabled: next } })
      .then(
        (saved) => {
          if (alive.current) setEnabled(saved.meetingPopupEnabled);
        },
        () => read(),
      )
      .catch(() => undefined);
  };

  return (
    <div data-testid="call-detection-section">
      <SectionHeader level={2} compact title={t('Settings_Calendar.Text')} className="pb-2" />
      <SettingRow
        title={t('Settings_MeetingPopup.Header')}
        description={t('Settings_MeetingPopup.Description')}
      >
        {({ titleId }) => (
          <Switch
            id="ToggleMeetingPopup"
            aria-labelledby={titleId}
            label={enabled ? t('Ui_SwitchOn') : t('Ui_SwitchOff')}
            checked={enabled ?? false}
            disabled={enabled === null}
            onCheckedChange={change}
          />
        )}
      </SettingRow>
    </div>
  );
}
