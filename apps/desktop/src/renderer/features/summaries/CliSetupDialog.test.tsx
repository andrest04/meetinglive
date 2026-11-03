// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { CliSetupDialog } from './CliSetupDialog';
import { SetupWizardDialog } from './SetupWizardDialog';
import { installSummariesApi } from './summaries-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const checkAnswer = (found: boolean, kind: 'claude' | 'codex' = 'claude') => ({
  found,
  executable: kind,
  hintKey: kind === 'claude' ? ('Cli_ClaudeHint' as const) : ('Cli_CodexHint' as const),
});

describe('CliSetupDialog', () => {
  it('names the CLI, shows the executable and the install hint, and offers Retry and Cancel', async () => {
    installSummariesApi();
    render(
      <Providers>
        <CliSetupDialog open kind="ClaudeCode" onFinished={vi.fn()} />
      </Providers>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Set up the Claude Code CLI' });
    expect(within(dialog).getByText('Not found on PATH')).toBeVisible();
    const message = within(dialog).getByTestId('TxtCliMessage');
    expect(message).toHaveTextContent(`find "claude" on your PATH`);
    expect(message).toHaveTextContent('select Retry.');
    const link = within(message).getByRole('link', { name: 'https://claude.com/claude-code' });
    expect(link).toHaveAttribute('href', 'https://claude.com/claude-code');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('keeps the npm command as plain text for Codex', async () => {
    installSummariesApi();
    render(
      <Providers>
        <CliSetupDialog open kind="Codex" onFinished={vi.fn()} />
      </Providers>,
    );
    const message = await screen.findByTestId('TxtCliMessage');
    expect(message).toHaveTextContent('npm install -g @openai/codex');
    expect(
      within(message)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['https://github.com/openai/codex']);
  });

  it('a Retry that misses keeps the dialog open with the still-missing line (item 140)', async () => {
    const onFinished = vi.fn();
    const api = installSummariesApi({ 'summaries.checkCli': () => checkAnswer(false) });
    render(
      <Providers>
        <CliSetupDialog open kind="ClaudeCode" onFinished={onFinished} />
      </Providers>,
    );
    await userEvent.click(await screen.findByTestId('BtnCliRetry'));
    await waitFor(() => {
      expect(screen.getByTestId('TxtCliMessage')).toHaveTextContent(
        'Still not found on PATH as "claude". Install it, then try again.',
      );
    });
    expect(onFinished).not.toHaveBeenCalled();
    expect(api.calls.find((c) => c.name === 'summaries.checkCli')?.input).toEqual({
      kind: 'ClaudeCode',
    });
    expect(screen.getByTestId('BtnCliRetry')).toBeEnabled();
  });

  it('Retry that finds the CLI closes with true, after a miss', async () => {
    const onFinished = vi.fn();
    let found = false;
    installSummariesApi({ 'summaries.checkCli': () => checkAnswer(found) });
    render(
      <Providers>
        <CliSetupDialog open kind="ClaudeCode" onFinished={onFinished} />
      </Providers>,
    );
    await userEvent.click(await screen.findByTestId('BtnCliRetry'));
    await screen.findByText(/Still not found/);
    found = true;
    await userEvent.click(screen.getByTestId('BtnCliRetry'));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledExactlyOnceWith(true);
    });
  });

  it('Cancel finishes with false', async () => {
    const onFinished = vi.fn();
    installSummariesApi();
    render(
      <Providers>
        <CliSetupDialog open kind="Codex" onFinished={onFinished} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onFinished).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('says the same in Spanish', async () => {
    installSummariesApi({ 'summaries.checkCli': () => checkAnswer(false) });
    render(
      <Providers locale="es">
        <CliSetupDialog open kind="ClaudeCode" onFinished={vi.fn()} />
      </Providers>,
    );
    await screen.findByRole('dialog', { name: 'Configurar la CLI de Claude Code' });
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await userEvent.click(screen.getByTestId('BtnCliRetry'));
    await screen.findByText(/Sigue sin encontrarse/);
  });
});

describe('wizard CLI check panel', () => {
  const mountWizard = (handlers: Parameters<typeof installSummariesApi>[0]) => {
    const api = installSummariesApi(handlers);
    const onFinished = vi.fn();
    render(
      <Providers>
        <SetupWizardDialog open mode="choose" onFinished={onFinished} />
      </Providers>,
    );
    return { api, onFinished };
  };

  it('a CLI that is there is saved on entering and the wizard closes with it', async () => {
    const { api, onFinished } = mountWizard({
      'summaries.chooseCli': () => ({ status: 'saved', settings: {} }),
    });
    await userEvent.click(await screen.findByTestId('BtnEngineClaudeCode'));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'ClaudeCode' });
    });
    expect(api.calls.filter((c) => c.name === 'summaries.chooseCli')).toHaveLength(1);
  });

  it('a missing CLI shows the check-again text; Check again that misses says still missing', async () => {
    const { onFinished } = mountWizard({
      'summaries.chooseCli': () => ({
        status: 'not-found',
        executable: 'codex',
        hintKey: 'Cli_CodexHint',
      }),
    });
    await userEvent.click(await screen.findByTestId('BtnEngineCodex'));
    const message = await screen.findByTestId('TxtCliMessage');
    expect(message).toHaveTextContent('select "Check again".');
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => {
      expect(screen.getByTestId('TxtCliMessage')).toHaveTextContent(
        'Still not found on PATH as "codex".',
      );
    });
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('Check again that finds the CLI saves it and finishes; Back returns to the chooser', async () => {
    let installed = false;
    const { onFinished } = mountWizard({
      'summaries.chooseCli': () =>
        installed
          ? { status: 'saved', settings: {} }
          : { status: 'not-found', executable: 'claude', hintKey: 'Cli_ClaudeHint' },
    });
    await userEvent.click(await screen.findByTestId('BtnEngineClaudeCode'));
    await screen.findByTestId('PanelCliCheck');
    await userEvent.click(screen.getByTestId('BtnBackToEngineChoice'));
    expect(await screen.findByTestId('BtnEngineCodex')).toBeVisible();
    await userEvent.click(screen.getByTestId('BtnEngineClaudeCode'));
    await screen.findByTestId('PanelCliCheck');
    installed = true;
    await userEvent.click(screen.getByTestId('BtnRecheckCli'));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'ClaudeCode' });
    });
  });
});
