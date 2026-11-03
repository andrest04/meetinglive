import { describe, expect, it } from 'vitest';
import { CancelSource } from '../cancel';
import { InMemorySettingsStore } from '../library/in-memory-library';
import type { AppSettings, SettingsStore } from '../library';
import { cliExecutableName } from '../settings/cli-providers';
import type { CliPathProbe } from '../settings/ports';
import { SUMMARY_MODELS, type SummaryModelInfo } from '../settings/summary-models';
import { SummaryProviderFactory } from './provider-factory';
import { SummaryProviderResolver } from './provider-resolver';
import type { SummaryProvider } from './provider';
import { FakeCliProcessRunner } from './test-kit';

const ONE_B = SUMMARY_MODELS[0]!;

class FakeProbe implements CliPathProbe {
  readonly present = new Set<string>();
  readonly asked: string[] = [];
  isOnPath(executable: string): Promise<boolean> {
    this.asked.push(executable);
    return Promise.resolve(this.present.has(executable));
  }
}

function setup(downloaded: readonly string[] = []) {
  const settings = new InMemorySettingsStore();
  const runner = new FakeCliProcessRunner('## Summary\nhi');
  const probe = new FakeProbe();
  const localPaths: string[] = [];
  const localProvider = { id: 'local' } as unknown as SummaryProvider;
  const factory = new SummaryProviderFactory({
    settings,
    runner,
    createLocal: (path) => {
      localPaths.push(path);
      return localProvider;
    },
  });
  const resolver = new SummaryProviderResolver({
    settings,
    cli: probe,
    models: {
      isDownloaded: (m: SummaryModelInfo) => Promise.resolve(downloaded.includes(m.fileName)),
      pathFor: (name) => `C:/models/${name}`,
    },
    factory,
  });
  return { settings, runner, probe, localPaths, localProvider, factory, resolver };
}

const summarize = (p: SummaryProvider) =>
  p.summarize(
    {
      transcript: 'Hello there',
      recordedAt: { dateTime: '2026-11-03T10:00:00', offsetMinutes: 0 },
      outputLanguage: 'en',
    } as never,
    new CancelSource().signal,
  );

describe('SummaryProviderResolver', () => {
  it('is ready for Local with the saved catalog model whose file exists', async () => {
    const t = setup([ONE_B.fileName]);
    await t.settings.update({ selectedSummaryModelId: ONE_B.fileName });
    const r = await t.resolver.resolveSummaryProvider({ kind: 'Local' });
    expect(r).toMatchObject({
      status: 'ready',
      kind: 'Local',
      modelPath: `C:/models/${ONE_B.fileName}`,
    });
    expect(t.localPaths).toEqual([`C:/models/${ONE_B.fileName}`]);
  });

  it('needs a model when none is saved, the id is not in the catalog, or the file is missing', async () => {
    const t = setup([ONE_B.fileName]);
    const expected = { status: 'needs-setup', kind: 'Local', reason: 'model-missing' };
    expect(await t.resolver.resolveSummaryProvider({ kind: 'Local' })).toEqual(expected);
    await t.settings.update({ selectedSummaryModelId: 'other.gguf' });
    expect(await t.resolver.resolveSummaryProvider({ kind: 'Local' })).toEqual(expected);
    // exact file name: a different case is not the catalog entry
    await t.settings.update({ selectedSummaryModelId: ONE_B.fileName.toUpperCase() });
    expect(await t.resolver.resolveSummaryProvider({ kind: 'Local' })).toEqual(expected);
    const missing = setup([]);
    await missing.settings.update({ selectedSummaryModelId: ONE_B.fileName });
    expect(await missing.resolver.resolveSummaryProvider({ kind: 'Local' })).toEqual(expected);
    expect(missing.localPaths).toEqual([]);
  });

  it.each([
    ['ClaudeCode', 'claude'],
    ['Codex', 'codex'],
  ] as const)(
    '%s is ready when %s is on PATH and needs setup when it is not',
    async (kind, exe) => {
      const t = setup();
      expect(await t.resolver.resolveSummaryProvider({ kind })).toEqual({
        status: 'needs-setup',
        kind,
        reason: 'cli-missing',
      });
      t.probe.present.add(exe);
      const r = await t.resolver.resolveSummaryProvider({ kind });
      expect(r.status).toBe('ready');
      expect(t.probe.asked).toEqual([exe, exe]);
      expect(t.runner.calls).toHaveLength(0);
    },
  );

  it('answers unavailable for Xai and never falls back to Local', async () => {
    const t = setup([ONE_B.fileName]);
    await t.settings.update({
      selectedSummaryProvider: 'Xai',
      selectedSummaryModelId: ONE_B.fileName,
    });
    expect(await t.resolver.resolveSummaryProvider()).toEqual({
      status: 'unavailable',
      kind: 'Xai',
      reason: 'xai-removed',
    });
    expect(await t.resolver.resolveSummaryProvider({ kind: 'Xai' })).toMatchObject({
      status: 'unavailable',
    });
    expect(t.localPaths).toEqual([]);
  });

  it('B35: unknown, numeric or blank saved provider names resolve to Local', async () => {
    const t = setup();
    for (const name of ['Grok', '7', '', 'claudecode', null]) {
      await t.settings.update({ selectedSummaryProvider: name });
      expect(await t.resolver.resolveSummaryProvider()).toMatchObject({
        status: 'needs-setup',
        kind: 'Local',
      });
    }
    // a numeric value written by hand in the file is not a provider either
    const raw = { selectedSummaryProvider: 2 } as unknown as Partial<AppSettings>;
    await t.settings.update(raw);
    expect(await t.resolver.resolveSummaryProvider()).toMatchObject({ kind: 'Local' });
  });

  it('uses the saved provider when no kind is given', async () => {
    const t = setup();
    t.probe.present.add('codex');
    await t.settings.update({ selectedSummaryProvider: 'Codex' });
    expect(await t.resolver.resolveSummaryProvider()).toMatchObject({
      status: 'ready',
      kind: 'Codex',
    });
  });

  it('builds the web search variant only when asked', async () => {
    const t = setup();
    t.probe.present.add('claude');
    const plain = await t.resolver.resolveSummaryProvider({ kind: 'ClaudeCode' });
    const web = await t.resolver.resolveSummaryProvider({ kind: 'ClaudeCode', webSearch: true });
    if (plain.status !== 'ready' || web.status !== 'ready') throw new Error('not ready');
    await summarize(plain.provider);
    await summarize(web.provider);
    const [a, b] = t.runner.calls;
    expect(a!.args.join(' ')).not.toMatch(/web/i);
    expect(b!.args.join(' ')).toMatch(/web/i);
  });
});

describe('SummaryProviderFactory', () => {
  it('requires a model path for Local', async () => {
    const t = setup();
    await expect(t.factory.create('Local')).rejects.toThrow(TypeError);
    await expect(t.factory.create('Local', { modelPath: null })).rejects.toThrow(TypeError);
  });

  it('refuses Xai', async () => {
    await expect(setup().factory.create('Xai')).rejects.toThrow(RangeError);
  });

  it('builds a new provider on every call', async () => {
    const t = setup();
    const a = await t.factory.create('Codex');
    const b = await t.factory.create('Codex');
    expect(a).not.toBe(b);
  });

  it('B2: model and effort from a camelCase settings snapshot reach the CLI argv', async () => {
    const t = setup();
    await t.settings.update({
      selectedClaudeModelId: 'opus',
      selectedClaudeEffort: 'high',
      selectedCodexModelId: 'gpt-5.5',
      selectedCodexEffort: 'medium',
    });
    await summarize(await t.factory.create('ClaudeCode'));
    await summarize(await t.factory.create('Codex'));
    const [claude, codex] = t.runner.calls;
    expect(claude!.args).toEqual(expect.arrayContaining(['opus']));
    expect(claude!.args.join(' ')).toContain('high');
    expect(codex!.args).toEqual(expect.arrayContaining(['gpt-5.5']));
    expect(codex!.args.join(' ')).toContain('medium');
  });

  it('sees a settings change on the next call and defaults to sonnet/low and gpt-5.6/low', async () => {
    const t = setup();
    await summarize(await t.factory.create('ClaudeCode'));
    await summarize(await t.factory.create('Codex'));
    expect(t.runner.calls[0]!.args.join(' ')).toContain('sonnet');
    expect(t.runner.calls[0]!.args.join(' ')).toContain('low');
    expect(t.runner.calls[1]!.args.join(' ')).toContain('gpt-5.6');
    expect(t.runner.calls[1]!.args.join(' ')).toContain('low');
    await t.settings.update({ selectedClaudeModelId: 'opus' });
    await summarize(await t.factory.create('ClaudeCode'));
    expect(t.runner.calls[2]!.args).toContain('opus');
  });

  it('reads settings only through SettingsStore.load', async () => {
    const t = setup();
    let loads = 0;
    const counting: SettingsStore = {
      load: () => {
        loads += 1;
        return t.settings.load();
      },
      update: (p) => t.settings.update(p),
    };
    const factory = new SummaryProviderFactory({
      settings: counting,
      runner: t.runner,
      createLocal: () => t.localProvider,
    });
    await factory.create('Codex');
    await factory.create('ClaudeCode');
    expect(loads).toBe(2);
  });
});

describe('cliExecutableName', () => {
  it('throws RangeError for non CLI kinds', () => {
    expect(() => cliExecutableName('Local')).toThrow(RangeError);
    expect(() => cliExecutableName('Local')).toThrow(
      'Only ClaudeCode and Codex are CLI-backed providers.',
    );
  });
});
