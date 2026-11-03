import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '../library';
import { ExitGateRegistry, RestartService } from './exit-gate';
import { LocalModelsService } from './local-models';
import { SettingsNotices } from './notices';
import { SettingsPageService } from './page-service';
import type { CliPathProbe, HardwareProbe, LocalModelStore } from './ports';
import type { HardwareProfile } from './summary-models';
import { XaiAccountService } from './xai-account';

const hardware: HardwareProfile = { totalRamGb: 16, gpuName: 'GPU', gpuVramGb: 8 };

function page(
  options: {
    os?: string[];
    cli?: Record<string, boolean>;
    hardware?: HardwareProbe;
    models?: Set<string>;
    store?: InMemorySettingsStore;
  } = {},
) {
  const store = options.store ?? new InMemorySettingsStore();
  const files = options.models ?? new Set<string>();
  const modelStore: LocalModelStore = {
    isDownloaded: (m) => Promise.resolve(files.has(m.fileName)),
    download: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
  const probe: CliPathProbe = {
    isOnPath: (name) => Promise.resolve(options.cli?.[name] ?? false),
  };
  const notices = new SettingsNotices();
  const service = new SettingsPageService({
    store,
    osLanguages: () => options.os ?? ['en-US'],
    hardware: options.hardware ?? { detect: () => Promise.resolve(hardware) },
    models: new LocalModelsService({ store: modelStore, settings: store, notify: () => undefined }),
    xai: new XaiAccountService({ port: null, store }),
    cli: probe,
    notices,
    capabilities: { xaiAccount: false, xaiSignIn: false, localModels: true },
  });
  return { store, service, notices, files };
}

describe('SettingsPageService.load', () => {
  it('defaults when nothing is saved, and nothing is written', async () => {
    const { service, store } = page();
    const snapshot = await service.load();
    expect(snapshot).toMatchObject({
      uiLanguage: 'en-US',
      provider: 'Local',
      transcriptionLanguage: 'es',
      summaryLanguage: 'es',
      claude: { model: 'sonnet', effort: 'low' },
      codex: { model: 'gpt-5.6', effort: 'low' },
      xaiEffort: 'low',
      cliStatus: null,
      hardware,
      capabilities: { localModels: true, xaiAccount: false },
    });
    expect(await store.load()).toMatchObject({ uiLanguage: null, selectedSummaryProvider: null });
  });

  it('the app language follows the OS when nothing is saved, and the saved choice otherwise', async () => {
    const { service, store } = page({ os: ['es-MX'] });
    expect((await service.load()).uiLanguage).toBe('es');
    await store.update({ uiLanguage: 'en-US' });
    expect((await service.load()).uiLanguage).toBe('en-US');
  });

  it('B13: option lists include a stored value that is not on the list', async () => {
    const { service, store } = page();
    await store.update({ selectedClaudeModelId: 'gpt-9', selectedCodexEffort: 'max' });
    const snapshot = await service.load();
    expect(snapshot.claude.modelOptions).toEqual(['sonnet', 'opus', 'haiku', 'fable', 'gpt-9']);
    expect(snapshot.claude.model).toBe('gpt-9');
    expect(snapshot.codex.effortOptions).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('B6: the pickers show the same code the engine uses', async () => {
    const { service, store } = page();
    await store.update({ transcriptionLanguage: ' PT ', summaryLanguage: 'xx' });
    const snapshot = await service.load();
    expect(snapshot.transcriptionLanguage).toBe('pt');
    expect(snapshot.summaryLanguage).toBe('es');
  });

  it('detects the CLI only for the CLI backed provider that is selected', async () => {
    const { service, store } = page({ cli: { claude: true, codex: false } });
    await store.update({ selectedSummaryProvider: 'ClaudeCode' });
    expect((await service.load()).cliStatus).toBe('detected');
    await store.update({ selectedSummaryProvider: 'Codex' });
    expect((await service.load()).cliStatus).toBe('missing');
    await store.update({ selectedSummaryProvider: 'Xai' });
    expect((await service.load()).cliStatus).toBeNull();
  });

  it('B15: detection can be asked again after the CLI is installed', async () => {
    const cli = { claude: false };
    const { service, store } = page({ cli });
    await store.update({ selectedSummaryProvider: 'ClaudeCode' });
    expect(await service.detectCli('ClaudeCode')).toBe('missing');
    cli.claude = true;
    expect(await service.detectCli('ClaudeCode')).toBe('detected');
    expect(await service.detectCli('Local')).toBeNull();
  });

  it('a hardware probe that fails leaves the page loading, without fit ratings', async () => {
    const { service } = page({ hardware: { detect: () => Promise.reject(new Error('no WMI')) } });
    const snapshot = await service.load();
    expect(snapshot.hardware).toBeNull();
    expect(snapshot.models.rows.every((row) => row.fit === null)).toBe(true);
  });

  it('8.6: starts the settings read and the hardware probe together', async () => {
    const started: string[] = [];
    class SpyStore extends InMemorySettingsStore {
      override load() {
        started.push('settings');
        return super.load();
      }
    }
    const { service } = page({
      store: new SpyStore(),
      hardware: {
        detect: () => {
          started.push('hardware');
          return new Promise(() => undefined);
        },
      },
    });
    void service.load();
    // The probe never answers, yet the settings read has already started: nothing waits.
    await Promise.resolve();
    expect(started.sort()).toEqual(['hardware', 'settings']);
  });

  it('lists the models with the active one and the missing active id', async () => {
    const files = new Set(['gemma-4-E2B-it-Q4_K_M.gguf']);
    const { service, store } = page({ models: files });
    await store.update({ selectedSummaryModelId: 'gemma-4-E2B-it-Q4_K_M.gguf' });
    const snapshot = await service.load();
    expect(snapshot.models.rows.map((row) => row.active)).toEqual([false, true, false, false]);
    expect(snapshot.models.missingActiveId).toBeNull();
    files.clear();
    expect((await service.load()).models.missingActiveId).toBe('gemma-4-E2B-it-Q4_K_M.gguf');
  });

  it('carries the xAI account view and the notices', async () => {
    const { service, notices } = page();
    notices.add({ kind: 'settings-recovered', keptAs: 'settings.json.corrupt' });
    const snapshot = await service.load();
    expect(snapshot.xai).toMatchObject({ available: false });
    expect(snapshot.notices).toEqual([
      { id: 'settings-recovered', kind: 'settings-recovered', keptAs: 'settings.json.corrupt' },
    ]);
  });

  it('B18: a settings read that fails is an error value, not defaults shown as if loaded', async () => {
    const { service, store } = page();
    store.load = () => Promise.reject(new Error('EACCES'));
    await expect(service.load()).rejects.toThrow('EACCES');
  });
});

describe('SettingsNotices', () => {
  it('keeps one notice per kind until it is dismissed', () => {
    const notices = new SettingsNotices();
    notices.add({ kind: 'settings-recovered', keptAs: 'a' });
    notices.add({ kind: 'settings-recovered', keptAs: 'b' });
    expect(notices.pending()).toEqual([
      { id: 'settings-recovered', kind: 'settings-recovered', keptAs: 'b' },
    ]);
    notices.dismiss('settings-recovered');
    expect(notices.pending()).toEqual([]);
  });
});

describe('exit gate and restart', () => {
  it('may exit when nothing is registered', async () => {
    expect(await new ExitGateRegistry().mayExit()).toBe(true);
  });

  it('every gate must allow; a refusal or a throw stops the exit', async () => {
    const gates = new ExitGateRegistry();
    gates.register(() => true);
    expect(await gates.mayExit()).toBe(true);
    const off = gates.register(() => Promise.resolve(false));
    expect(await gates.mayExit()).toBe(false);
    off();
    expect(await gates.mayExit()).toBe(true);
    gates.register(() => {
      throw new Error('gate broke');
    });
    expect(await gates.mayExit()).toBe(false);
  });

  it('restart asks the gate first and does not relaunch when it refuses', async () => {
    const gates = new ExitGateRegistry();
    const calls: string[] = [];
    const restart = new RestartService({
      gates,
      relaunch: () => {
        calls.push('relaunch');
      },
    });
    gates.register(() => false);
    expect(await restart.restart()).toEqual({ status: 'refused' });
    expect(calls).toEqual([]);
  });

  it('restart relaunches when the gate allows', async () => {
    const calls: string[] = [];
    const restart = new RestartService({
      gates: new ExitGateRegistry(),
      relaunch: () => {
        calls.push('relaunch');
      },
    });
    expect(await restart.restart()).toEqual({ status: 'restarting' });
    expect(calls).toEqual(['relaunch']);
  });

  it('B10: a relaunch that fails is reported with its message', async () => {
    const restart = new RestartService({
      gates: new ExitGateRegistry(),
      relaunch: () => {
        throw new Error('cannot spawn');
      },
    });
    expect(await restart.restart()).toEqual({ status: 'failed', message: 'cannot spawn' });
  });
});
