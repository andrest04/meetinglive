import { describe, expect, it, vi } from 'vitest';
import { WindowScanner } from '../native/window-scanner';
import { FakeWindowLister } from './fake-window-scanner';

describe('WindowScanner over a fake lister', () => {
  it('is true when one window is a meeting call', async () => {
    const lister = new FakeWindowLister([
      { processName: 'notepad', title: 'notes' },
      { processName: 'Zoom', title: 'Zoom Meeting' },
    ]);
    await expect(new WindowScanner(lister).anyMeetingWindow()).resolves.toBe(true);
  });

  it('is false when no window is a call', async () => {
    const lister = new FakeWindowLister([
      { processName: 'chrome', title: 'Inbox' },
      { processName: 'teams', title: 'Calls | Microsoft Teams' },
    ]);
    await expect(new WindowScanner(lister).anyMeetingWindow()).resolves.toBe(false);
  });

  it('is false for an empty window list', async () => {
    await expect(new WindowScanner(new FakeWindowLister()).anyMeetingWindow()).resolves.toBe(false);
  });

  it('skips windows with an empty title or process name', async () => {
    const lister = new FakeWindowLister([
      { processName: 'cpthost', title: '' },
      { processName: '', title: 'Zoom Meeting' },
    ]);
    await expect(new WindowScanner(lister).anyMeetingWindow()).resolves.toBe(false);
  });

  it('stops at the first match, whatever follows it', async () => {
    const trap = {
      get processName(): string {
        throw new Error('read past the first match');
      },
      title: 'x',
    };
    const lister = new FakeWindowLister([{ processName: 'cpthost', title: 'a' }, trap]);
    await expect(new WindowScanner(lister).anyMeetingWindow()).resolves.toBe(true);
  });

  it('swallows a listing failure as false and reports it once', async () => {
    const lister = new FakeWindowLister([{ processName: 'cpthost', title: 'a' }]);
    lister.failWith = new Error('EnumWindows failed');
    const onError = vi.fn();
    await expect(new WindowScanner(lister, onError).anyMeetingWindow()).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('swallows a non-Error rejection', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const scanner = new WindowScanner({ listWindows: () => Promise.reject('boom') });
    await expect(scanner.anyMeetingWindow()).resolves.toBe(false);
  });
});
