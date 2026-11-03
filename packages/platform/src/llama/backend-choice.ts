import { spawn } from 'node:child_process';
import {
  backendFallbackChain,
  chooseBackend,
  type CancelSignal,
  type CudaGeneration,
  type HardwareProfile,
  type LlamaBackend,
} from '@vozella/core';
import type { LlamaRuntimeManager } from './llama-runtime-manager';

/** Reports which CUDA build the driver supports. The default knows nothing, so cuda12 is used. */
export type CudaDriverProbe = () => Promise<CudaGeneration | null>;
export const noCudaDriverProbe: CudaDriverProbe = () => Promise.resolve(null);

/** True when `<exe> --version` runs and exits 0. A missing DLL or an unusable driver fails it. */
export type BackendSelfTest = (exe: string, cwd: string) => Promise<boolean>;

export const llamaVersionSelfTest: BackendSelfTest = (exe, cwd) =>
  new Promise((resolve) => {
    const child = spawn(exe, ['--version'], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
    }, 30_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

export interface SelectBackendOptions {
  readonly hardware: Pick<HardwareProfile, 'gpuName' | 'gpuVramGb'>;
  readonly manager: Pick<LlamaRuntimeManager, 'ensure' | 'binDirectory'>;
  readonly selfTest?: BackendSelfTest;
  readonly cudaProbe?: CudaDriverProbe;
  readonly onProgress?: (backend: LlamaBackend, percent: number) => void;
  readonly cancel?: CancelSignal;
  /** Backends that already failed their self-test in this session. */
  readonly failed?: readonly LlamaBackend[];
}

export interface SelectedBackend {
  readonly backend: LlamaBackend;
  readonly exe: string;
  /** Backends tried and dropped on the way, in order. */
  readonly failed: readonly LlamaBackend[];
}

/**
 * Walks the fallback chain (cuda, then vulkan, then cpu): installs the first candidate, runs its
 * self-test, and moves on when it fails. Install errors and cancels propagate. Rejects when
 * every backend of the chain failed its self-test.
 */
export async function selectWorkingBackend(
  options: SelectBackendOptions,
): Promise<SelectedBackend> {
  const selfTest = options.selfTest ?? llamaVersionSelfTest;
  const cuda = await (options.cudaProbe ?? noCudaDriverProbe)();
  const failed: LlamaBackend[] = [...(options.failed ?? [])];
  const chain = backendFallbackChain(options.hardware, cuda);
  for (;;) {
    const available = chain.filter((b) => !failed.includes(b));
    const backend = chooseBackend(options.hardware, available, cuda);
    if (backend === null) {
      throw new Error(`No llama.cpp backend passed its self-test (tried ${failed.join(', ')}).`);
    }
    const exe = await options.manager.ensure(
      backend,
      (percent) => options.onProgress?.(backend, percent),
      options.cancel,
    );
    if (await selfTest(exe, options.manager.binDirectory(backend))) {
      return { backend, exe, failed };
    }
    failed.push(backend);
  }
}
