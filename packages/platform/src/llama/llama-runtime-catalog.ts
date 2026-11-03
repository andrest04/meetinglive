import type { LlamaBackend } from '@vozella/core';

/** The llama.cpp release the app pins. Only the Windows x64 archives are pinned; macOS is out of scope. */
export const LLAMA_TAG = 'b12063';
export const LLAMA_RELEASE_BASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}`;

export interface LlamaArchive {
  readonly name: string;
  /** Lowercase hex; the GitHub release asset digest, copied from the spike on 2026-11-03. */
  readonly sha256: string;
}

export interface LlamaRuntimePin {
  readonly backend: LlamaBackend;
  /** Folder name under `LlamaRuntime`. */
  readonly folder: string;
  /** Extracted in order into the same folder (the CUDA runtime DLLs sit next to the server). */
  readonly archives: readonly LlamaArchive[];
}

export const LLAMA_RUNTIMES: Readonly<Record<LlamaBackend, LlamaRuntimePin>> = {
  cuda12: {
    backend: 'cuda12',
    folder: 'cuda12',
    archives: [
      {
        name: `llama-${LLAMA_TAG}-bin-win-cuda-12.4-x64.zip`,
        sha256: 'e259b36002d9f20c8ac4238f0a043e614c43d32f533888c61bf0da34cba4924f',
      },
      {
        name: 'cudart-llama-bin-win-cuda-12.4-x64.zip',
        sha256: '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6',
      },
    ],
  },
  cuda13: {
    backend: 'cuda13',
    folder: 'cuda13',
    archives: [
      {
        name: `llama-${LLAMA_TAG}-bin-win-cuda-13.4-x64.zip`,
        sha256: '5d1b4eef94ef80668284e5ef2ffe5c8abbac61968cccb5463d97c2e6416f2a3a',
      },
      {
        name: 'cudart-llama-bin-win-cuda-13.4-x64.zip',
        sha256: '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668',
      },
    ],
  },
  vulkan: {
    backend: 'vulkan',
    folder: 'vulkan',
    archives: [
      {
        name: `llama-${LLAMA_TAG}-bin-win-vulkan-x64.zip`,
        sha256: '7f2b50e5aa9b84b1fdf2a77790ac899a2a7d21160f8f806eefd6d177fa81bae0',
      },
    ],
  },
  cpu: {
    backend: 'cpu',
    folder: 'cpu',
    archives: [
      {
        name: `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`,
        sha256: '4e3766c32a517cdd66ea28f57c862d6b83582ba5d1354f9db585b34f7ad8cf62',
      },
    ],
  },
};

export const LLAMA_SERVER_EXE = 'llama-server.exe';
