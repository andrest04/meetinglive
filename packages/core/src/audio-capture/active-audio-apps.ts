/** Discovery of the applications producing audio right now (spec 3.4). */

export interface AudioSessionSnapshot {
  readonly processId: number;
  readonly isSystemSounds: boolean;
  readonly isStateActive: boolean;
  /** Master peak 0..1; an unreadable peak is 0. */
  readonly peak: number;
}

/** Port: the audio sessions of the default render endpoint. Not thread-safe: one poller. */
export interface AudioSessionSource {
  /** Re-resolves the default endpoint and lists its sessions. Errors give an empty list. */
  enumerate(): readonly AudioSessionSnapshot[];
  /** Latest peak per process id from the sessions cached by the last `enumerate`. */
  readPeaks(): ReadonlyMap<number, number>;
  dispose(): void;
}

export interface ProcessDetails {
  readonly processId: number;
  readonly parentProcessId: number;
  readonly exePath: string | null;
  readonly processName: string;
  /** Milliseconds since the Unix epoch, UTC. */
  readonly startTimeUtcMs: number | null;
}

export interface FileVersionInfo {
  readonly fileDescription: string | null;
  readonly productName: string | null;
}

/** Port: process queries. Adapter: the native addon (Windows). */
export interface ProcessInfoProvider {
  getProcess(processId: number): ProcessDetails | null;
  getVersionInfo(exePath: string): FileVersionInfo | null;
}

export interface ActiveAudioApp {
  /** The root process of the app. */
  readonly processId: number;
  readonly exePath: string | null;
  readonly friendlyName: string;
  readonly isBrowser: boolean;
  readonly isKnownMeetingApp: boolean;
  readonly peak: number;
}

export const ACTIVE_PEAK_THRESHOLD = 0.001;
export const MAX_PARENT_WALK_DEPTH = 32;

const EXCLUDED_EXECUTABLES = new Set(
  [
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
  ].map((n) => n.toLowerCase()),
);
const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']);
const MEETING_APPS = new Set([
  'zoom',
  'teams',
  'ms-teams',
  'webex',
  'webexmta',
  'slack',
  'discord',
  'skype',
  'cpthost',
]);

const collator = new Intl.Collator('en', { sensitivity: 'accent' });

/** Name ordering, case-insensitive, with a fixed locale so every machine agrees (S8). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** File name without extension, or the process name when the path is unknown. */
function executableName(details: ProcessDetails): string {
  if (details.exePath === null) return details.processName;
  const file = details.exePath.split(/[\\/]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

export class ActiveAudioAppService {
  private rootBySessionPid: ReadonlyMap<number, number> | undefined;

  constructor(
    private readonly sessions: AudioSessionSource,
    private readonly processes: ProcessInfoProvider,
    /** The main process of this app. Its helpers roll up into it and are excluded. */
    private readonly ownProcessId: number,
  ) {}

  refresh(): ActiveAudioApp[] {
    const rootBySession = new Map<number, number>();
    const rootInfo = new Map<number, ProcessDetails>();
    const peakByRoot = new Map<number, number>();

    for (const session of this.sessions.enumerate()) {
      if (session.isSystemSounds || session.processId === 0) continue;
      const active = session.isStateActive || session.peak > ACTIVE_PEAK_THRESHOLD;
      if (!active) continue;
      const process = this.processes.getProcess(session.processId);
      if (!process) continue;
      const root = this.findRoot(process);
      if (this.isExcluded(process) || this.isExcluded(root)) continue;
      rootBySession.set(session.processId, root.processId);
      rootInfo.set(root.processId, root);
      peakByRoot.set(root.processId, Math.max(peakByRoot.get(root.processId) ?? 0, session.peak));
    }
    this.rootBySessionPid = rootBySession;

    const apps: ActiveAudioApp[] = [];
    for (const [rootPid, root] of rootInfo) {
      const exeName = executableName(root).toLowerCase();
      apps.push({
        processId: rootPid,
        exePath: root.exePath,
        friendlyName: this.friendlyName(root),
        isBrowser: BROWSERS.has(exeName),
        isKnownMeetingApp: MEETING_APPS.has(exeName),
        peak: peakByRoot.get(rootPid) ?? 0,
      });
    }
    return apps.sort(
      (a, b) => compareNames(a.friendlyName, b.friendlyName) || a.processId - b.processId,
    );
  }

  /** Latest peak per root app from the cached sessions. No re-enumeration. */
  readPeaks(): Map<number, number> {
    const result = new Map<number, number>();
    const map = this.rootBySessionPid;
    if (!map) return result;
    for (const [pid, peak] of this.sessions.readPeaks()) {
      const root = map.get(pid);
      if (root === undefined) continue;
      result.set(root, Math.max(result.get(root) ?? 0, peak));
    }
    return result;
  }

  private isExcluded(process: ProcessDetails): boolean {
    return (
      process.processId === this.ownProcessId ||
      EXCLUDED_EXECUTABLES.has(executableName(process).toLowerCase())
    );
  }

  /** Climbs to the parent while it runs the same image (spec 3.4.3). */
  private findRoot(start: ProcessDetails): ProcessDetails {
    let current = start;
    const seen = new Set<number>([current.processId]);
    for (let i = 0; i < MAX_PARENT_WALK_DEPTH; i += 1) {
      if (current.exePath === null) break;
      const parentPid = current.parentProcessId;
      if (parentPid === 0 || seen.has(parentPid)) break;
      seen.add(parentPid);
      const parent = this.processes.getProcess(parentPid);
      if (!parent?.exePath) break;
      if (!samePath(parent.exePath, current.exePath)) break;
      // A parent that started after its child is a recycled pid.
      if (
        parent.startTimeUtcMs !== null &&
        current.startTimeUtcMs !== null &&
        parent.startTimeUtcMs > current.startTimeUtcMs
      ) {
        break;
      }
      current = parent;
    }
    return current;
  }

  private friendlyName(root: ProcessDetails): string {
    if (root.exePath !== null) {
      const version = this.processes.getVersionInfo(root.exePath);
      if (version) {
        const description = version.fileDescription?.trim();
        if (description) return description;
        const product = version.productName?.trim();
        if (product) return product;
      }
    }
    return root.processName;
  }
}
