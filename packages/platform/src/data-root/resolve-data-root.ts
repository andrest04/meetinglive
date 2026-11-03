import nodePath from 'node:path';

export const ENV_DATA_ROOT = 'VOZELLA_DATA_ROOT';
/** Folder name of the existing .NET app. Agents and tests must never touch it. */
export const LEGACY_FOLDER_NAME = 'MeetingLive';

export type RunMode = 'production' | 'development' | 'test';

export type PathApi = typeof nodePath.win32;

export interface DataRootInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly mode: RunMode;
  /** %LOCALAPPDATA% */
  readonly localAppData: string;
  /** The user's Documents known folder (it can be redirected, so it is passed in). */
  readonly documents: string;
  readonly tempDir: string;
  /** Defaults to the host `path`. Tests pass `path.win32` to run the same cases anywhere. */
  readonly pathApi?: PathApi;
  /** Resolves symlinks and junctions. Failures fall back to the unresolved path. */
  readonly realpath?: (path: string) => string;
}

export interface DataRoots {
  /** Settings, logs, caches, models. */
  readonly appData: string;
  /** Default folder for meetings. */
  readonly meetings: string;
  readonly source: 'env' | 'default' | 'dev-fallback';
}

export class ForbiddenDataRootError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(
      `Refusing to use "${path}" as a Vozella data root: ${reason}. ` +
        `Set ${ENV_DATA_ROOT} to a temporary folder.`,
    );
    this.name = 'ForbiddenDataRootError';
  }
}

export class InvalidDataRootError extends Error {
  constructor(readonly path: string) {
    super(`${ENV_DATA_ROOT} must be an absolute path, got "${path}"`);
    this.name = 'InvalidDataRootError';
  }
}

/** The existing app's folders. */
export function legacyRoots(input: Pick<DataRootInput, 'localAppData' | 'documents' | 'pathApi'>) {
  const p = input.pathApi ?? nodePath;
  return [
    p.join(input.documents, LEGACY_FOLDER_NAME),
    p.join(input.localAppData, LEGACY_FOLDER_NAME),
  ];
}

/** True when `child` is `parent` or inside it. Windows paths compare case-insensitively. */
export function isUnderOrEqual(
  child: string,
  parent: string,
  pathApi: PathApi = nodePath,
): boolean {
  const rel = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

/**
 * Throws if `candidate` is, or is inside, one of the existing app's folders, or if any
 * of its segments is named MeetingLive (covers a relocated Documents folder).
 */
export function assertNotLegacyRoot(candidate: string, input: DataRootInput): void {
  const p = input.pathApi ?? nodePath;
  const real = (value: string): string => {
    try {
      return input.realpath ? input.realpath(value) : value;
    } catch {
      return value;
    }
  };
  const resolved = p.resolve(candidate);
  const variants = new Set([resolved, p.resolve(real(resolved))]);
  const legacy = legacyRoots(input).flatMap((root) => [p.resolve(root), p.resolve(real(root))]);
  for (const path of variants) {
    for (const root of legacy) {
      if (isUnderOrEqual(path, root, p)) {
        throw new ForbiddenDataRootError(
          candidate,
          `it is inside the existing app folder "${root}"`,
        );
      }
    }
    const named = path
      .split(/[\\/]+/)
      .some((segment) => segment.toLowerCase() === LEGACY_FOLDER_NAME.toLowerCase());
    if (named) {
      throw new ForbiddenDataRootError(candidate, `a path segment is named ${LEGACY_FOLDER_NAME}`);
    }
  }
}

/**
 * Where the app keeps its data.
 *
 * - VOZELLA_DATA_ROOT set: `<root>/app` and `<root>/meetings`. Refused, in every mode, when it
 *   points at the existing MeetingLive folders. Used by all agent and test runs.
 * - Packaged and unset: `%LOCALAPPDATA%\Vozella` and `Documents\Vozella`.
 * - Dev or test and unset: a throwaway folder in the OS temp directory, never a real one.
 */
export function resolveDataRoots(input: DataRootInput): DataRoots {
  const p = input.pathApi ?? nodePath;
  const fromEnv = input.env[ENV_DATA_ROOT]?.trim();

  let roots: DataRoots;
  if (fromEnv) {
    if (!p.isAbsolute(fromEnv)) {
      throw new InvalidDataRootError(fromEnv);
    }
    const root = p.resolve(fromEnv);
    assertNotLegacyRoot(root, input);
    roots = { appData: p.join(root, 'app'), meetings: p.join(root, 'meetings'), source: 'env' };
  } else if (input.mode === 'production') {
    roots = {
      appData: p.join(input.localAppData, 'Vozella'),
      meetings: p.join(input.documents, 'Vozella'),
      source: 'default',
    };
  } else {
    const root = p.join(input.tempDir, 'vozella-dev-data');
    roots = {
      appData: p.join(root, 'app'),
      meetings: p.join(root, 'meetings'),
      source: 'dev-fallback',
    };
  }

  assertNotLegacyRoot(roots.appData, input);
  assertNotLegacyRoot(roots.meetings, input);
  return roots;
}
