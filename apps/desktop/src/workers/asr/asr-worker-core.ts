import {
  asrWorkerCommandSchema,
  type AsrWorkerCommand,
  type AsrWorkerEvent,
} from '@vozella/contracts';

/** The part of koffi the ASR worker uses. Lets tests run without a native library. */
export interface KoffiLike {
  readonly version: string;
  load(path: string): { func(declaration: string): (...args: never[]) => unknown };
}

export interface AsrWorkerDeps {
  /** Loads koffi lazily: a broken install is reported as a message, not a crashed worker. */
  readonly loadKoffi: () => Promise<KoffiLike>;
  /** Makes sibling DLLs of the engine resolvable (SetDllDirectoryW on Windows). */
  readonly prepareDllDirectory: (binDir: string, koffi: KoffiLike) => void;
  readonly join: (...parts: string[]) => string;
  readonly post: (event: AsrWorkerEvent) => void;
}

const ENGINE_DLL = 'nemo_speech_asr_c.dll';

/**
 * Skeleton of the ASR utilityProcess. It proves koffi loads and that the NeMo-Speech.cpp
 * C ABI answers `nemo_speech_asr_version`. Recognition itself is ported with the ASR module.
 */
export function createAsrWorker(deps: AsrWorkerDeps): (raw: unknown) => Promise<void> {
  const handle = async (command: AsrWorkerCommand): Promise<void> => {
    switch (command.type) {
      case 'ping': {
        try {
          deps.post({ type: 'pong', koffi: (await deps.loadKoffi()).version });
        } catch {
          deps.post({ type: 'pong', koffi: null });
        }
        return;
      }
      case 'load': {
        const koffi = await deps.loadKoffi();
        deps.prepareDllDirectory(command.binDir, koffi);
        const lib = koffi.load(deps.join(command.binDir, ENGINE_DLL));
        const version = lib.func('const char *nemo_speech_asr_version()')();
        deps.post({ type: 'loaded', version: String(version) });
        return;
      }
      case 'shutdown':
        return;
    }
  };

  return async (raw) => {
    const parsed = asrWorkerCommandSchema.safeParse(raw);
    if (!parsed.success) {
      deps.post({ type: 'error', message: 'invalid command' });
      return;
    }
    try {
      await handle(parsed.data);
    } catch (error) {
      deps.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
}
