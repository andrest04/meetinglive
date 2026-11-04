import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { STARTUP_ORDER, StartupSequence } from './startup-sequence';

function build(automated = false) {
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const showError = vi.fn();
  const exit = vi.fn();
  const sequence = new StartupSequence({
    logger,
    showError,
    describeFailure: (step, detail) => ({ title: `failed ${step}`, content: detail }),
    automated,
    exit,
  });
  return { sequence, logger, showError, exit };
}

describe('StartupSequence', () => {
  it('keeps the spec order: error hooks first, the migration notice last', () => {
    expect(STARTUP_ORDER[0]).toBe('error-hooks');
    expect(STARTUP_ORDER.at(-1)).toBe('startup-notice');
    expect(STARTUP_ORDER.indexOf('watchers')).toBeGreaterThan(STARTUP_ORDER.indexOf('events'));
    expect(STARTUP_ORDER.indexOf('watchers')).toBeGreaterThan(STARTUP_ORDER.indexOf('window'));
  });

  it('index.ts runs the named steps in the order of STARTUP_ORDER (spec 8 item 2)', () => {
    const source = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
    const used = [...source.matchAll(/startup\.run\(\s*'([a-z-]+)'/g)].map((m) => m[1]);
    // The window is created outside a named step; the notice runs last, after the window shows.
    const expected = STARTUP_ORDER.filter((step) => step !== 'window' && used.includes(step));
    expect(used.filter((step, i) => step !== 'window' && used.indexOf(step) === i)).toEqual(
      expected,
    );
    expect(used.indexOf('events')).toBeLessThan(used.indexOf('language'));
    expect(used.indexOf('migrations')).toBeLessThan(used.indexOf('events'));
  });

  it('runs steps in the order given and returns their value', async () => {
    const t = build();
    const a = await t.sequence.run('language', () => 'en');
    const b = await t.sequence.run('window', () => Promise.resolve(2));
    expect([a, b]).toEqual([
      { ok: true, value: 'en' },
      { ok: true, value: 2 },
    ]);
    expect(t.sequence.ran).toEqual(['language', 'window']);
    expect(t.showError).not.toHaveBeenCalled();
  });

  it('logs a failing step with its name and shows one clear message (bug 21)', async () => {
    const t = build();
    const result = await t.sequence.run('window', () => {
      throw new Error('no gpu');
    });
    expect(result.ok).toBe(false);
    expect(t.logger.error).toHaveBeenCalledWith('startup step failed', {
      step: 'window',
      error: 'no gpu',
    });
    expect(t.showError).toHaveBeenCalledWith({ title: 'failed window', content: 'no gpu' });
    expect(t.sequence.failures).toEqual(['window']);
  });

  it('shows only the first failure; the next ones are logged', async () => {
    const t = build();
    await t.sequence.run('window', () => Promise.reject(new Error('one')));
    await t.sequence.run('events', () => Promise.reject(new Error('two')));
    expect(t.showError).toHaveBeenCalledOnce();
    expect(t.logger.error).toHaveBeenCalledTimes(2);
  });

  it('a silent step is logged and never shown (call detection is a convenience)', async () => {
    const t = build();
    await t.sequence.run('watchers', () => Promise.reject(new Error('no addon')), {
      silent: true,
    });
    expect(t.showError).not.toHaveBeenCalled();
    expect(t.logger.error).toHaveBeenCalled();
  });

  it('a fatal step ends the app after the message', async () => {
    const t = build();
    await t.sequence.run('migrations', () => Promise.reject(new Error('disk')), { fatal: true });
    expect(t.showError).toHaveBeenCalledOnce();
    expect(t.exit).toHaveBeenCalledWith(1);
  });

  it('automated runs show no native dialog', async () => {
    const t = build(true);
    await t.sequence.run('window', () => Promise.reject(new Error('x')));
    t.sequence.queueNotice({ title: 'n', content: 'c' });
    t.sequence.flushNotice();
    expect(t.showError).not.toHaveBeenCalled();
    expect(t.logger.error).toHaveBeenCalled();
  });

  it('the migration notice waits for the flush and is shown once', () => {
    const t = build();
    t.sequence.queueNotice({ title: 'Migration', content: 'bad' });
    expect(t.showError).not.toHaveBeenCalled();
    t.sequence.flushNotice();
    t.sequence.flushNotice();
    expect(t.showError).toHaveBeenCalledOnce();
    expect(t.showError).toHaveBeenCalledWith({ title: 'Migration', content: 'bad' });
  });

  it('a dialog that throws does not break startup', async () => {
    const t = build();
    t.showError.mockImplementation(() => {
      throw new Error('dialog');
    });
    const result = await t.sequence.run('window', () => Promise.reject(new Error('x')));
    expect(result.ok).toBe(false);
    expect(t.logger.error).toHaveBeenCalledWith('could not show the startup message', {
      error: 'dialog',
    });
  });
});
