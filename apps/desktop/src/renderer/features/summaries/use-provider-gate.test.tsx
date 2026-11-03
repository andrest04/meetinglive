// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { ProviderGateDialogs, ProviderUnavailableNotice } from './ProviderGateDialogs';
import { installSummariesApi } from './summaries-test-kit';
import { decideSurface, useProviderGate, type SetupRequest } from './use-provider-gate';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('decideSurface', () => {
  const table: [SetupRequest, string][] = [
    [{ kind: 'Local', reason: 'model-missing' }, 'wizard'],
    [{ kind: 'ClaudeCode', reason: 'cli-missing' }, 'cli'],
    [{ kind: 'Codex', reason: 'cli-missing' }, 'cli'],
    [{ kind: 'Xai', reason: 'unavailable' }, 'notice'],
  ];
  it.each(table)('%j opens %s', (request, surface) => {
    expect(decideSurface(request).surface).toBe(surface);
  });
});

function Harness({ onRun }: { onRun: (gate: ReturnType<typeof useProviderGate>) => void }) {
  const gate = useProviderGate();
  onRun(gate);
  return (
    <>
      <ProviderUnavailableNotice gate={gate} />
      <ProviderGateDialogs gate={gate} />
    </>
  );
}

function mount(handlers: Parameters<typeof installSummariesApi>[0] = {}) {
  const api = installSummariesApi({
    'summaries.hardware': () => ({
      hardware: { totalRamGb: 16, gpuName: null, gpuVramGb: null },
      rows: [],
      defaultFileName: null,
    }),
    'summaries.cancelLocalModel': () => ({ cancelled: true }),
    ...handlers,
  });
  let gate!: ReturnType<typeof useProviderGate>;
  render(
    <Providers>
      <Harness
        onRun={(g) => {
          gate = g;
        }}
      />
    </Providers>,
  );
  return { api, run: (request: SetupRequest) => gate.runSetup(request) };
}

describe('useProviderGate', () => {
  it('Local opens the wizard on the model step and cancelling resolves cancelled', async () => {
    const { run } = mount();
    let result: Promise<string> | undefined;
    act(() => {
      result = run({ kind: 'Local', reason: 'model-missing' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Set up summary generation' });
    expect(dialog).toBeVisible();
    expect(screen.queryByTestId('BtnEngineCodex')).toBeNull();
    await userEvent.click(screen.getByTestId('BtnSetupCancel'));
    await expect(result).resolves.toBe('cancelled');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a missing CLI opens the CLI dialog; Retry that finds it resolves completed', async () => {
    let installed = false;
    const { api, run } = mount({
      'summaries.checkCli': () => ({
        found: installed,
        executable: 'codex',
        hintKey: 'Cli_CodexHint',
      }),
    });
    let result: Promise<string> | undefined;
    act(() => {
      result = run({ kind: 'Codex', reason: 'cli-missing' });
    });
    expect(await screen.findByRole('dialog', { name: 'Set up the Codex CLI' })).toBeVisible();
    await userEvent.click(screen.getByTestId('BtnCliRetry'));
    await waitFor(() => {
      expect(screen.getByTestId('TxtCliMessage').textContent).toContain('Still not found');
    });
    installed = true;
    await userEvent.click(screen.getByTestId('BtnCliRetry'));
    await expect(result).resolves.toBe('completed');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.filter((c) => c.name === 'summaries.checkCli')).toHaveLength(2);
  });

  it('cancelling the CLI dialog resolves cancelled', async () => {
    const { run } = mount();
    let result: Promise<string> | undefined;
    act(() => {
      result = run({ kind: 'ClaudeCode', reason: 'cli-missing' });
    });
    await userEvent.click(await screen.findByTestId('BtnCliCancel'));
    await expect(result).resolves.toBe('cancelled');
  });

  it('a removed provider shows a notice with a link to Settings and no dialog', async () => {
    const { api, run } = mount();
    let result: Promise<string> | undefined;
    act(() => {
      result = run({ kind: 'Xai', reason: 'unavailable' });
    });
    await expect(result).resolves.toBe('cancelled');
    expect(await screen.findByTestId('TxtProviderUnavailable')).toHaveTextContent(
      'Grok (xAI) is no longer available',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByTestId('BtnOpenSettings'));
    expect(api.calls).toContainEqual({
      name: 'workspace.dispatch',
      input: { action: { type: 'navigateTo', tag: 'Settings' } },
    });
    expect(screen.queryByTestId('TxtProviderUnavailable')).toBeNull();
  });

  it('a second request while a dialog is open is cancelled, not stacked', async () => {
    const { run } = mount();
    act(() => {
      void run({ kind: 'ClaudeCode', reason: 'cli-missing' });
    });
    await screen.findByRole('dialog');
    let second: Promise<string> | undefined;
    act(() => {
      second = run({ kind: 'Codex', reason: 'cli-missing' });
    });
    await expect(second).resolves.toBe('cancelled');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('leaving the page while a dialog is open releases the caller', async () => {
    installSummariesApi();
    const { result, unmount } = renderHook(() => useProviderGate(), { wrapper: Providers });
    let pending: Promise<string> | undefined;
    act(() => {
      pending = result.current.runSetup({ kind: 'Local', reason: 'model-missing' });
    });
    unmount();
    await expect(pending).resolves.toBe('cancelled');
  });
});
