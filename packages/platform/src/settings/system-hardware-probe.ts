import { execFile } from 'node:child_process';
import os from 'node:os';
import type { HardwareProbe, HardwareProfile } from '@vozella/core';

export interface GpuInfo {
  readonly name: string | null;
  readonly vramGb: number | null;
}

const NO_GPU: GpuInfo = { name: null, vramGb: null };
const GIB = 1024 ** 3;

/**
 * Reads the display adapters on Windows. The registry value `HardwareInformation.qwMemorySize` is
 * 64 bit; WMI `AdapterRAM` is a 32 bit field that tops out near 4 GB, so it is only the fallback
 * (the WinUI app read only that one and misjudged any card above 4 GB).
 */
const GPU_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$registry = @(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | Where-Object { $_.DriverDesc } | ForEach-Object { [pscustomobject]@{ Name = $_.DriverDesc; Bytes = $_.'HardwareInformation.qwMemorySize' } })
$cim = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ Name = $_.Name; AdapterRAM = $_.AdapterRAM } })
[pscustomobject]@{ registry = $registry; cim = $cim } | ConvertTo-Json -Compress -Depth 4
`;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? (value as unknown[])
    : value === null || value === undefined
      ? []
      : [value];

/** Bytes as a number, or as the little endian byte array some drivers store. */
function bytesOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    let total = 0;
    for (let i = 0; i < value.length; i += 1) {
      const byte = Number(value[i]);
      if (!Number.isFinite(byte)) return 0;
      total += byte * 256 ** i;
    }
    return total;
  }
  return 0;
}

function largest(items: unknown[], field: string): GpuInfo | null {
  let best: { name: string | null; bytes: number } | null = null;
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const bytes = bytesOf(row[field]);
    if (bytes > 0 && (best === null || bytes > best.bytes)) {
      best = { name: typeof row.Name === 'string' ? row.Name : null, bytes };
    }
  }
  return best ? { name: best.name, vramGb: Math.round((best.bytes / GIB) * 10) / 10 } : null;
}

/** Picks the adapter with the most memory from the script's JSON. Unusable output means no GPU. */
export function parseGpuReport(text: string): GpuInfo {
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return NO_GPU;
  }
  if (typeof report !== 'object' || report === null) return NO_GPU;
  const { registry, cim } = report as { registry?: unknown; cim?: unknown };
  return largest(asArray(registry), 'Bytes') ?? largest(asArray(cim), 'AdapterRAM') ?? NO_GPU;
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error(error.message, { cause: error }));
        else resolve(stdout);
      },
    );
  });
}

export interface SystemHardwareProbeOptions {
  readonly totalMemoryBytes?: () => number;
  readonly queryGpu?: () => Promise<GpuInfo>;
}

/**
 * RAM and the largest GPU, read once per process. A GPU query that fails still gives the RAM, but
 * that answer is not kept: the next call asks again, so a transient failure does not hide the GPU
 * until the app restarts (B17). A rejected read is not kept either.
 */
export class SystemHardwareProbe implements HardwareProbe {
  private cached: Promise<HardwareProfile> | undefined;

  constructor(private readonly options: SystemHardwareProbeOptions = {}) {}

  detect(): Promise<HardwareProfile> {
    if (this.cached) return this.cached;
    const attempt: Promise<HardwareProfile> = this.read().then(
      ({ profile, complete }) => {
        if (!complete && this.cached === attempt) this.cached = undefined;
        return profile;
      },
      (error: unknown) => {
        if (this.cached === attempt) this.cached = undefined;
        throw error;
      },
    );
    this.cached = attempt;
    return attempt;
  }

  private async read(): Promise<{ profile: HardwareProfile; complete: boolean }> {
    const totalRamGb =
      Math.round(((this.options.totalMemoryBytes ?? os.totalmem)() / GIB) * 10) / 10;
    let complete = true;
    const gpu = await (this.options.queryGpu ?? defaultQuery)().catch(() => {
      complete = false;
      return NO_GPU;
    });
    return { profile: { totalRamGb, gpuName: gpu.name, gpuVramGb: gpu.vramGb }, complete };
  }
}

async function defaultQuery(): Promise<GpuInfo> {
  if (process.platform !== 'win32') return NO_GPU;
  return parseGpuReport(await runPowerShell(GPU_SCRIPT));
}
