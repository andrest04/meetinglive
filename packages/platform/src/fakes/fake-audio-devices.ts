import type {
  AudioSessionSnapshot,
  AudioSessionSource,
  FileVersionInfo,
  MicrophoneDevice,
  MicrophoneDeviceSource,
  OsBuildProbe,
  ProcessDetails,
  ProcessInfoProvider,
} from '@vozella/core';

/** Fake: two microphones, so the Record page has something to list in tests and e2e. */
export class FakeMicrophoneDevices implements MicrophoneDeviceSource {
  constructor(
    private devices: readonly MicrophoneDevice[] = [
      { id: 'fake-mic-1', name: 'Test microphone' },
      { id: 'fake-mic-2', name: 'Test headset' },
    ],
  ) {}

  list(): MicrophoneDevice[] {
    return [...this.devices];
  }

  set(devices: readonly MicrophoneDevice[]): void {
    this.devices = devices;
  }
}

/** Fake: sessions that tests set by hand. */
export class FakeAudioSessionSource implements AudioSessionSource {
  sessions: AudioSessionSnapshot[] = [];
  peaks = new Map<number, number>();
  disposed = false;

  enumerate(): readonly AudioSessionSnapshot[] {
    return this.sessions;
  }

  readPeaks(): ReadonlyMap<number, number> {
    return this.peaks;
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** Fake: a process table that tests fill. */
export class FakeProcessInfo implements ProcessInfoProvider {
  readonly processes = new Map<number, ProcessDetails>();
  readonly versions = new Map<string, FileVersionInfo>();

  getProcess(processId: number): ProcessDetails | null {
    return this.processes.get(processId) ?? null;
  }

  getVersionInfo(exePath: string): FileVersionInfo | null {
    return this.versions.get(exePath) ?? null;
  }
}

export class FakeOsBuild implements OsBuildProbe {
  constructor(private readonly build = 26_300) {}

  windowsBuild(): number {
    return this.build;
  }
}
