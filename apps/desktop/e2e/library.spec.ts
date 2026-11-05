import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

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

test('search reads bodies, and bulk actions report each meeting, through the typed API', async () => {
  const page = await launched.app.firstWindow();
  const location = await page.evaluate(() => window.vozella.invoke('library.getLocation', {}));
  const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];
  for (const [index, id] of ids.entries()) {
    writeMeeting(location.libraryRoot, {
      id,
      title: `Bulk ${String(index)}`,
      recordedAt: `2026-09-0${String(index + 1)}T10:00:00.0000000+00:00`,
      transcript: '[00:01.00-00:02.00] [ Speaker-1 ] Revisión del año fiscal',
    });
  }

  const found = await page.evaluate(() =>
    window.vozella.invoke('library.search', {
      query: 'REVISION ano',
      scope: { kind: 'all' },
      requestId: 1,
    }),
  );
  expect(found).toEqual({
    requestId: 1,
    stale: false,
    hits: [
      { meetingId: ids[1], field: 'transcript', snippet: 'Revisión del año fiscal' },
      { meetingId: ids[0], field: 'transcript', snippet: 'Revisión del año fiscal' },
    ],
  });

  const loaded = await page.evaluate(() => window.vozella.invoke('library.load', {}));
  if (!loaded.ok) throw new Error('load failed');
  expect(loaded.meetings.find((m) => m.id === ids[0])).toMatchObject({
    endedAt: null,
    hasSummary: false,
    hasTranscript: true,
    busy: false,
  });

  const created = await page.evaluate(() =>
    window.vozella.invoke('library.createFolder', { name: 'Bulk', parentId: null }),
  );
  if (!created.ok) throw new Error('create failed');
  const moved = await page.evaluate(
    ([meetingIds, folderId]) =>
      window.vozella.invoke('library.moveMeetings', { meetingIds, folderId }),
    [ids, created.folder.id] as const,
  );
  expect(moved.results).toEqual([
    { meetingId: ids[0], ok: true },
    { meetingId: ids[1], ok: true },
  ]);

  // The fake-native build unlinks instead of using the real Recycle Bin.
  const deleted = await page.evaluate(
    (meetingIds) => window.vozella.invoke('library.deleteMeetings', { meetingIds, mode: 'trash' }),
    ids,
  );
  expect(deleted.results).toEqual([
    { meetingId: ids[0], ok: true },
    { meetingId: ids[1], ok: true },
  ]);
  const after = await page.evaluate(() => window.vozella.invoke('library.load', {}));
  if (!after.ok) throw new Error('load failed');
  expect(after.meetings.filter((m) => ids.includes(m.id))).toEqual([]);
});
