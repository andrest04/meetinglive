import type { HardwareProfile } from '../settings/summary-models';
import { hasNvidiaGpu } from '../transcription/recognizer-factory';

/** The llama.cpp Windows x64 builds the app can install. macOS and Linux are out of scope. */
export const LLAMA_BACKENDS = ['cuda12', 'cuda13', 'vulkan', 'cpu'] as const;
export type LlamaBackend = (typeof LLAMA_BACKENDS)[number];

/** The CUDA build a driver probe may ask for. The default is cuda12. */
export type CudaGeneration = 'cuda12' | 'cuda13';

export const isGpuBackend = (backend: LlamaBackend): boolean => backend !== 'cpu';

/** Layers are offloaded to the GPU on every backend except cpu. Feeds S06's `rateFor`. */
export const usesGpuOffload = isGpuBackend;

/** A GPU that is not NVIDIA but reports video memory: Vulkan can use it. */
function hasVulkanGpu(hardware: Pick<HardwareProfile, 'gpuName' | 'gpuVramGb'>): boolean {
  const name = hardware.gpuName;
  return name !== null && name.trim() !== '' && (hardware.gpuVramGb ?? 0) > 0;
}

/**
 * The order to try backends in. NVIDIA: the CUDA build (cuda12 unless the injected driver probe
 * reported cuda13, which then falls back to cuda12), then vulkan, then cpu. Another GPU with
 * VRAM: vulkan, then cpu. Anything else: cpu.
 */
export function backendFallbackChain(
  hardware: Pick<HardwareProfile, 'gpuName' | 'gpuVramGb'>,
  cuda: CudaGeneration | null = null,
): readonly LlamaBackend[] {
  if (hasNvidiaGpu(hardware)) {
    return cuda === 'cuda13' ? ['cuda13', 'cuda12', 'vulkan', 'cpu'] : ['cuda12', 'vulkan', 'cpu'];
  }
  if (hasVulkanGpu(hardware)) return ['vulkan', 'cpu'];
  return ['cpu'];
}

/**
 * The first backend of the chain that is in `available` (the ones that have not failed their
 * self-test), or null when none is left.
 */
export function chooseBackend(
  hardware: Pick<HardwareProfile, 'gpuName' | 'gpuVramGb'>,
  available: readonly LlamaBackend[],
  cuda: CudaGeneration | null = null,
): LlamaBackend | null {
  return backendFallbackChain(hardware, cuda).find((b) => available.includes(b)) ?? null;
}
