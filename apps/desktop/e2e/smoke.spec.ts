import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched.close();
});

test('the app starts, is isolated, and answers over the typed contract', async () => {
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Vozella' })).toBeVisible();

  // Renderer reached main through app.getInfo, validated at both ends.
  await expect(page.getByTestId('app-version')).toContainText('Electron 45.2.1');
  const info = await page.evaluate(() => window.vozella.invoke('app.getInfo', {}));
  expect(info).toMatchObject({
    fakeNative: true,
    isPackaged: Boolean(process.env.VOZELLA_E2E_EXECUTABLE),
  });
  expect(info.dataRoot.source).toBe('env');
  expect(info.dataRoot.appData.startsWith(launched.dataRoot)).toBe(true);

  // Invalid input is rejected before it leaves the page.
  const rejected = await page.evaluate(async () => {
    try {
      await window.vozella.invoke('app.getInfo', { extra: 1 } as never);
      return 'accepted';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(rejected).toContain('invalid-input');

  // Isolation: no Node in the page, only the typed API on the bridge.
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    bridge: Object.keys(window.vozella).sort(),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    ipcRenderer: 'undefined',
    bridge: ['invoke', 'on'],
  });

  // CSP is in force: inline script is blocked.
  const inlineRan = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inline = true';
    document.head.appendChild(script);
    return (window as unknown as { __inline?: boolean }).__inline === true;
  });
  expect(inlineRan).toBe(false);

  // The fake native worker answers through the utilityProcess round trip.
  const selfTest = await page.evaluate(() =>
    window.vozella.invoke('diagnostics.nativeSelfTest', {}),
  );
  expect(selfTest).toEqual({ backend: 'fake', platformSupported: true });

  // The data root guard and logging: files land under the temp root only.
  const logFile = path.join(launched.dataRoot, 'app', 'logs', 'main.log');
  await expect.poll(() => fs.existsSync(logFile)).toBe(true);
  expect(fs.readFileSync(logFile, 'utf8')).toContain('window ready');
});

test('navigation and new windows are blocked', async () => {
  const page = await launched.app.firstWindow();
  const before = page.url();

  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);

  const popup = await page.evaluate(() => window.open('https://example.com/') === null);
  expect(popup).toBe(true);
  expect(launched.app.windows()).toHaveLength(1);
});

test('the real Rust addon loads inside the audio utilityProcess', async () => {
  const real = await launchApp({ VOZELLA_FAKE_NATIVE: '0' });
  try {
    const page = await real.app.firstWindow();
    const selfTest = await page.evaluate(() =>
      window.vozella.invoke('diagnostics.nativeSelfTest', {}),
    );
    expect(selfTest).toEqual({ backend: 'native', platformSupported: true });
  } finally {
    await real.close();
  }
});
