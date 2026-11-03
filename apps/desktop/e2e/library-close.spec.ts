import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

/** Posts WM_CLOSE to every top-level window of a process, as the title bar's X does. */
const POST_WM_CLOSE = (pid: number | undefined): string => `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int Close(uint pid) {
    int n = 0;
    EnumWindows((h, l) => {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == pid && PostMessage(h, 0x10, IntPtr.Zero, IntPtr.Zero)) n++;
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
'@
[W]::Close(${String(pid)})
`;

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

// Item 110: the window's own close button sends WM_CLOSE to the window. `Process.CloseMainWindow`
// posts exactly that message to the process's main window, so this is the same path as a
// click on the title bar's X, unlike BrowserWindow.close() which skips the OS message.
test('a folder note typed right before the close button is pressed is kept', async () => {
  test.skip(process.platform !== 'win32', 'WM_CLOSE is a Windows message');
  const launched = await launchApp();
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.evaluate(() =>
      window.vozella.invoke('library.createFolder', { name: 'Beta', parentId: null }),
    );
    await page.getByRole('link', { name: /Library|Biblioteca/ }).click();
    await page.getByRole('treeitem', { name: /Beta/ }).click();
    await page.getByRole('textbox', { name: 'Folder notes' }).fill('typed before the X');

    const pid = launched.app.process().pid;
    expect(pid).toBeGreaterThan(0);
    const exited = new Promise<void>((resolve) => {
      launched.app.process().once('exit', () => {
        resolve();
      });
    });
    const closed = execFileSync('powershell.exe', ['-NoProfile', '-Command', POST_WM_CLOSE(pid)], {
      encoding: 'utf8',
    });
    if (Number(closed.trim()) === 0) {
      // No desktop window to receive the message (a session without an interactive desktop).
      await launched.app.close();
      test.skip(true, 'no top-level window was reachable to receive WM_CLOSE');
    }
    await exited;

    const file = path.join(launched.dataRoot, 'meetings', 'folders.json');
    expect(fs.readFileSync(file, 'utf8')).toContain('"note": "typed before the X"');
  } finally {
    try {
      fs.rmSync(launched.dataRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    } catch {
      // A helper process of the closed app can hold the folder a moment; it is only a temp folder.
    }
  }
});
