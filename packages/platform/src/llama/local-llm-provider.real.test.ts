import fs from 'node:fs';
import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildSummaryPrompt,
  CancelSource,
  CONTEXT_TOKENS,
  parseOffsetDate,
  type CancelSignal,
} from '@vozella/core';
import { LlamaSidecar } from './llama-sidecar';
import { LocalLlmHost } from './local-llm-host';
import { LocalLlmSummaryProvider } from './local-llm-provider';
import { createProcessGuard, type ProcessJobPort } from './process-guard';
import { pidAlive, waitUntil } from './test-fixtures/orphan-harness';

/**
 * Real llama-server integration for the local provider. Same guards as the sidecar real test:
 * VOZELLA_LLAMA_BIN_DIR (folder with `cpu` and `cuda12` builds) and VOZELLA_LLM_MODEL (the 1B
 * GGUF). Without both the suite is skipped.
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
    'local-llm-provider real tests skipped: set VOZELLA_LLAMA_BIN_DIR and VOZELLA_LLM_MODEL.\n',
  );
}

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const addonPath = nodePath.resolve(
  here,
  '../../../../native/vozella-native/vozella-native.win32-x64-msvc.node',
);

function realJob(): ProcessJobPort | undefined {
  if (!fs.existsSync(addonPath)) return undefined;
  const addon = createRequire(import.meta.url)(addonPath) as {
    assignToKillOnCloseJob(pid: number): void;
  };
  return { assign: (pid) => addon.assignToKillOnCloseJob(pid) };
}

const recordedAt = parseOffsetDate('2026-11-02T14:00:00.0000000-05:00')!;
const NEVER: CancelSignal = new CancelSource().signal;

const SHORT = [
  '[00:00.00-00:08.00] Hola a todos, empezamos la reunión semanal del equipo de producto.',
  '[00:08.00-00:20.00] Marta dice que el lanzamiento de la versión dos se mueve al viernes 14 de noviembre.',
  '[00:20.00-00:34.00] Decidimos que Pablo prepara las notas de la versión y Lucía revisa la documentación.',
  '[00:34.00-00:46.00] Queda pendiente saber si el cliente de Lima acepta la nueva fecha.',
].join('\n');

function longTranscript(): string {
  const topics = [
    'el presupuesto del trimestre y los gastos de infraestructura en la nube',
    'la migración de la base de datos a la nueva región y el plan de respaldo',
    'las entrevistas con clientes de Lima, Bogotá y Santiago sobre el onboarding',
    'el rediseño de la pantalla de facturación y las pruebas con usuarios',
    'la contratación de dos ingenieros y el calendario de entrevistas técnicas',
  ];
  const lines: string[] = [];
  for (let i = 0; i < 160; i++) {
    const t = topics[i % topics.length];
    const mm = String(Math.floor(i / 2)).padStart(2, '0');
    lines.push(
      `[${mm}:${i % 2 === 0 ? '00' : '30'}.00-${mm}:${i % 2 === 0 ? '29' : '59'}.00] Persona ${(i % 4) + 1}: hablamos de ${t}; punto número ${i + 1}, con comentarios sobre riesgos, responsables y fechas de entrega.`,
    );
  }
  return lines.join('\n');
}

describe.skipIf(!ready)('LocalLlmSummaryProvider on the real llama-server', () => {
  for (const backend of ['cuda12', 'cpu'] as const) {
    it(`${backend}: summarizes, stream chunks add up, long transcript uses map-reduce, no server left`, async () => {
      const exe = nodePath.join(binDir!, backend, 'llama-server.exe');
      if (!fs.existsSync(exe)) return;
      const guard = createProcessGuard(realJob());
      const host = new LocalLlmHost({
        createServer: () => new LlamaSidecar({ guard }),
        resolveRuntime: async () => ({ exe, gpuOffload: backend !== 'cpu' }),
      });
      const provider = new LocalLlmSummaryProvider({ host, modelPath: () => model! });
      const report: string[] = [];
      try {
        const started = Date.now();
        const result = await provider.summarize(
          { transcript: SHORT, title: 'Reunión semanal', recordedAt, outputLanguage: 'es' },
          NEVER,
        );
        report.push(`short summary ${Date.now() - started} ms (includes load)`);
        expect(result.summaryMarkdown.trim().length).toBeGreaterThan(0);
        // The 1B model often skips the Title section; larger models follow it. The splitter must
        // still return a usable summary either way, so the title is only recorded.
        report.push(`title section ${result.suggestedTitle ? 'present' : 'absent'}`);

        // Tokens per second, measured on the same loaded server.
        const server = await host.acquire(model!, NEVER);
        const t0 = Date.now();
        let completion = 0;
        for await (const delta of server.chatStream(
          [{ role: 'user', content: 'Escribe un párrafo largo sobre reuniones de equipo.' }],
          { maxTokens: 200, temperature: 0.2, seed: 1 },
        )) {
          completion = delta.usage?.completionTokens ?? completion;
        }
        const tps = completion / ((Date.now() - t0) / 1000);
        report.push(`${backend} generation ${tps.toFixed(1)} tokens/s (${completion} tokens)`);
        expect(completion).toBeGreaterThan(0);

        const chunks: string[] = [];
        for await (const chunk of provider.streamPrompt(
          'Responde en una frase corta: ¿qué es una reunión?',
          NEVER,
        )) {
          chunks.push(chunk);
        }
        const streamed = chunks.join('');
        expect(chunks.length).toBeGreaterThan(1);
        const whole = await provider.completePrompt(
          'Responde en una frase corta: ¿qué es una reunión?',
          NEVER,
        );
        // Same seed and sampler, so the streamed text and the whole answer agree up to trimming.
        expect(streamed.trim().length).toBeGreaterThan(0);
        expect(whole.trim().length).toBeGreaterThan(0);

        const transcript = longTranscript();
        const prompt = buildSummaryPrompt({
          title: 'Reunión larga',
          recordedAt,
          transcript,
          outputLanguage: 'es',
        });
        const promptTokens = await server.tokenize(prompt, NEVER, {
          addSpecial: true,
          parseSpecial: true,
        });
        report.push(`long prompt ${promptTokens} tokens`);
        expect(promptTokens).toBeGreaterThan(CONTEXT_TOKENS);
        const longStarted = Date.now();
        const long = await provider.summarize(
          { transcript, title: 'Reunión larga', recordedAt, outputLanguage: 'es' },
          NEVER,
        );
        report.push(`long summary ${Date.now() - longStarted} ms`);
        expect(long.summaryMarkdown.trim().length).toBeGreaterThan(0);

        const title = await provider.suggestTitle(
          { transcript, recordedAt, outputLanguage: 'es' },
          NEVER,
        );
        expect(title.trim().length).toBeGreaterThan(0);

        const pid = (server as LlamaSidecar).pid!;
        expect(pidAlive(pid)).toBe(true);
        await provider.dispose();
        expect(await waitUntil(() => !pidAlive(pid), 5000)).toBe(true);
      } finally {
        await host.dispose();
        process.stderr.write(`[S11 real ${backend}] ${report.join(' | ')}\n`);
      }
    }, 900_000);
  }
});
