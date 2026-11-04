import { describe, expect, it } from 'vitest';
import {
  CALL_POLL_INTERVAL_MS,
  CallWatcher,
  type Scheduler,
  type CallWatcherPorts,
} from './call-watcher';

class FakeScheduler implements Scheduler {
  callback: (() => void) | null = null;
  intervalMs = 0;
  cleared = false;
  setInterval(callback: () => void, intervalMs: number): () => void {
    this.callback = callback;
    this.intervalMs = intervalMs;
    return () => {
      this.cleared = true;
      this.callback = null;
    };
  }
}

function setup(opts: { popup?: () => Promise<boolean> } = {}) {
  const scan = { found: false, fail: false, gate: null as Promise<void> | null };
  const ws = { isCaptureActive: false, offers: 0, offerThrows: false };
  const events: string[] = [];
  const logs: string[] = [];
  const metas: unknown[] = [];
  const scheduler = new FakeScheduler();
  const ports: CallWatcherPorts = {
    scanner: {
      async anyMeetingWindow() {
        if (scan.gate) await scan.gate;
        if (scan.fail) throw new Error('scan failed');
        return scan.found;
      },
    },
    workspace: {
      get state() {
        return { isCaptureActive: ws.isCaptureActive };
      },
      offerCallPrompt() {
        ws.offers++;
        if (ws.offerThrows) throw new Error('offer failed');
      },
    },
    settings: { readMeetingPopupEnabled: opts.popup ?? (async () => true) },
    scheduler,
    logger: {
      debug: (m) => logs.push(m),
      info: (m) => logs.push(m),
      warn: (m, meta) => {
        logs.push(m);
        metas.push(meta);
      },
      error: (m) => logs.push(m),
    },
  };
  const watcher = new CallWatcher(ports);
  watcher.on('meetingDetected', () => events.push('detected'));
  watcher.on('meetingEnded', () => events.push('ended'));
  return { watcher, scan, ws, events, logs, metas, scheduler };
}

describe('CallWatcher', () => {
  it('C1: polls every 5 s through the injected scheduler', () => {
    const { watcher, scheduler } = setup();
    expect(CALL_POLL_INTERVAL_MS).toBe(5000);
    watcher.start();
    expect(scheduler.intervalMs).toBe(5000);
    watcher.stop();
    expect(scheduler.cleared).toBe(true);
  });

  it('C6: offers once per call and re-arms only after no window', async () => {
    const { watcher, scan, ws, events } = setup();
    scan.found = true;
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    expect(ws.offers).toBe(1);
    expect(events).toEqual(['detected']);
    scan.found = false;
    await watcher.tick();
    scan.found = true;
    await watcher.tick();
    expect(ws.offers).toBe(2);
    expect(events).toEqual(['detected', 'ended', 'detected']);
  });

  it('C7: a call found while recording stays quiet even after recording stops', async () => {
    const { watcher, scan, ws, events } = setup();
    ws.isCaptureActive = true;
    scan.found = true;
    await watcher.tick();
    ws.isCaptureActive = false;
    await watcher.tick();
    expect(ws.offers).toBe(0);
    expect(events).toEqual([]);
    scan.found = false;
    await watcher.tick();
    expect(events).toEqual(['ended']);
  });

  it('C8: offers the in-app prompt even when the popup setting is off', async () => {
    const { watcher, scan, ws, events } = setup({ popup: async () => false });
    scan.found = true;
    await watcher.tick();
    expect(ws.offers).toBe(1);
    expect(events).toEqual([]);
  });

  it('C9: the popup is raised only if enabled and not recording', async () => {
    const off = setup({ popup: async () => false });
    off.scan.found = true;
    await off.watcher.tick();
    expect(off.events).toEqual([]);
    const on = setup();
    on.scan.found = true;
    await on.watcher.tick();
    expect(on.events).toEqual(['detected']);
  });

  it('C9: recording that starts while the setting is read suppresses the popup', async () => {
    const ctx = setup();
    ctx.scan.found = true;
    const original = ctx.watcher as unknown as { ports: CallWatcherPorts };
    original.ports.settings.readMeetingPopupEnabled = async () => {
      ctx.ws.isCaptureActive = true;
      return true;
    };
    await ctx.watcher.tick();
    expect(ctx.ws.offers).toBe(1);
    expect(ctx.events).toEqual([]);
  });

  it('C10: ended is raised when windows vanish after an offer, even with the popup off', async () => {
    const { watcher, scan, events } = setup({ popup: async () => false });
    scan.found = true;
    await watcher.tick();
    scan.found = false;
    await watcher.tick();
    await watcher.tick();
    expect(events).toEqual(['ended']);
  });

  it('C10: nothing is raised when no call was ever seen', async () => {
    const { watcher, events } = setup();
    await watcher.tick();
    expect(events).toEqual([]);
  });

  it('C11: a failure after disarming re-arms and the next tick retries', async () => {
    const { watcher, scan, ws, events } = setup();
    scan.found = true;
    ws.offerThrows = true;
    await watcher.tick();
    expect(events).toEqual([]);
    ws.offerThrows = false;
    await watcher.tick();
    expect(ws.offers).toBe(2);
    expect(events).toEqual(['detected']);
  });

  it('C12: a settings read failure defaults the popup to on', async () => {
    const { watcher, scan, events } = setup({
      popup: async () => {
        throw new Error('settings broken');
      },
    });
    scan.found = true;
    await watcher.tick();
    expect(events).toEqual(['detected']);
  });

  it('C13: a scanner failure never throws and leaves the watcher armed', async () => {
    const { watcher, scan, ws, events } = setup();
    scan.fail = true;
    await expect(watcher.tick()).resolves.toBeUndefined();
    scan.fail = false;
    scan.found = true;
    await watcher.tick();
    expect(ws.offers).toBe(1);
    expect(events).toEqual(['detected']);
  });

  it('C13: an overlapping tick is dropped', async () => {
    const { watcher, scan, ws } = setup();
    scan.found = true;
    let release!: () => void;
    scan.gate = new Promise<void>((r) => (release = r));
    const first = watcher.tick();
    await watcher.tick();
    release();
    await first;
    expect(ws.offers).toBe(1);
  });

  it('C13: a throwing handler does not crash the tick', async () => {
    const { watcher, scan } = setup();
    watcher.on('meetingDetected', () => {
      throw new Error('handler');
    });
    scan.found = true;
    await expect(watcher.tick()).resolves.toBeUndefined();
  });

  it('S6 kept faithful: one missed tick ends the call and the next shows the popup again', async () => {
    const { watcher, scan, events } = setup();
    scan.found = true;
    await watcher.tick();
    scan.found = false;
    await watcher.tick();
    scan.found = true;
    await watcher.tick();
    expect(events).toEqual(['detected', 'ended', 'detected']);
  });

  it('150: a failed tick logs only the error type, never its message', async () => {
    const { watcher, scan, logs, metas } = setup();
    scan.fail = true;
    await watcher.tick();
    expect(logs).toContain('Call watcher tick failed');
    expect(metas).toEqual([{ errorType: 'Error' }]);
    expect(JSON.stringify(metas)).not.toContain('scan failed');
  });

  it('12, 169: stop clears the timer, and a second start after stop polls again', () => {
    const { watcher, scheduler } = setup();
    watcher.start();
    watcher.start();
    expect(scheduler.callback).not.toBeNull();
    watcher.stop();
    expect(scheduler.cleared).toBe(true);
    watcher.stop();
    scheduler.cleared = false;
    watcher.start();
    expect(scheduler.callback).not.toBeNull();
  });

  it('42: the capture flag read as a call is found keeps one call silent for its whole length', async () => {
    const { watcher, scan, ws, events } = setup();
    scan.found = true;
    ws.isCaptureActive = true;
    await watcher.tick();
    ws.isCaptureActive = false;
    await watcher.tick();
    await watcher.tick();
    expect(events).toEqual([]);
    scan.found = false;
    await watcher.tick();
    expect(events).toEqual(['ended']);
    scan.found = true;
    await watcher.tick();
    expect(events).toEqual(['ended', 'detected']);
  });
});
