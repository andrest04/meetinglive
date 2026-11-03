import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

// B16: a folder note typed just before the last window closes must reach folders.json.
test.describe.configure({ timeout: 90_000 });

test('a folder note typed right before the window closes is kept', async () => {
  const launched = await launchApp();
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.evaluate(() =>
      window.vozella.invoke('library.createFolder', { name: 'Alpha', parentId: null }),
    );
    await page.getByRole('link', { name: /Library|Biblioteca/ }).click();
    await page.getByRole('treeitem', { name: /Alpha/ }).click();
    await page.getByRole('textbox', { name: 'Folder notes' }).fill('typed just before close');

    const exited = new Promise<void>((resolve) => {
      launched.app.process().once('exit', () => {
        resolve();
      });
    });
    await launched.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close();
    });
    await exited;

    const file = path.join(launched.dataRoot, 'meetings', 'folders.json');
    expect(fs.readFileSync(file, 'utf8')).toContain('"note": "typed just before close"');
  } finally {
    fs.rmSync(launched.dataRoot, { recursive: true, force: true });
  }
});
