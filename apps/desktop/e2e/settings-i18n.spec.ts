import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

test('the settings page services work in the real app, on a throwaway data root', async () => {
  const launched = await launchApp();
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation', { name: /main|principal/i })).toBeVisible();

    const first = await page.evaluate(() => window.vozella.invoke('settings.getPage', {}));
    expect(first).toMatchObject({
      provider: 'Local',
      transcriptionLanguage: 'es',
      summaryLanguage: 'es',
      // The fake native build supplies the machine, the CLI, and the downloads.
      hardware: { totalRamGb: 16 },
      cliStatus: null,
      capabilities: { localModels: true },
      providerNotice: null,
    });
    // Opening the page wrote nothing.
    expect(fs.existsSync(path.join(launched.dataRoot, 'app', 'settings.json'))).toBe(false);

    // A provider change and a language change are saved one field at a time.
    await page.evaluate(() =>
      window.vozella.invoke('settings.setSummaryProvider', { kind: 'ClaudeCode' }),
    );
    const claude = await page.evaluate(() => window.vozella.invoke('settings.getPage', {}));
    expect(claude).toMatchObject({ provider: 'ClaudeCode', cliStatus: 'detected' });
    const refused = await page.evaluate(() =>
      window.vozella.invoke('settings.setSummaryProvider', { kind: '1' }),
    );
    expect(refused).toEqual({ status: 'ignored', reason: 'invalid' });

    const language = await page.evaluate(() =>
      window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }),
    );
    expect(language).toMatchObject({ status: 'saved' });
    expect(await page.evaluate(() => window.vozella.invoke('i18n.getLocale', {}))).toEqual({
      tag: 'es',
      locale: 'es',
      saved: true,
    });
    const file = JSON.parse(
      fs.readFileSync(path.join(launched.dataRoot, 'app', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(file).toMatchObject({ selectedSummaryProvider: 'ClaudeCode', uiLanguage: 'es' });

    // A model downloads (fake files), becomes active and is removed again.
    const model = 'gemma-4-E2B-it-Q4_K_M.gguf';
    expect(
      await page.evaluate(
        (fileName) => window.vozella.invoke('settings.models.download', { fileName }),
        model,
      ),
    ).toEqual({ status: 'done' });
    expect(
      await page.evaluate(
        (fileName) => window.vozella.invoke('settings.models.select', { fileName }),
        model,
      ),
    ).toMatchObject({ status: 'saved' });
    const withModel = await page.evaluate(() => window.vozella.invoke('settings.getPage', {}));
    expect(withModel.models.rows.find((row) => row.fileName === model)).toMatchObject({
      downloaded: true,
      active: true,
      fit: 'Recommended',
    });
    // Nothing outside the catalog is accepted.
    expect(
      await page.evaluate(() =>
        window.vozella.invoke('settings.models.delete', { fileName: '../../evil.gguf' }),
      ),
    ).toEqual({ status: 'ignored', reason: 'unknown-model' });

    // The xAI channels were removed (owner decision 2026-11-03).
    const xaiAnswer = await page.evaluate(() =>
      (window.vozella.invoke as (name: string, input: unknown) => Promise<unknown>)(
        'settings.xai.refresh',
        {},
      ).then(
        () => 'answered',
        () => 'refused',
      ),
    );
    expect(xaiAnswer).toBe('refused');

    // Restart is asked through the exit gate; nothing is registered, so it would relaunch.
    // The relaunch itself is not exercised here.
  } finally {
    await launched.close();
  }
});

test('a damaged settings file gives defaults and a notice that names where it was kept', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-lang-'));
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'app', 'settings.json'), '{ "uiLanguage": "es" ');
  const launched = await launchApp({ VOZELLA_DATA_ROOT: dataRoot });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation', { name: /main|principal/i })).toBeVisible();
    // The file was damaged: defaults, the OS language, and a notice with where it was kept.
    const view = await page.evaluate(() => window.vozella.invoke('settings.getPage', {}));
    expect(view.settings.uiLanguage).toBeNull();
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.keptAs.endsWith('settings.json.corrupt')).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'app', 'settings.json.corrupt'))).toBe(true);
    await page.evaluate(() =>
      window.vozella.invoke('settings.dismissNotice', { id: 'settings-recovered' }),
    );
    expect(
      (await page.evaluate(() => window.vozella.invoke('settings.getPage', {}))).notices,
    ).toEqual([]);
  } finally {
    await launched.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a settings file that still selects Xai loads, shows the notice and keeps its fields', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-xai-'));
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  const file = path.join(dataRoot, 'app', 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      selectedSummaryProvider: 'Xai',
      selectedXaiModelId: 'grok-4.3',
      futureField: true,
    }),
  );
  const launched = await launchApp({ VOZELLA_DATA_ROOT: dataRoot });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation', { name: /main|principal/i })).toBeVisible();
    const view = await page.evaluate(() => window.vozella.invoke('settings.getPage', {}));
    expect(view).toMatchObject({ provider: 'Xai', providerNotice: 'xai-removed' });
    await page.evaluate(() =>
      window.vozella.invoke('settings.setSummaryProvider', { kind: 'Codex' }),
    );
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      selectedSummaryProvider: 'Codex',
      selectedXaiModelId: 'grok-4.3',
      futureField: true,
    });
  } finally {
    await launched.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a saved language is the language at the next start', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-lang2-'));
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'app', 'settings.json'), '{ "uiLanguage": "es" }');
  const launched = await launchApp({ VOZELLA_DATA_ROOT: dataRoot });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation', { name: /main|principal/i })).toBeVisible();
    expect(await page.evaluate(() => window.vozella.invoke('i18n.getLocale', {}))).toEqual({
      tag: 'es',
      locale: 'es',
      saved: true,
    });
  } finally {
    await launched.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
