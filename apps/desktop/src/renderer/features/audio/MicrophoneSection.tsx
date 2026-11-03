import type { MicrophoneOptionDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Meter, SectionHeader, SettingRow, Select } from '../../ui';
import { useMicrophonePreview } from './use-microphone-preview';

/** The "System default" row has the empty id in the spec (2.5); the select needs a non-empty value for it. */
const DEFAULT_VALUE = '__system-default__';

/**
 * Settings, Microphone: the device that recordings use unless the Record page says otherwise,
 * with a live level so the choice can be checked. The level runs only while the page is open.
 */
export function MicrophoneSection() {
  const t = useT();
  const [devices, setDevices] = useState<readonly MicrophoneOptionDto[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [settingsRead, setSettingsRead] = useState(false);
  const [devicesRead, setDevicesRead] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);

  const loadDevices = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    window.vozella.invoke('audio.microphones.load', { userChoice: null }).then(
      (loaded) => {
        if (!alive.current || mine !== generation.current) return;
        setDevices(loaded.options.filter((option) => option.kind === 'Device'));
        setDevicesRead(true);
      },
      () => {
        // No list: only System default remains.
        if (alive.current) setDevicesRead(true);
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    loadDevices();
    window.vozella.invoke('settings.get', {}).then(
      (settings) => {
        if (!alive.current) return;
        setSaved(settings.selectedMicrophoneDeviceId);
        setSettingsRead(true);
      },
      () => {
        if (alive.current) setSettingsRead(true);
      },
    );
    return () => {
      alive.current = false;
    };
  }, [loadDevices]);

  // Both answers are needed: with only the saved id the select would read System default and the
  // preview would open the default input first, then move to the saved one.
  const ready = settingsRead && devicesRead;

  // A saved device that is not plugged in reads as System default, as the list shows it.
  const value =
    saved !== null && devices.some((device) => device.deviceId === saved) ? saved : DEFAULT_VALUE;
  const level = useMicrophonePreview(value === DEFAULT_VALUE ? null : value, ready);

  const options = [
    { value: DEFAULT_VALUE, label: t('Microphone_SystemDefault') },
    ...devices.map((device) => ({ value: device.deviceId ?? '', label: device.name ?? '' })),
  ];

  const choose = (next: string): void => {
    if (next === value) return;
    const id = next === DEFAULT_VALUE ? null : next;
    setSaved(id);
    window.vozella
      .invoke('settings.update', { patch: { selectedMicrophoneDeviceId: id } })
      .catch(() => {
        // The next read shows what is saved.
      });
  };

  return (
    <div data-testid="microphone-section">
      <SectionHeader level={2} compact title={t('Settings_Microphone.Text')} className="pb-2" />
      <SettingRow title={t('Ui_MicDefaultTitle')} description={t('Ui_MicDefaultDescription')}>
        <Select
          label={t('Ui_MicDefaultTitle')}
          value={ready ? value : null}
          options={options}
          placeholder={t('ComboMicrophoneDevice.PlaceholderText')}
          onOpenChange={(open) => {
            if (open) loadDevices();
          }}
          onValueChange={choose}
          className="w-64"
        />
      </SettingRow>
      <SettingRow title={t('Settings_MicLevel.Text')}>
        <Meter value={level} label={t('Settings_MicLevel.Text')} className="w-64" />
      </SettingRow>
    </div>
  );
}
