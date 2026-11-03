import { describe, expect, it, vi } from 'vitest';
import { createAppIconProvider } from './app-icon';

const image = (empty = false) => ({
  isEmpty: () => empty,
  toDataURL: () => 'data:image/png;base64,AA==',
});

describe('createAppIconProvider', () => {
  it('returns the icon as a data URL and asks the system once per executable, ignoring case', async () => {
    const getIcon = vi.fn(() => Promise.resolve(image()));
    const icon = createAppIconProvider(getIcon);
    expect(await icon(String.raw`C:\Apps\Zoom.exe`)).toBe('data:image/png;base64,AA==');
    expect(await icon(String.raw`c:\apps\zoom.EXE`)).toBe('data:image/png;base64,AA==');
    expect(getIcon).toHaveBeenCalledOnce();
  });

  it('gives null for an empty icon or a failure, and remembers it', async () => {
    const getIcon = vi
      .fn()
      .mockResolvedValueOnce(image(true))
      .mockRejectedValueOnce(new Error('x'));
    const icon = createAppIconProvider(getIcon);
    expect(await icon(String.raw`C:\a.exe`)).toBeNull();
    expect(await icon(String.raw`C:\b.exe`)).toBeNull();
    expect(await icon(String.raw`C:\a.exe`)).toBeNull();
    expect(getIcon).toHaveBeenCalledTimes(2);
  });

  it('only reads icons of absolute executable paths', async () => {
    const getIcon = vi.fn(() => Promise.resolve(image()));
    const icon = createAppIconProvider(getIcon);
    expect(await icon('notes.txt')).toBeNull();
    expect(await icon(String.raw`..\evil.exe`)).toBeNull();
    expect(await icon(String.raw`\\server\share\a.exe`)).toBeNull();
    expect(getIcon).not.toHaveBeenCalled();
  });

  it('shares one lookup between simultaneous callers', async () => {
    const getIcon = vi.fn(() => Promise.resolve(image()));
    const icon = createAppIconProvider(getIcon);
    await Promise.all([icon(String.raw`C:\a.exe`), icon(String.raw`C:\a.exe`)]);
    expect(getIcon).toHaveBeenCalledOnce();
  });
});
