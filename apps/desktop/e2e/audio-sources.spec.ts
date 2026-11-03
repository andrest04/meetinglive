import axe from 'axe-core';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_APPS } from './fake-audio-apps';
import { launchApp, type LaunchedApp } from './launch';

// The audio-capture pages in the real window on the fake native build: a fake microphone
// list, and fake apps that "play" audio through VOZELLA_FAKE_AUDIO_APPS. No real device,
// no real call app, and a throwaway data root.

let launched: LaunchedApp;
let page: Page;

const settingsFile = (): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(launched.dataRoot, 'app', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;

/** The row of a card: the radio is the small circle, the words and the meter sit beside it. */
const cardRow = (name: RegExp) =>
  page
    .getByRole('radiogroup', { name: /Meeting audio|Audio de la reunión/ })
    .locator(':scope > div')
    .filter({ has: page.getByRole('radio', { name }) });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_FAKE_AUDIO_APPS: FAKE_APPS });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Sources' })).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

test('the Record page lists the microphones and remembers the pick', async () => {
  const combo = page.getByRole('combobox', { name: 'Microphone' });
  await expect(combo).toContainText('System default');
  await combo.click();
  await expect(page.getByRole('option')).toHaveText([
    'None',
    'System default',
    'Test microphone',
    'Test headset',
  ]);
  await page.getByRole('option', { name: 'Test headset' }).click();
  await expect(combo).toContainText('Test headset');
  await expect(page.getByTestId('sources-summary')).toHaveText(
    'Mic: Test headset · Audio: All system audio',
  );
  await expect.poll(() => settingsFile().recordMicrophoneKind).toBe('Device');
  expect(settingsFile().recordMicrophoneDeviceId).toBe('fake-mic-2');
});

test('the idle level moves while a microphone is chosen and rests on None', async () => {
  const meter = page.getByRole('meter', { name: 'Microphone level' });
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  const combo = page.getByRole('combobox', { name: 'Microphone' });
  await combo.click();
  await page.getByRole('option', { name: 'None' }).click();
  await expect(meter).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(() => settingsFile().recordMicrophoneKind).toBe('None');
  await combo.click();
  await page.getByRole('option', { name: 'System default' }).click();
  await expect(combo).toContainText('System default');
});

test('apps that play audio get cards with their tags', async () => {
  const group = page.getByRole('radiogroup', { name: 'Meeting audio' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await expect(group.getByRole('radio', { name: /All system audio/ })).toBeChecked();
  await expect(cardRow(/Zoom Workplace/)).toContainText('Detected');
  await expect(cardRow(/Google Chrome/)).toContainText('Records all tabs');
  await expect(page.getByText('Play audio in your meeting app to pick it here')).toHaveCount(0);
  await expect(group.getByRole('meter', { name: 'Zoom Workplace' })).toHaveAttribute(
    'aria-valuenow',
    /^[1-9]\d*$/,
  );
});

test('picking a card selects the app and remembers it', async () => {
  await page.getByRole('radio', { name: /Zoom Workplace/ }).click();
  const zoom = page.getByRole('radio', { name: /Zoom Workplace/ });
  await expect(zoom).toBeChecked();
  await expect(page.getByTestId('sources-summary')).toContainText('Audio: Zoom Workplace');
  await expect.poll(() => settingsFile().recordOutputKind).toBe('App');
  expect(settingsFile().recordAppExePath).toBe('C:\\Fake\\Zoom.exe');
});

test('the cards work from the keyboard', async () => {
  const zoom = page.getByRole('radio', { name: /Zoom Workplace/ });
  await zoom.focus();
  // Cards are sorted by name, so the one above Zoom Workplace is the music player.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /Music player/ })).toBeChecked();
  await expect.poll(() => settingsFile().recordAppExePath).toBe('C:\\Fake\\player.exe');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /Google Chrome/ })).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /All system audio/ })).toBeChecked();
  await expect.poll(() => settingsFile().recordOutputKind).toBe('System');
});

test('the Settings page picks the default microphone and shows its level', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Microphone' })).toBeVisible();
  const combo = page.getByRole('combobox', { name: 'Default microphone' });
  await expect(combo).toContainText('System default');
  await combo.click();
  await expect(page.getByRole('option')).toHaveText([
    'System default',
    'Test microphone',
    'Test headset',
  ]);
  await page.getByRole('option', { name: 'Test microphone' }).click();
  await expect(combo).toContainText('Test microphone');
  await expect.poll(() => settingsFile().selectedMicrophoneDeviceId).toBe('fake-mic-1');
  const meter = page.getByRole('meter', { name: 'Microphone level' });
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`no serious accessibility violations on the Record sources in ${theme}`, async () => {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await page.evaluate(() => {
      window.location.hash = '#/record';
    });
    await expect(page.getByTestId('sources-panel')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Zoom/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(axe.source);
    const results = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      serious.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      })),
    ).toEqual([]);
  });
}

test('the Spanish names come from the catalog', async () => {
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
  await expect(page.getByRole('heading', { level: 2, name: 'Fuentes' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Micrófono' })).toContainText(
    'Predeterminado del sistema',
  );
  await expect(page.getByTestId('sources-summary')).toContainText('Micrófono:');
  await expect(page.getByRole('radio', { name: /Todo el audio del sistema/ })).toBeVisible();
  await expect(cardRow(/Zoom Workplace/)).toContainText('Detectada');
  await expect(cardRow(/Google Chrome/)).toContainText('Graba todas las pestañas');
});
