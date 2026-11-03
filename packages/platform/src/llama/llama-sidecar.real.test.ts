import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LlamaSidecar } from './llama-sidecar';
import { createProcessGuard, type ProcessJobPort } from './process-guard';
import { pidAlive, startOrphanChild, waitUntil } from './test-fixtures/orphan-harness';

/**
 * Real llama-server integration. Set VOZELLA_LLAMA_BIN_DIR to the folder that holds the
 * extracted builds (it needs `cuda12` and `cpu` subfolders) and VOZELLA_LLM_MODEL to the 1B
 * GGUF. Without both the suite is skipped.
 */
const binDir = process.env.VOZELLA_LLAMA_BIN_DIR;
const model = process.env.VOZELLA_LLM_MODEL;
const ready =
  process.platform === 'win32' &&
  !!binDir &&
  !!model &&
  fs.existsSync(nodePath.join(binDir, 'cpu', 'llama-server.exe')) &&
  fs.existsSync(model);

if (!ready) {
  process.stderr.write(
    'llama-sidecar real tests skipped: set VOZELLA_LLAMA_BIN_DIR (folder with cpu and cuda12 builds) and VOZELLA_LLM_MODEL (1B gguf).\n',
  );
}

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const addonPath = nodePath.resolve(
  here,
  '../../../../native/vozella-native/vozella-native.win32-x64-msvc.node',
);
const hasAddon = fs.existsSync(addonPath);

function realJob(): ProcessJobPort | undefined {
  if (!hasAddon) return undefined;
  const addon = createRequire(import.meta.url)(addonPath) as {
    assignToKillOnCloseJob(pid: number): void;
  };
  return { assign: (pid) => addon.assignToKillOnCloseJob(pid) };
}

function exeOf(backend: 'cuda12' | 'cpu'): string {
  return nodePath.join(binDir!, backend, 'llama-server.exe');
}

function hardKill(pid: number): void {
  execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true });
}

describe.skipIf(!ready)('real llama-server', () => {
  for (const backend of ['cuda12', 'cpu'] as const) {
    it(`${backend}: streams a short completion, tokenizes and stops without a leftover process`, async () => {
      if (backend === 'cuda12' && !fs.existsSync(exeOf('cuda12'))) return;
      const sidecar = new LlamaSidecar({ guard: createProcessGuard(realJob()) });
      await sidecar.start({
        exe: exeOf(backend),
        modelPath: model!,
        gpuLayers: backend === 'cpu' ? 0 : 'auto',
        contextTokens: 2048,
        // Verbose enough to print the offload line the GPU check reads.
        extraArgs: ['-lv', '4'],
      });
      const pid = sidecar.pid!;
      if (backend === 'cuda12') {
        expect(sidecar.diagnostics(60_000)).toMatch(/offloaded [1-9]\d*\/\d+ layers to GPU/i);
      }
      let text = '';
      let usage: { completionTokens: number } | undefined;
      for await (const delta of sidecar.chatStream(
        [{ role: 'user', content: 'Say hello in five words.' }],
        { maxTokens: 24, temperature: 0 },
      )) {
        text += delta.content ?? '';
        usage = delta.usage ?? usage;
      }
      expect(text.length).toBeGreaterThan(0);
      expect(usage?.completionTokens).toBeGreaterThan(0);
      expect(await sidecar.tokenize('Hello world, this is a test.')).toBeGreaterThan(3);
      await sidecar.stop();
      expect(pidAlive(pid)).toBe(false);
    }, 180_000);

    it(`${backend}: a hard kill of the owner leaves no llama-server within 5 s`, async () => {
      if (backend === 'cuda12' && !fs.existsSync(exeOf('cuda12'))) return;
      const { child, serverPid } = await startOrphanChild({
        exe: exeOf(backend),
        modelPath: model!,
        gpuLayers: backend === 'cpu' ? 0 : 'auto',
        addonPath: hasAddon ? addonPath : undefined,
        startTimeoutMs: 150_000,
      });
      try {
        expect(pidAlive(serverPid)).toBe(true);
        hardKill(child.pid!);
        expect(await waitUntil(() => !pidAlive(serverPid), 5000)).toBe(true);
      } finally {
        try {
          process.kill(serverPid);
        } catch {
          // already gone
        }
      }
    }, 180_000);
  }
});
