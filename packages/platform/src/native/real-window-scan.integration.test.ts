import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadNativeAddon } from './addon';
import { NativeWindowLister } from './native-adapters';
import { WindowScanner } from './window-scanner';

const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = path.resolve(
  here,
  '..',
  '..',
  '..',
  '..',
  'native',
  'vozella-native',
  'vozella-native.win32-x64-msvc.node',
);

// Only enumerates: no assumption about which windows are open on the machine.
describe.skipIf(process.platform !== 'win32')('window scan against the real addon', () => {
  const addon = loadNativeAddon(addonPath, createRequire(import.meta.url));

  it('lists windows as an array of named, titled entries', async () => {
    const windows = await new NativeWindowLister(addon).listWindows();
    expect(Array.isArray(windows)).toBe(true);
    for (const w of windows) {
      expect(w.title).not.toBe('');
      expect(w.processName).not.toBe('');
      expect(w.processName.toLowerCase().endsWith('.exe')).toBe(false);
    }
  });

  it('answers with a boolean', async () => {
    const answer = await new WindowScanner(new NativeWindowLister(addon)).anyMeetingWindow();
    expect(typeof answer).toBe('boolean');
  });
});
