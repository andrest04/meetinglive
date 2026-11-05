// @vitest-environment jsdom
import type { SettingsPageDto } from '@vozella/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../app/theme';
import { Providers } from '../library/library-test-kit';
import { SettingsRoute } from './SettingsRoute';
import { resetSettingsPageCache } from './use-settings-page';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const model = (fileName: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  fileName,
  displayName,
  fileSizeGb: 3.11,
  minRamGb: 6,
  speedKey: 'ModelSpeedFast',
  qualityKey: 'ModelQualityVeryGood',
  useCaseKey: 'ModelUseCaseRecommendedDefault',
  fit: 'Recommended',
  downloaded: false,
  active: false,
  downloading: false,
  percent: null,
  ...extra,
});

function pageDto(extra: Record<string, unknown> = {}): SettingsPageDto {
  return {
    settings: {},
    uiLanguage: 'en-US',
    provider: 'Local',
    claude: {
      model: 'sonnet',
      effort: 'low',
      modelOptions: ['sonnet', 'opus'],
      effortOptions: ['low', 'high'],
    },
    codex: {
      model: 'gpt-5.6',
      effort: 'low',
      modelOptions: ['gpt-5.6'],
      effortOptions: ['low'],
    },
    cliStatus: null,
    transcriptionLanguage: 'es',
    summaryLanguage: 'es',
    hardware: { totalRamGb: 16, gpuName: null, gpuVramGb: null },
    models: {
      rows: [model('a.gguf', 'Model A'), model('b.gguf', 'Model B', { downloaded: true })],
      missingActiveId: null,
    },
    providerNotice: null,
    capabilities: { localModels: true },
    notices: [],
    ...extra,
  } as unknown as SettingsPageDto;
}

const labelOf = (element: HTMLElement): HTMLElement => {
  const found: HTMLElement | null = element.closest<HTMLElement>('label');
  if (found === null) throw new Error('no label around the control');
  return found;
};
const groupOf = (element: HTMLElement): HTMLElement => {
  const found: HTMLElement | null = element.closest<HTMLElement>('[role="radiogroup"]');
  if (found === null) throw new Error('no radio group around the control');
  return found;
};

const allOn = { localModels: true };

type Handler = (input: unknown) => unknown;
const listeners = new Map<string, (payload: unknown) => void>();
const everyListener = new Set<[string, (payload: unknown) => void]>();
const emit = (name: string, payload: unknown) => {
  for (const [target, listener] of everyListener) if (target === name) listener(payload);
};

function install(handlers: Record<string, Handler>) {
  const calls: { name: string; input: unknown }[] = [];
  const api = {
    invoke: vi.fn((name: string, input: unknown) => {
      calls.push({ name, input });
      const handler = handlers[name];
      if (!handler) {
        if (name === 'library.getLocation') return new Promise(() => undefined);
        return Promise.reject(new Error(`unhandled ${name}`));
      }
      try {
        return Promise.resolve(handler(input));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
    on: (name: string, listener: (payload: unknown) => void) => {
      listeners.set(name, listener);
      const entry: [string, (payload: unknown) => void] = [name, listener];
      everyListener.add(entry);
      return () => {
        listeners.delete(name);
        everyListener.delete(entry);
      };
    },
  };
  Object.defineProperty(window, 'vozella', { value: api, configurable: true, writable: true });
  return calls;
}

const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <ThemeProvider>
      <Providers locale={locale}>
        <SettingsRoute />
      </Providers>
    </ThemeProvider>,
  );

beforeEach(() => {
  resetSettingsPageCache();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  listeners.clear();
});

describe('Settings page', () => {
  it('shows why the page could not load and tries again, instead of showing defaults', async () => {
    let attempt = 0;
    install({
      'settings.getPage': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk unreadable');
        return pageDto();
      },
    });
    mount();
    expect(
      await screen.findByText('The settings could not be loaded. disk unreadable'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
  });

  it('draws only the controls whose module is present', async () => {
    install({
      'settings.getPage': () => pageDto({ capabilities: { localModels: false } }),
    });
    mount();
    expect(await screen.findByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
    expect(screen.queryByRole('radiogroup', { name: 'Summary models' })).toBeNull();
  });

  it('asks for another provider when the saved one is the removed Grok, and offers no Grok radio', async () => {
    install({
      'settings.getPage': () => pageDto({ provider: 'Xai', providerNotice: 'xai-removed' }),
    });
    mount();
    expect(
      await screen.findByText(
        'Grok (xAI) is no longer available. Pick Local, Claude Code or Codex to summarize your meetings.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Grok/ })).toBeNull();
    const group = screen.getByRole('radiogroup', { name: 'Choose where summaries are generated' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'API key' })).toBeNull();
    expect(screen.queryByText('Not signed in')).toBeNull();
  });

  it('shows the notice in Spanish and clears it when another provider is picked', async () => {
    let saved = false;
    install({
      'settings.getPage': () =>
        saved
          ? pageDto({ provider: 'Codex' })
          : pageDto({ provider: 'Xai', providerNotice: 'xai-removed' }),
      'settings.setSummaryProvider': () => {
        saved = true;
        return { status: 'saved', settings: {}, feedback: null };
      },
    });
    mount('es');
    expect(
      await screen.findByText(
        'Grok (xAI) ya no está disponible. Elige Local, Claude Code o Codex para resumir tus reuniones.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Codex/ }));
    await waitFor(() => {
      expect(screen.queryByText(/Grok \(xAI\) ya no está disponible/)).toBeNull();
    });
  });

  it('offers Set up when no model is active, and it opens the wizard on the hardware step (S20)', async () => {
    let closed = 0;
    install({
      'settings.getPage': () => {
        closed += 1;
        return pageDto();
      },
      'summaries.hardware': () => new Promise(() => undefined),
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set up' }));
    expect(await screen.findByRole('dialog', { name: 'Set up summary generation' })).toBeVisible();
    expect(screen.getByText('Detecting hardware...')).toBeVisible();
    expect(screen.queryByText('Choose how to generate summaries')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Leaving the wizard reads the page again, so a model chosen there shows at once.
    expect(closed).toBeGreaterThan(1);
  });

  it('keeps Set up as the only primary action beside the Download buttons', async () => {
    install({ 'settings.getPage': () => pageDto() });
    mount();
    const setUp = await screen.findByRole('button', { name: 'Set up' });
    expect(setUp).toHaveClass('bg-ink');
    const group = screen.getByRole('radiogroup', { name: 'Summary models' });
    for (const button of within(group).getAllByRole('button')) {
      expect(button).not.toHaveClass('bg-ink');
    }
  });

  it('hides Set up once a model is active, and for the CLI providers (S20)', async () => {
    install({
      'settings.getPage': () =>
        pageDto({
          models: {
            rows: [model('b.gguf', 'Model B', { downloaded: true, active: true })],
            missingActiveId: null,
          },
        }),
    });
    mount();
    await screen.findByRole('radiogroup', { name: 'Summary models' });
    expect(screen.queryByRole('button', { name: 'Set up' })).toBeNull();
  });

  it('saves one field, shows the saved bar, and sends nothing for the value already shown (174, 175)', async () => {
    const calls = install({
      'settings.getPage': () => pageDto({ provider: 'ClaudeCode', cliStatus: 'detected' }),
      'settings.setCliOption': () => ({
        status: 'saved',
        settings: {},
        feedback: { key: 'Xai_FeedbackModel', args: ['sonnet · high'] },
      }),
    });
    mount();
    const user = userEvent.setup();
    await screen.findByText('Detected on PATH.');
    await user.click(screen.getByRole('combobox', { name: 'Effort' }));
    await user.click(await screen.findByRole('option', { name: 'low' }));
    expect(calls.filter((c) => c.name === 'settings.setCliOption')).toHaveLength(0);

    await user.click(screen.getByRole('combobox', { name: 'Effort' }));
    await user.click(await screen.findByRole('option', { name: 'high' }));
    expect(await screen.findByText('Saved. Using sonnet · high.')).toBeInTheDocument();
    expect(calls.filter((c) => c.name === 'settings.setCliOption').map((c) => c.input)).toEqual([
      { provider: 'claude', field: 'effort', value: 'high' },
    ]);
  });

  it('puts a control back and says so when a change is not saved', async () => {
    install({
      'settings.getPage': () => pageDto({ provider: 'ClaudeCode', cliStatus: 'detected' }),
      'settings.setCliOption': () => ({ status: 'failed', message: 'read-only disk' }),
    });
    mount();
    const user = userEvent.setup();
    await screen.findByText('Detected on PATH.');
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(await screen.findByRole('option', { name: 'opus' }));
    expect(
      await screen.findByText('This setting was not saved. read-only disk'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('sonnet');
  });

  it('shows a download as it runs, then the failure with the model name', async () => {
    let finish: (value: unknown) => void = () => undefined;
    install({
      'settings.getPage': () => pageDto(),
      'settings.models.download': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    mount();
    const user = userEvent.setup();
    const group = await screen.findByRole('radiogroup', { name: 'Summary models' });
    expect(within(group).getByRole('radio', { name: /Model A/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(group).getByRole('radio', { name: /Model B/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      within(group).getAllByText('Fast · Quality Very good · 3.1 GB download', { exact: false })[0],
    ).toBeInTheDocument();
    // A model that is not on this PC says why it cannot be picked, not only by being disabled.
    expect(within(group).getAllByText('Download to use')).toHaveLength(1);
    expect(within(group).getByRole('radio', { name: /Model A/ })).toHaveAccessibleName(
      /Download to use/,
    );
    expect(within(group).getByRole('radio', { name: /Model B/ })).not.toHaveAccessibleName(
      /Download to use/,
    );

    await user.click(within(group).getByRole('button', { name: 'Download' }));
    expect(
      await within(group).findByRole('button', { name: 'Cancel download' }),
    ).toBeInTheDocument();
    act(() => {
      listeners.get('settings.modelEvent')?.({ type: 'progress', fileName: 'a.gguf', percent: 42 });
    });
    expect(await within(group).findByRole('progressbar', { name: 'Downloading' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    await act(async () => {
      finish({ status: 'failed', message: 'offline' });
      await Promise.resolve();
    });
    expect(await screen.findByText('Could not download Model A. offline')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(group).queryByRole('button', { name: 'Cancel download' })).toBeNull();
    });
  });

  it('names a missing active model and keeps Delete working', async () => {
    const calls = install({
      'settings.getPage': () =>
        pageDto({
          models: {
            rows: [model('b.gguf', 'Model B', { downloaded: true })],
            missingActiveId: 'gone.gguf',
          },
        }),
      'settings.models.delete': () => ({ status: 'busy' }),
    });
    mount();
    expect(
      await screen.findByText(/gone\.gguf is not on this PC|selected model gone\.gguf/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Model B' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Model B?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Model B is downloading. Cancel the download first.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.name === 'settings.models.delete')).toBe(true);
  });

  it('asks before deleting a model: Cancel keeps it, Delete removes it and says so', async () => {
    let deleted = false;
    const calls = install({
      'settings.getPage': () =>
        pageDto({
          models: {
            rows: [model('b.gguf', 'Model B', { downloaded: !deleted })],
            missingActiveId: null,
          },
        }),
      'settings.models.delete': () => {
        deleted = true;
        return { status: 'deleted', settings: {} };
      },
    });
    mount();
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Delete Model B' });
    // The trigger is quiet, so it does not read like Download.
    expect(trigger).toHaveClass('bg-transparent');

    await user.click(trigger);
    let dialog = await screen.findByRole('dialog', { name: 'Delete Model B?' });
    // Cancel takes the focus once the dialog has opened, so Enter never deletes.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.some((call) => call.name === 'settings.models.delete')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete Model B' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete Model B?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveClass('bg-ink');
    await user.click(confirm);
    expect(calls.find((call) => call.name === 'settings.models.delete')?.input).toEqual({
      fileName: 'b.gguf',
    });
    expect(await screen.findByText('Model B deleted.')).toBeInTheDocument();
  });

  it('shows the recovered settings notice and dismisses it', async () => {
    const calls = install({
      'settings.getPage': () =>
        pageDto({
          notices: [
            {
              id: 'settings-recovered',
              kind: 'settings-recovered',
              keptAs: 'C:/x/settings.json.corrupt',
            },
          ],
        }),
      'settings.dismissNotice': () => ({ dismissed: true }),
    });
    mount();
    const notice = await screen.findByText(/settings\.json\.corrupt/);
    expect(notice).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'settings.dismissNotice')).toBe(true);
    });
  });

  it('closes the saved bar after 4 seconds, and a newer message restarts the clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      install({
        'settings.getPage': () => pageDto({ provider: 'ClaudeCode', cliStatus: 'detected' }),
        'settings.setCliOption': () => {
          n += 1;
          return {
            status: 'saved',
            settings: {},
            feedback: { key: 'Xai_FeedbackModel', args: [`message ${n.toString()}`] },
          };
        },
      });
      mount();
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      await screen.findByText('Detected on PATH.');
      await user.click(screen.getByRole('combobox', { name: 'Model' }));
      await user.click(await screen.findByRole('option', { name: 'opus' }));
      expect(await screen.findByText('Saved. Using message 1.')).toBeInTheDocument();

      // Three seconds in, a second message arrives and takes over the single timer.
      await act(() => vi.advanceTimersByTimeAsync(3000));
      await user.click(screen.getByRole('combobox', { name: 'Effort' }));
      await user.click(await screen.findByRole('option', { name: 'high' }));
      expect(await screen.findByText('Saved. Using message 2.')).toBeInTheDocument();

      // Past the first message's 4 seconds the newer one is still there.
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByText('Saved. Using message 2.')).toBeInTheDocument();
      // Four seconds after the second message it closes.
      await act(() => vi.advanceTimersByTimeAsync(1100));
      expect(screen.queryByText(/Saved\. Using message/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves the app language, opens the restart prompt, and Later closes it without restarting', async () => {
    const calls = install({
      'settings.getPage': () => pageDto(),
      'settings.setUiLanguage': () => ({ status: 'saved', settings: {}, feedback: null }),
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'App language' }));
    await user.click(await screen.findByRole('option', { name: 'Español' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restart required' });
    await user.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.some((call) => call.name === 'app.restart')).toBe(false);
    expect(calls.find((call) => call.name === 'settings.setUiLanguage')?.input).toEqual({
      tag: 'es',
    });
  });

  it('shows a refused restart as nothing and a failed one in words', async () => {
    install({
      'settings.getPage': () => pageDto(),
      'settings.setUiLanguage': () => ({ status: 'saved', settings: {}, feedback: null }),
      'app.restart': () => ({ status: 'failed', message: 'blocked' }),
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'App language' }));
    await user.click(await screen.findByRole('option', { name: 'Español' }));
    await user.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(await screen.findByText('Vozella could not restart. blocked')).toBeInTheDocument();
  });

  it('shows the skeleton and no control while the first answer is pending (8.3)', async () => {
    let answer: (value: unknown) => void = () => undefined;
    install({
      'settings.getPage': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    mount();
    expect(screen.getByLabelText('Loading settings')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Local (on this device)' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'App language' })).toBeNull();
    await act(async () => {
      answer(pageDto());
      await Promise.resolve();
    });
    expect(await screen.findByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
    expect(screen.queryByLabelText('Loading settings')).toBeNull();
  });

  it('draws the blocks in meeting lifecycle order under the page title (8.1, 8.2)', async () => {
    install({ 'settings.getPage': () => pageDto() });
    mount();
    await screen.findByRole('radio', { name: 'Local (on this device)' });
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const wanted = [
      'Microphone',
      'Meeting language',
      'Transcription',
      'Summary provider',
      'Appearance',
      'Language',
      'Data',
      'About',
    ];
    const seen = screen
      .getAllByRole('heading')
      .map((heading) => heading.textContent)
      .filter((text) => wanted.includes(text));
    expect(seen).toEqual(wanted);
  });

  it('leaving before the first answer applies nothing and starts nothing (8.7)', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const calls = install({
      'settings.getPage': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const view = mount();
    view.unmount();
    await act(async () => {
      answer(pageDto());
      await Promise.resolve();
    });
    const names = calls
      .map((call) => call.name)
      .filter((name) => name !== 'library.getLocation' && name !== 'app.setThemePreference');
    expect(names).toEqual(['settings.getPage']);
  });

  it('opening the page never writes (8.8, 8.11)', async () => {
    const calls = install({ 'settings.getPage': () => pageDto() });
    mount();
    await screen.findByRole('radio', { name: 'Local (on this device)' });
    const writes = calls.filter((call) =>
      /^settings\.(set|models\.(select|delete))/.test(call.name),
    );
    expect(writes).toEqual([]);
  });

  it('a revisit paints the last answer at once and refreshes without the skeleton (8.4)', async () => {
    let second: (value: unknown) => void = () => undefined;
    let n = 0;
    install({
      'settings.getPage': () => {
        n += 1;
        if (n === 1) return pageDto();
        return new Promise((resolve) => {
          second = resolve;
        });
      },
    });
    const first = mount();
    await screen.findByRole('radio', { name: 'Local (on this device)' });
    first.unmount();
    mount();
    expect(screen.getByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
    expect(screen.queryByLabelText('Loading settings')).toBeNull();
    await act(async () => {
      second(pageDto({ provider: 'Codex' }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    });
  });

  it('overlapping loads: the newest answer wins even when the older one lands last (7.17)', async () => {
    const pending: ((value: unknown) => void)[] = [];
    install({
      'settings.getPage': () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
      'settings.setSummaryProvider': () => ({ status: 'saved', settings: {}, feedback: null }),
    });
    mount();
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await act(async () => {
      pending[0]?.(pageDto());
      await Promise.resolve();
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /Codex/ }));
    await user.click(screen.getByRole('radio', { name: /Claude Code/ }));
    await waitFor(() => {
      expect(pending.length).toBeGreaterThanOrEqual(3);
    });
    // The newest request answers first with the final value, the older one lands last.
    await act(async () => {
      pending.at(-1)?.(pageDto({ provider: 'ClaudeCode' }));
      await Promise.resolve();
    });
    await act(async () => {
      pending[1]?.(pageDto({ provider: 'Codex' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeChecked();
  });

  it('keeps a download in progress when the page is opened again (58)', async () => {
    install({
      'settings.getPage': () =>
        pageDto({
          models: {
            rows: [model('a.gguf', 'Model A', { downloading: true, percent: 37 })],
            missingActiveId: null,
          },
        }),
    });
    mount();
    const group = await screen.findByRole('radiogroup', { name: 'Summary models' });
    expect(within(group).getByRole('button', { name: 'Cancel download' })).toBeInTheDocument();
    expect(within(group).getByRole('progressbar', { name: 'Downloading' })).toHaveAttribute(
      'aria-valuenow',
      '37',
    );
  });

  it('gives the Claude Code and Codex option blocks their brand mark', async () => {
    install({ 'settings.getPage': () => pageDto({ provider: 'Codex' }) });
    mount();
    const heading = await screen.findByRole('heading', { level: 3, name: /Codex/ });
    expect(heading.querySelector('svg')).not.toBeNull();
  });

  it('keeps the reveal at 150 ms and turns motion off for reduced motion (8.5)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles/index.css'), 'utf8');
    expect(css).toMatch(/--animate-fade-in:\s*fade-in 150ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/);
  });

  it('says so when the restart is refused', async () => {
    install({
      'settings.getPage': () => pageDto(),
      'settings.setUiLanguage': () => ({ status: 'saved', settings: {}, feedback: null }),
      'app.restart': () => ({ status: 'refused' }),
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'App language' }));
    await user.click(await screen.findByRole('option', { name: 'Español' }));
    await user.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(
      await screen.findByText(
        'Vozella cannot restart while a recording is in progress. Finish it, then try again.',
      ),
    ).toBeInTheDocument();
  });

  it('says so when the restart call throws', async () => {
    install({
      'settings.getPage': () => pageDto(),
      'settings.setUiLanguage': () => ({ status: 'saved', settings: {}, feedback: null }),
      'app.restart': () => {
        throw new Error('ipc down');
      },
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'App language' }));
    await user.click(await screen.findByRole('option', { name: 'Español' }));
    await user.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(await screen.findByText('Vozella could not restart. ipc down')).toBeInTheDocument();
  });

  it('stops watching the engine when the page is left (8.12)', async () => {
    install({ 'settings.getPage': () => pageDto() });
    const view = mount();
    await screen.findByRole('radio', { name: 'Local (on this device)' });
    expect(listeners.has('transcription.statusChanged')).toBe(true);
    view.unmount();
    expect(listeners.has('transcription.statusChanged')).toBe(false);
  });

  it('keeps the kept snapshot and says so when a revisit refresh fails (8.10)', async () => {
    let n = 0;
    install({
      'settings.getPage': () => {
        n += 1;
        if (n === 1) return pageDto();
        throw new Error('disk unreadable');
      },
    });
    const first = mount();
    await screen.findByRole('radio', { name: 'Local (on this device)' });
    first.unmount();
    mount();
    expect(
      await screen.findByText('The settings could not be loaded. disk unreadable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so when the read after a command fails, instead of leaving a stale control (8.10)', async () => {
    let n = 0;
    install({
      'settings.getPage': () => {
        n += 1;
        if (n >= 2) throw new Error('disk unreadable');
        return pageDto({ provider: 'ClaudeCode', cliStatus: 'detected' });
      },
      'settings.setCliOption': () => ({ status: 'saved', settings: {}, feedback: null }),
    });
    mount();
    const user = userEvent.setup();
    await screen.findByText('Detected on PATH.');
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(await screen.findByRole('option', { name: 'opus' }));
    expect(
      await screen.findByText('The settings could not be loaded. disk unreadable'),
    ).toBeInTheDocument();
  });

  it('drops the kept snapshot when the data folder changes, and reads the new one (8.4)', async () => {
    let n = 0;
    install({
      'settings.getPage': () => {
        n += 1;
        return n === 1 ? pageDto({ provider: 'Codex' }) : pageDto({ provider: 'ClaudeCode' });
      },
    });
    mount();
    expect(await screen.findByRole('radio', { name: /Codex/ })).toBeChecked();
    act(() => {
      emit('library.changed', { reason: 'location' });
    });
    expect(screen.queryByRole('radio', { name: /Codex/ })).toBeNull();
    expect(await screen.findByRole('radio', { name: /Claude Code CLI/ })).toBeChecked();
  });

  it('fades only on the first reveal, never on a revisit (8.5)', async () => {
    install({ 'settings.getPage': () => pageDto() });
    const first = mount();
    expect(await screen.findByTestId('settings-content')).toHaveClass('animate-fade-in');
    first.unmount();
    mount();
    expect(screen.getByTestId('settings-content')).not.toHaveClass('animate-fade-in');
  });

  it('lists Local, Claude Code and Codex in that order, each with its mark (28)', async () => {
    install({ 'settings.getPage': () => pageDto({ capabilities: allOn }) });
    mount();
    const group = await screen.findByRole('radiogroup', {
      name: 'Choose where summaries are generated',
    });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => labelOf(r).textContent.trim())).toEqual([
      'Local (on this device)',
      'Claude Code CLI',
      'Codex CLI',
    ]);
    for (const radio of radios) expect(labelOf(radio).querySelector('svg')).not.toBeNull();
  });

  it('labels the three providers in Spanish (28)', async () => {
    install({ 'settings.getPage': () => pageDto({ capabilities: allOn }) });
    mount('es');
    const radio = await screen.findByRole('radio', { name: 'Local (en este dispositivo)' });
    const group = groupOf(radio);
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => labelOf(r).textContent.trim()),
    ).toEqual(['Local (en este dispositivo)', 'CLI de Claude Code', 'CLI de Codex']);
  });

  it('shows the detection text in Spanish, and a new answer after Check again (35)', async () => {
    let detected: 'missing' | 'detected' = 'missing';
    install({
      'settings.getPage': () => pageDto({ provider: 'ClaudeCode', cliStatus: 'missing' }),
      'settings.detectCli': () => ({ status: detected }),
    });
    mount('es');
    expect(
      await screen.findByText('No se encontró en el PATH: instálalo antes de grabar.'),
    ).toBeInTheDocument();
    detected = 'detected';
    await userEvent.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }));
    expect(await screen.findByText('Detectado en el PATH.')).toBeInTheDocument();
    expect(screen.queryByText(/No se encontró/)).toBeNull();
  });

  it('moves the radio before the save and reload answer (31)', async () => {
    let releaseSave: (value: unknown) => void = () => undefined;
    install({
      'settings.getPage': () => pageDto({ provider: 'Local' }),
      'settings.setSummaryProvider': () =>
        new Promise((resolve) => {
          releaseSave = resolve;
        }),
    });
    mount();
    expect(await screen.findByRole('radio', { name: /Local/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Codex/ }));
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    await act(async () => {
      releaseSave({ status: 'saved', settings: {}, feedback: null });
      await Promise.resolve();
    });
  });

  it('shows the card description (33, 38)', async () => {
    install({ 'settings.getPage': () => pageDto({ capabilities: allOn }) });
    mount();
    expect(
      await screen.findByText(
        'Local runs entirely on this PC for free. Claude Code and Codex use an already-installed CLI.',
      ),
    ).toBeInTheDocument();
  });

  it('draws only the block of the chosen provider (38)', async () => {
    for (const [provider, expected] of [
      ['Local', { claude: false, codex: false, local: true, status: false }],
      ['ClaudeCode', { claude: true, codex: false, local: false, status: true }],
      ['Codex', { claude: false, codex: true, local: false, status: true }],
      ['Xai', { claude: false, codex: false, local: false, status: false }],
    ] as const) {
      resetSettingsPageCache();
      install({
        'settings.getPage': () =>
          pageDto({
            provider,
            capabilities: allOn,
            cliStatus: provider === 'ClaudeCode' || provider === 'Codex' ? 'detected' : null,
          }),
      });
      const view = mount();
      await screen.findByRole('radio', { name: 'Local (on this device)' });
      const shown = (query: HTMLElement | null) => query !== null;
      expect(shown(screen.queryByRole('heading', { level: 3, name: 'Claude Code' }))).toBe(
        expected.claude,
      );
      expect(shown(screen.queryByRole('heading', { level: 3, name: 'Codex' }))).toBe(
        expected.codex,
      );
      expect(shown(screen.queryByRole('heading', { level: 3, name: 'Summary models' }))).toBe(
        expected.local,
      );
      expect(shown(screen.queryByText('Detected on PATH.'))).toBe(expected.status);
      view.unmount();
    }
  });

  it('opens the Claude Code and Codex blocks with mark and description (45)', async () => {
    for (const [provider, name, description] of [
      ['ClaudeCode', 'Claude Code', 'Model alias and effort passed to the Claude CLI.'],
      ['Codex', 'Codex', 'Model and reasoning effort passed to the Codex CLI.'],
    ] as const) {
      resetSettingsPageCache();
      install({ 'settings.getPage': () => pageDto({ provider, cliStatus: 'detected' }) });
      const view = mount();
      const heading = await screen.findByRole('heading', { level: 3, name });
      expect(heading.querySelector('svg')).not.toBeNull();
      expect(screen.getByText(description)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('closes the saved bar when the user presses Close (76)', async () => {
    install({
      'settings.getPage': () => pageDto({ provider: 'ClaudeCode', cliStatus: 'detected' }),
      'settings.setCliOption': () => ({
        status: 'saved',
        settings: {},
        feedback: { key: 'Xai_FeedbackModel', args: ['opus'] },
      }),
    });
    mount();
    const user = userEvent.setup();
    await screen.findByText('Detected on PATH.');
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(await screen.findByRole('option', { name: 'opus' }));
    expect(await screen.findByText('Saved. Using opus.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Saved. Using opus.')).toBeNull();
  });
});
