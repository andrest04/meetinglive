import { EventEmitter } from 'node:events';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { installGlobalErrorHandling } from './global-errors';

function setup() {
  const emitter = new EventEmitter();
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const showFatal = vi.fn();
  const exit = vi.fn();
  installGlobalErrorHandling(emitter, { logger, showFatal, exit });
  return { emitter, logger, showFatal, exit };
}

describe('installGlobalErrorHandling', () => {
  it('logs, shows and exits once on an uncaught exception', () => {
    const { emitter, logger, showFatal, exit } = setup();
    emitter.emit('uncaughtException', new Error('boom'), 'uncaughtException');
    emitter.emit('uncaughtException', new Error('again'), 'uncaughtException');
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(showFatal).toHaveBeenCalledOnce();
    expect(showFatal).toHaveBeenCalledWith('Vozella stopped unexpectedly', 'boom');
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('only logs an unhandled rejection', () => {
    const { emitter, logger, showFatal, exit } = setup();
    emitter.emit('unhandledRejection', new Error('late'));
    expect(logger.error).toHaveBeenCalledWith('unhandled promise rejection', expect.anything());
    expect(showFatal).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
