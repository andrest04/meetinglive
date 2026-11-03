import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FakeProcessJob } from '../fakes/fake-process-job';
import {
  createProcessGuard,
  FallbackProcessGuard,
  JobProcessGuard,
  WatchdogProcessGuard,
  type ProcessGuard,
} from './process-guard';
import { pidAlive, waitUntil } from './test-fixtures/orphan-harness';

function sleeper() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

const watchdogStub: ProcessGuard = {
  protect: () => ({ mechanism: 'watchdog', release: () => undefined }),
};

describe('JobProcessGuard', () => {
  it('assigns the pid to the job', () => {
    const job = new FakeProcessJob();
    const guarded = new JobProcessGuard(job).protect(42);
    expect(job.assigned).toEqual([42]);
    expect(guarded.mechanism).toBe('job');
  });
});

describe('createProcessGuard', () => {
  it('uses the watchdog when there is no job', () => {
    expect(createProcessGuard(undefined, watchdogStub).protect(7).mechanism).toBe('watchdog');
  });

  it('falls back to the watchdog when the job refuses the process', () => {
    const job = new FakeProcessJob();
    job.failWith = new Error('access denied');
    expect(createProcessGuard(job, watchdogStub).protect(7).mechanism).toBe('watchdog');
  });

  it('keeps the job when it accepts the process', () => {
    const job = new FakeProcessJob();
    const mustNotRun: ProcessGuard = {
      protect: () => {
        throw new Error('must not run');
      },
    };
    expect(
      new FallbackProcessGuard(new JobProcessGuard(job), mustNotRun).protect(9).mechanism,
    ).toBe('job');
  });
});

describe('WatchdogProcessGuard', () => {
  it('kills the child once the parent pid is gone', async () => {
    const parent = sleeper();
    const child = sleeper();
    const childPid = child.pid!;
    try {
      new WatchdogProcessGuard({ parentPid: parent.pid! }).protect(childPid);
      expect(pidAlive(childPid)).toBe(true);
      parent.kill();
      expect(await waitUntil(() => !pidAlive(childPid), 8000)).toBe(true);
    } finally {
      parent.kill();
      child.kill();
    }
  });

  it('leaves the child alone while the parent lives and after release', async () => {
    const parent = sleeper();
    const child = sleeper();
    const childPid = child.pid!;
    try {
      const guarded = new WatchdogProcessGuard({ parentPid: parent.pid! }).protect(childPid);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(pidAlive(childPid)).toBe(true);
      guarded.release();
      parent.kill();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(pidAlive(childPid)).toBe(true);
    } finally {
      parent.kill();
      child.kill();
    }
  });
});
