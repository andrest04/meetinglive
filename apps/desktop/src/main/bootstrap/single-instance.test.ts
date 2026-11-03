import { describe, expect, it } from 'vitest';
import { acquireSingleInstance, relaunchApp, RELAUNCH_ARG } from './single-instance';

describe('acquireSingleInstance', () => {
  it('takes the lock when it is free', () => {
    expect(
      acquireSingleInstance({ requestLock: () => true, relaunched: false, sleep: () => undefined }),
    ).toBe(true);
  });

  it('a normal second start gives up at once', () => {
    let tries = 0;
    expect(
      acquireSingleInstance({
        requestLock: () => {
          tries += 1;
          return false;
        },
        relaunched: false,
        sleep: () => undefined,
      }),
    ).toBe(false);
    expect(tries).toBe(1);
  });

  it('B10: after our own restart it waits for the old process to let go', () => {
    let tries = 0;
    const slept: number[] = [];
    const got = acquireSingleInstance({
      requestLock: () => ++tries >= 4,
      relaunched: true,
      sleep: (ms) => slept.push(ms),
    });
    expect(got).toBe(true);
    expect(slept).toHaveLength(3);
  });

  it('gives up after the wait', () => {
    let slept = 0;
    expect(
      acquireSingleInstance({
        requestLock: () => false,
        relaunched: true,
        waitMs: 500,
        stepMs: 100,
        sleep: () => {
          slept += 1;
        },
      }),
    ).toBe(false);
    expect(slept).toBe(5);
  });
});

describe('relaunchApp', () => {
  it('relaunches with the mark once, then quits after the current call', () => {
    const log: string[] = [];
    let deferred: (() => void) | null = null;
    relaunchApp({
      argv: ['electron', '--flag', RELAUNCH_ARG],
      relaunch: (options) => log.push(`relaunch ${options.args.join(' ')}`),
      quit: () => log.push('quit'),
      defer: (run) => {
        deferred = run;
      },
    });
    expect(log).toEqual([`relaunch --flag ${RELAUNCH_ARG}`]);
    deferred!();
    expect(log).toEqual([`relaunch --flag ${RELAUNCH_ARG}`, 'quit']);
  });
});
