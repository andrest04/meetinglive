import { describe, expect, it } from 'vitest';
import {
  ActiveAudioAppService,
  type AudioSessionSnapshot,
  type AudioSessionSource,
  type FileVersionInfo,
  type ProcessDetails,
  type ProcessInfoProvider,
} from './active-audio-apps';

class FakeSessions implements AudioSessionSource {
  sessions: AudioSessionSnapshot[] = [];
  peaks = new Map<number, number>();
  enumerations = 0;
  enumerate(): readonly AudioSessionSnapshot[] {
    this.enumerations += 1;
    return this.sessions;
  }
  readPeaks(): ReadonlyMap<number, number> {
    return this.peaks;
  }
  dispose(): void {
    // nothing
  }
}

class FakeProcesses implements ProcessInfoProvider {
  readonly table = new Map<number, ProcessDetails>();
  readonly versions = new Map<string, FileVersionInfo>();
  add(
    pid: number,
    name: string,
    opts: { parent?: number; exe?: string | null; start?: number | null } = {},
  ): void {
    this.table.set(pid, {
      processId: pid,
      parentProcessId: opts.parent ?? 0,
      exePath: opts.exe === undefined ? `C:\\Apps\\${name}.exe` : opts.exe,
      processName: name,
      startTimeUtcMs: opts.start === undefined ? 1000 + pid : opts.start,
    });
  }
  getProcess(pid: number): ProcessDetails | null {
    return this.table.get(pid) ?? null;
  }
  getVersionInfo(path: string): FileVersionInfo | null {
    return this.versions.get(path) ?? null;
  }
}

const session = (processId: number, peak = 0.2, isStateActive = true): AudioSessionSnapshot => ({
  processId,
  isSystemSounds: false,
  isStateActive,
  peak,
});

function rig(ownPid = 1) {
  const sessions = new FakeSessions();
  const processes = new FakeProcesses();
  return { sessions, processes, service: new ActiveAudioAppService(sessions, processes, ownPid) };
}

describe('ActiveAudioAppService.refresh', () => {
  it('rolls helpers up into the main process of the same image', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'chrome', { start: 1000 });
    processes.add(101, 'chrome', { parent: 100, start: 2000 });
    processes.add(102, 'chrome', { parent: 101, start: 3000 });
    sessions.sessions = [session(102, 0.3)];
    const apps = service.refresh();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ processId: 100, isBrowser: true, peak: 0.3 });
  });

  it('stops at a parent with a different image', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'launcher');
    processes.add(101, 'game', { parent: 100 });
    sessions.sessions = [session(101)];
    expect(service.refresh().map((a) => a.processId)).toEqual([101]);
  });

  it('rejects a recycled parent pid that started after the child', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'chrome', { start: 9000 });
    processes.add(101, 'chrome', { parent: 100, start: 2000 });
    sessions.sessions = [session(101)];
    expect(service.refresh().map((a) => a.processId)).toEqual([101]);
  });

  it('stops when the parent is missing and when parents form a cycle', () => {
    const { sessions, processes, service } = rig();
    processes.add(101, 'a', { parent: 555 });
    processes.add(200, 'b', { parent: 201, start: 1 });
    processes.add(201, 'b', { parent: 200, start: 1 });
    sessions.sessions = [session(101), session(200)];
    const ids = service.refresh().map((a) => a.processId);
    expect(ids).toContain(101);
    expect(ids).toHaveLength(2);
  });

  it('merges two sessions of one root into one entry with the max peak', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'zoom');
    processes.add(101, 'zoom', { parent: 100, start: 5000 });
    sessions.sessions = [session(100, 0.1), session(101, 0.6)];
    const apps = service.refresh();
    expect(apps).toHaveLength(1);
    expect(apps[0]?.peak).toBe(0.6);
    expect(apps[0]?.isKnownMeetingApp).toBe(true);
  });

  it('lists two roots of the same executable as two entries', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'chrome', { exe: 'C:\\x\\chrome.exe' });
    processes.add(200, 'chrome', { exe: 'C:\\x\\chrome.exe' });
    sessions.sessions = [session(100), session(200)];
    expect(service.refresh()).toHaveLength(2);
    sessions.sessions = [session(100)];
    expect(service.refresh()).toHaveLength(1);
  });

  it('applies the activity rule: state active or peak over 0.001', () => {
    const { sessions, processes, service } = rig();
    for (const [pid, n] of [
      [10, 'a'],
      [11, 'b'],
      [12, 'c'],
      [13, 'd'],
    ] as const) {
      processes.add(pid, n);
    }
    sessions.sessions = [
      session(10, 0, false), // silent and inactive
      session(11, 0.002, false), // inactive but above the threshold
      session(12, 0, true), // active with zero peak
      session(13, 0.001, false), // exactly the threshold: strict greater-than
    ];
    expect(service.refresh().map((a) => a.processId)).toEqual([11, 12]);
  });

  it('skips system sounds, pid 0 and unresolvable processes', () => {
    const { sessions, processes, service } = rig();
    processes.add(10, 'a');
    sessions.sessions = [
      { processId: 10, isSystemSounds: true, isStateActive: true, peak: 1 },
      session(0),
      session(999),
    ];
    expect(service.refresh()).toEqual([]);
  });

  it('excludes the own process tree through its main pid', () => {
    const { sessions, processes, service } = rig(50);
    processes.add(50, 'vozella');
    processes.add(51, 'vozella', { parent: 50, start: 3000 });
    sessions.sessions = [session(51)];
    expect(service.refresh()).toEqual([]);
  });

  it.each([
    'ApplicationFrameHost',
    'TextInputHost',
    'SystemSettings',
    'explorer',
    'ShellExperienceHost',
    'StartMenuExperienceHost',
    'SearchHost',
    'LockApp',
    'dwm',
    'audiodg',
  ])('always excludes %s', (name) => {
    const { sessions, processes, service } = rig();
    processes.add(10, name.toUpperCase());
    sessions.sessions = [session(10)];
    expect(service.refresh()).toEqual([]);
  });

  it('names an access-denied process by its process name and does not roll it up', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'Secret', { exe: null });
    sessions.sessions = [session(100)];
    expect(service.refresh()[0]).toMatchObject({ friendlyName: 'Secret', exePath: null });
  });

  it('prefers the file description, then the product name, then the process name', () => {
    const { sessions, processes, service } = rig();
    processes.add(10, 'one');
    processes.add(11, 'two');
    processes.add(12, 'three');
    processes.versions.set('C:\\Apps\\one.exe', {
      fileDescription: '  Alpha  ',
      productName: 'P1',
    });
    processes.versions.set('C:\\Apps\\two.exe', { fileDescription: '   ', productName: ' Beta ' });
    processes.versions.set('C:\\Apps\\three.exe', { fileDescription: null, productName: '' });
    sessions.sessions = [session(10), session(11), session(12)];
    expect(service.refresh().map((a) => a.friendlyName)).toEqual(['Alpha', 'Beta', 'three']);
  });

  it.each([
    ['chrome', true],
    ['msedge', true],
    ['firefox', true],
    ['brave', true],
    ['opera', true],
    ['vivaldi', true],
    ['arc', true],
    ['zoom', false],
  ])('flags browser %s as %s', (name, expected) => {
    const { sessions, processes, service } = rig();
    processes.add(10, name);
    sessions.sessions = [session(10)];
    expect(service.refresh()[0]?.isBrowser).toBe(expected);
  });

  it.each([
    ['zoom', true],
    ['teams', true],
    ['ms-teams', true],
    ['webex', true],
    ['webexmta', true],
    ['slack', true],
    ['discord', true],
    ['skype', true],
    ['cpthost', true],
    ['chrome', false],
    ['notepad', false],
  ])('flags meeting app %s as %s', (name, expected) => {
    const { sessions, processes, service } = rig();
    processes.add(10, name);
    sessions.sessions = [session(10)];
    expect(service.refresh()[0]?.isKnownMeetingApp).toBe(expected);
  });

  it('orders by friendly name ignoring case, then pid', () => {
    const { sessions, processes, service } = rig();
    processes.add(30, 'beta');
    processes.add(20, 'Alpha');
    processes.add(10, 'alpha', { exe: 'C:\\o\\alpha2.exe' });
    sessions.sessions = [session(30), session(20), session(10)];
    expect(service.refresh().map((a) => a.processId)).toEqual([10, 20, 30]);
  });
});

describe('ActiveAudioAppService.readPeaks', () => {
  it('is empty before any refresh', () => {
    const { service, sessions } = rig();
    sessions.peaks = new Map([[10, 0.5]]);
    expect(service.readPeaks().size).toBe(0);
  });

  it('returns the latest peak per root without re-enumerating', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'zoom');
    processes.add(101, 'zoom', { parent: 100, start: 5000 });
    sessions.sessions = [session(100, 0.1), session(101, 0.1)];
    service.refresh();
    const count = sessions.enumerations;
    sessions.peaks = new Map([
      [100, 0.2],
      [101, 0.7],
    ]);
    expect(service.readPeaks()).toEqual(new Map([[100, 0.7]]));
    expect(sessions.enumerations).toBe(count);
  });

  it('ignores sessions that are not mapped to an app', () => {
    const { sessions, processes, service } = rig();
    processes.add(100, 'zoom');
    sessions.sessions = [session(100)];
    service.refresh();
    sessions.peaks = new Map([
      [100, 0.4],
      [777, 0.9],
    ]);
    expect(service.readPeaks()).toEqual(new Map([[100, 0.4]]));
  });
});
