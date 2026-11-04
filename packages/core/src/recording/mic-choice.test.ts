import { describe, expect, it } from 'vitest';
import { resolveMicrophoneChoice, sameMicrophoneChoices } from './mic-choice';

const devices = [
  { id: 'a', name: 'Headset' },
  { id: '', name: 'Ghost' },
  { id: 'b', name: 'Desk mic' },
];
const none = {
  recordMicrophoneKind: null,
  recordMicrophoneDeviceId: null,
  selectedMicrophoneDeviceId: null,
};

describe('resolveMicrophoneChoice (items 20-23)', () => {
  it('orders None, System default, then devices with non-empty ids', () => {
    const { options } = resolveMicrophoneChoice(devices, none);
    expect(options.map((o) => `${o.kind}:${o.deviceId ?? ''}`)).toEqual([
      'None:',
      'SystemDefault:',
      'Device:a',
      'Device:b',
    ]);
  });
  it('restores the remembered kind, and a present device', () => {
    expect(
      resolveMicrophoneChoice(devices, { ...none, recordMicrophoneKind: 'None' }).selected.kind,
    ).toBe('None');
    expect(
      resolveMicrophoneChoice(devices, {
        ...none,
        recordMicrophoneKind: 'Device',
        recordMicrophoneDeviceId: 'b',
      }).selected,
    ).toEqual({ kind: 'Device', deviceId: 'b' });
  });
  it('a vanished remembered device becomes System default, never None', () => {
    const { selected } = resolveMicrophoneChoice(devices, {
      ...none,
      recordMicrophoneKind: 'Device',
      recordMicrophoneDeviceId: 'gone',
    });
    expect(selected.kind).toBe('SystemDefault');
  });
  it('with nothing remembered, the Settings microphone is used if present, else System default', () => {
    expect(
      resolveMicrophoneChoice(devices, { ...none, selectedMicrophoneDeviceId: 'a' }).selected,
    ).toEqual({ kind: 'Device', deviceId: 'a' });
    expect(
      resolveMicrophoneChoice(devices, { ...none, selectedMicrophoneDeviceId: 'gone' }).selected
        .kind,
    ).toBe('SystemDefault');
    expect(resolveMicrophoneChoice(devices, none).selected.kind).toBe('SystemDefault');
  });
  it('keeps the current choice on refresh; a device that left falls back to System default', () => {
    const current = { kind: 'Device', deviceId: 'a' } as const;
    expect(resolveMicrophoneChoice(devices, none, current).selected).toEqual(current);
    expect(resolveMicrophoneChoice([devices[2]!], none, current).selected.kind).toBe(
      'SystemDefault',
    );
    expect(
      resolveMicrophoneChoice(devices, none, { kind: 'None', deviceId: null }).selected.kind,
    ).toBe('None');
  });
  it('an unchanged list compares equal so the open dropdown is not rewritten', () => {
    const a = resolveMicrophoneChoice(devices, none).options;
    const b = resolveMicrophoneChoice(devices, none).options;
    const c = resolveMicrophoneChoice([devices[0]!], none).options;
    expect(sameMicrophoneChoices(a, b)).toBe(true);
    expect(sameMicrophoneChoices(a, c)).toBe(false);
  });
});
