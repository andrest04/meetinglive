import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CancelSource,
  SettingsCommands,
  SUMMARY_MODELS,
  parseOffsetDate,
  type CliPathProbe,
  type CliProcessRunner,
  type CliRunResult,
  type HardwareProbe,
} from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlamaSidecar } from '../llama/llama-sidecar';
import type { ProcessGuard } from '../llama/process-guard';
import { FAKE_SERVER, pidAlive, waitUntil } from '../llama/test-fixtures/orphan-harness';
import { JsonSettingsStore } from '../library/json-settings-store';
import { SummaryRuntime } from './summary-runtime';

const ONE_B = SUMMARY_MODELS[0]!;
const noGuard: ProcessGuard = {
  protect: () => ({ mechanism: 'job', release: () => undefined }),
};
const recordedAt = parseOffsetDate('2026-11-02T14:00:00.0000000-05:00')!;

class RecordingRunner implements CliProcessRunner {
  readonly calls: { executable: string; args: readonly string[] }[] = [];
  isOnPath(): boolean {
    return true;
  }
  run(executable: string, args: readonly string[]): Promise<CliRunResult> {
    this.calls.push({ executable, args: [...args] });
    return Promise.resolve({ exitCode: 0, stdout: '## Summary\nok', stderr: '' });
  }
}

let root: string;
let settingsFile: string;
beforeEach(() => {
  const base = process.env.VOZELLA_DATA_ROOT ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, 'summary-runtime-'));
  settingsFile = path.join(root, 'settings.json');
});
const runtimes: SummaryRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
  fs.rmSync(root, { recursive: true, force: true });
});

function build(onPath: readonly string[] = ['claude', 'codex']) {
  const settings = new JsonSettingsStore({ settingsFilePath: settingsFile });
  const runner = new RecordingRunner();
  const cli: CliPathProbe = { isOnPath: (e) => Promise.resolve(onPath.includes(e)) };
  const hardware: HardwareProbe = {
    detect: () => Promise.resolve({ totalRamGb: 16, gpuName: null, gpuVramGb: null }),
  };
  const modelDir = path.join(root, 'SummaryModels');
  fs.mkdirSync(modelDir, { recursive: true });
  const created: LlamaSidecar[] = [];
  const runtime = new SummaryRuntime({
    settings,
    hardware,
    models: {
      isDownloaded: (m) => Promise.resolve(fs.existsSync(path.join(modelDir, m.fileName))),
      download: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      pathFor: (name) => path.join(modelDir, name),
    },
    llamaRoot: path.join(root, 'LlamaRuntime'),
    runner,
    cli,
    createServer: () => {
      const sidecar = new LlamaSidecar({ guard: noGuard, healthPollMs: 25, killGraceMs: 500 });
      created.push(sidecar);
      return sidecar;
    },
    resolveRuntime: () =>
      Promise.resolve({
        exe: process.execPath,
        gpuOffload: false,
        argsPrefix: [FAKE_SERVER],
        extraArgs: ['--fake-reply-tokens', '6'],
        healthTimeoutMs: 15_000,
      }),
  });
  runtimes.push(runtime);
  return { settings, runner, runtime, modelDir, created };
}

const request = { transcript: 'Hola a todos', title: 'Reunión', recordedAt, outputLanguage: 'es' };
const never = new CancelSource().signal;

describe('SummaryRuntime on a real settings.json', () => {
  it('B2: camelCase model and effort in the file reach the CLI argv', async () => {
    const t = build();
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        selectedSummaryProvider: 'ClaudeCode',
        selectedClaudeModelId: 'opus',
        selectedClaudeEffort: 'high',
        selectedCodexModelId: 'gpt-5.5',
        selectedCodexEffort: 'medium',
      }),
    );
    const claude = await t.runtime.resolver.resolveSummaryProvider();
    const codex = await t.runtime.resolver.resolveSummaryProvider({ kind: 'Codex' });
    if (claude.status !== 'ready' || codex.status !== 'ready') throw new Error('not ready');
    await claude.provider.summarize(request, never);
    await codex.provider.summarize(request, never);
    const [a, b] = t.runner.calls;
    expect(a!.executable).toBe('claude');
    expect(a!.args).toContain('opus');
    expect(a!.args.join(' ')).toContain('high');
    expect(b!.executable).toBe('codex');
    expect(b!.args).toContain('gpt-5.5');
    expect(b!.args.join(' ')).toContain('medium');
  });

  it('B2 end to end: a model and effort chosen on the Settings page reach the next CLI call (174, 175)', async () => {
    const t = build();
    const commands = new SettingsCommands({
      store: new JsonSettingsStore({ settingsFilePath: settingsFile }),
      osLanguages: () => ['en-US'],
    });
    expect(await commands.setSummaryProvider('ClaudeCode')).toMatchObject({ status: 'saved' });
    const model = await commands.setCliOption({
      provider: 'claude',
      field: 'model',
      value: 'opus',
    });
    expect(model).toMatchObject({ status: 'saved' });
    const effort = await commands.setCliOption({
      provider: 'claude',
      field: 'effort',
      value: 'high',
    });
    expect(effort).toMatchObject({
      status: 'saved',
      feedback: { key: 'Xai_FeedbackModel', args: ['opus · high'] },
    });
    const ready = await t.runtime.resolver.resolveSummaryProvider();
    if (ready.status !== 'ready') throw new Error('not ready');
    await ready.provider.summarize(request, never);
    const call = t.runner.calls[0]!;
    expect(call.executable).toBe('claude');
    expect(call.args).toContain('opus');
    expect(call.args.join(' ')).toContain('high');
    // The page asked again later still sees what the provider used.
    await commands.setCliOption({ provider: 'claude', field: 'model', value: 'haiku' });
    const again = await t.runtime.resolver.resolveSummaryProvider();
    if (again.status !== 'ready') throw new Error('not ready');
    await again.provider.summarize(request, never);
    expect(t.runner.calls[1]!.args).toContain('haiku');
  });

  it('reads PascalCase files too and defaults to sonnet/low and gpt-5.6/low', async () => {
    const t = build();
    fs.writeFileSync(settingsFile, JSON.stringify({ SelectedClaudeModelId: 'haiku' }));
    const claude = await t.runtime.factory.create('ClaudeCode');
    const codex = await t.runtime.factory.create('Codex');
    await claude.completePrompt('p', never);
    await codex.completePrompt('p', never);
    expect(t.runner.calls[0]!.args).toContain('haiku');
    expect(t.runner.calls[0]!.args.join(' ')).toContain('low');
    expect(t.runner.calls[1]!.args.join(' ')).toContain('gpt-5.6');
    expect(t.runner.calls[1]!.args.join(' ')).toContain('low');
  });

  it('B19: two parallel patches to different fields both survive on disk', async () => {
    const t = build();
    await Promise.all([
      t.settings.update({ selectedSummaryModelId: ONE_B.fileName }),
      t.settings.update({ selectedSummaryProvider: 'Codex' }),
      t.settings.update({ selectedCodexEffort: 'high' }),
    ]);
    const disk = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
    expect(disk).toMatchObject({
      selectedSummaryModelId: ONE_B.fileName,
      selectedSummaryProvider: 'Codex',
      selectedCodexEffort: 'high',
    });
  });

  it('parity 176/183: every field round trips and summaryLanguage defaults to es', async () => {
    const t = build();
    const fresh = await t.settings.load();
    expect(fresh.summaryLanguage ?? 'es').toBe('es');
    const { resolveSummaryLanguage } = await import('@vozella/core');
    expect(resolveSummaryLanguage(fresh)).toBe('es');
    const patch = {
      selectedSummaryModelId: 'm.gguf',
      selectedSummaryProvider: 'Codex',
      selectedXaiModelId: 'x',
      selectedXaiEffort: 'low',
      selectedClaudeModelId: 'opus',
      selectedClaudeEffort: 'high',
      selectedCodexModelId: 'gpt-5.5',
      selectedCodexEffort: 'medium',
      summaryLanguage: 'en',
      typeSafeEnabled: false,
    };
    await t.settings.update(patch);
    const reloaded = await new JsonSettingsStore({ settingsFilePath: settingsFile }).load();
    expect(reloaded).toMatchObject(patch);
  });

  it('Local: saved model and file give a ready provider; two providers share one server (B3)', async () => {
    const t = build();
    expect(await t.runtime.resolver.resolveSummaryProvider({ kind: 'Local' })).toMatchObject({
      status: 'needs-setup',
      reason: 'model-missing',
    });
    fs.writeFileSync(path.join(t.modelDir, ONE_B.fileName), 'x');
    await t.settings.update({ selectedSummaryModelId: ONE_B.fileName });
    const first = await t.runtime.resolver.resolveSummaryProvider({ kind: 'Local' });
    const second = await t.runtime.resolver.resolveSummaryProvider({ kind: 'Local' });
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('not ready');
    expect(first.provider).not.toBe(second.provider);
    expect(first.modelPath).toBe(path.join(t.modelDir, ONE_B.fileName));
    await first.provider.completePrompt('uno', never);
    await second.provider.completePrompt('dos', never);
    expect(t.created).toHaveLength(1);
  });

  it('B3: dispose on quit kills a loaded server', async () => {
    const t = build();
    fs.writeFileSync(path.join(t.modelDir, ONE_B.fileName), 'x');
    await t.settings.update({ selectedSummaryModelId: ONE_B.fileName });
    const gate = await t.runtime.resolver.resolveSummaryProvider({ kind: 'Local' });
    if (gate.status !== 'ready') throw new Error('not ready');
    await gate.provider.completePrompt('uno', never);
    const pid = t.created[0]!.pid!;
    expect(pidAlive(pid)).toBe(true);
    await t.runtime.dispose();
    expect(await waitUntil(() => !pidAlive(pid), 5000)).toBe(true);
  });

  it('Xai in the file is unavailable and does not touch the host', async () => {
    const t = build();
    fs.writeFileSync(settingsFile, JSON.stringify({ selectedSummaryProvider: 'Xai' }));
    expect(await t.runtime.resolver.resolveSummaryProvider()).toEqual({
      status: 'unavailable',
      kind: 'Xai',
      reason: 'xai-removed',
    });
    expect(t.created).toHaveLength(0);
  });

  it('missing CLI gives needs-setup', async () => {
    const t = build([]);
    expect(await t.runtime.resolver.resolveSummaryProvider({ kind: 'ClaudeCode' })).toMatchObject({
      status: 'needs-setup',
      reason: 'cli-missing',
    });
  });
});

describe('backend choice and an incomplete GPU read (B17)', () => {
  const make = (complete: boolean) => {
    const modelDir = path.join(root, 'SummaryModels');
    const runtime = new SummaryRuntime({
      settings: new JsonSettingsStore({ settingsFilePath: settingsFile }),
      hardware: {
        detect: () =>
          Promise.resolve({
            totalRamGb: 16,
            gpuName: null,
            gpuVramGb: null,
            ...(complete ? {} : { gpuReadComplete: false }),
          }),
      },
      models: {
        isDownloaded: () => Promise.resolve(false),
        download: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        pathFor: (name) => path.join(modelDir, name),
      },
      llamaRoot: path.join(root, 'LlamaRuntime'),
    });
    runtimes.push(runtime);
    const ensured = { count: 0 };
    runtime.runtimeManager.ensure = () => {
      ensured.count += 1;
      return Promise.resolve(process.execPath);
    };
    runtime.runtimeManager.binDirectory = () => path.dirname(process.execPath);
    const pick = () =>
      (runtime as unknown as { pickRuntime(c: typeof never): Promise<unknown> }).pickRuntime(never);
    return { pick, ensured };
  };

  it('a failed GPU read is not locked in: the next call chooses again', async () => {
    const t = make(false);
    await t.pick();
    await t.pick();
    expect(t.ensured.count).toBe(2);
  });

  it('a complete read is chosen once for the process', async () => {
    const t = make(true);
    await t.pick();
    await t.pick();
    expect(t.ensured.count).toBe(1);
  });
});
