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

test('the library works end to end through the typed API, on a throwaway data root', async () => {
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation', { name: /main|principal/i })).toBeVisible();

  const location = await page.evaluate(() => window.vozella.invoke('library.getLocation', {}));
  const libraryRoot = path.join(launched.dataRoot, 'meetings');
  expect(location).toMatchObject({ libraryRoot, source: 'env', startupError: null });
  expect(fs.existsSync(path.join(libraryRoot, 'Inbox'))).toBe(true);

  // A folder, its directory, and its note.
  const created = await page.evaluate(() =>
    window.vozella.invoke('library.createFolder', { name: 'Universidad', parentId: null }),
  );
  if (!created.ok) throw new Error('create failed');
  expect(fs.existsSync(path.join(libraryRoot, 'Universidad'))).toBe(true);
  const noted = await page.evaluate(
    (id) => window.vozella.invoke('library.setFolderNote', { id, note: '  Fall term  ' }),
    created.folder.id,
  );
  expect(noted).toMatchObject({ ok: true, folder: { note: 'Fall term' } });

  const duplicate = await page.evaluate(() =>
    window.vozella.invoke('library.createFolder', { name: 'universidad', parentId: null }),
  );
  expect(duplicate).toMatchObject({ ok: false, reason: 'name-taken' });

  const loaded = await page.evaluate(() => window.vozella.invoke('library.load', {}));
  expect(loaded).toMatchObject({ ok: true, folders: [{ name: 'Universidad', note: 'Fall term' }] });
  const folderFile = fs.readFileSync(path.join(libraryRoot, 'folders.json'), 'utf8');
  expect(folderFile.startsWith('[\r\n  {')).toBe(true);

  // Settings: a patch changes one field and the file stays complete.
  await page.evaluate(() =>
    window.vozella.invoke('settings.update', { patch: { uiLanguage: 'en' } }),
  );
  const settings = await page.evaluate(() => window.vozella.invoke('settings.get', {}));
  expect(settings).toMatchObject({ uiLanguage: 'en', typeSafeEnabled: true });
  expect(fs.existsSync(path.join(launched.dataRoot, 'app', 'settings.json'))).toBe(true);

  // The data-root guard: a MeetingLive folder is refused while testing.
  const refused = await page.evaluate(
    (target) => window.vozella.invoke('library.setLocation', { path: target }),
    path.join(launched.dataRoot, 'somewhere', 'MeetingLive'),
  );
  expect(refused).toMatchObject({ status: 'refused', reason: 'forbidden' });

  // Workspace: a session request becomes a navigation event.
  const state = await page.evaluate(() =>
    window.vozella.invoke('workspace.dispatch', {
      action: { type: 'openSession', tab: 'Summary' },
    }),
  );
  expect(state.state.sessionTab).toBe('Summary');
});
