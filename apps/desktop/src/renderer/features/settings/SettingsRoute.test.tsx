// @vitest-environment jsdom
import type { SettingsPageDto } from '@vozella/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../app/theme';
import { Providers } from '../library/library-test-kit';
import { SettingsRoute } from './SettingsRoute';

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

const xai = (extra: Record<string, unknown> = {}) => ({
  available: true,
  signedIn: false,
  credentialKind: null,
  title: 'signed-out',
  detail: { kind: 'signed-out' },
  models: [],
  modelsLoaded: false,
  selectedModelId: null,
  effort: 'low',
  canRetry: false,
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
    xaiEffort: 'low',
    xaiEffortOptions: ['low', 'high'],
    cliStatus: null,
    transcriptionLanguage: 'es',
    summaryLanguage: 'es',
    hardware: { totalRamGb: 16, gpuName: null, gpuVramGb: null },
    models: {
      rows: [model('a.gguf', 'Model A'), model('b.gguf', 'Model B', { downloaded: true })],
      missingActiveId: null,
    },
    xai: xai(),
    capabilities: { xaiAccount: true, xaiSignIn: false, localModels: true },
    notices: [],
    ...extra,
  } as unknown as SettingsPageDto;
}

type Handler = (input: unknown) => unknown;
const listeners = new Map<string, (payload: unknown) => void>();

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
      return () => {
        listeners.delete(name);
      };
    },
  };
  Object.defineProperty(window, 'vozella', { value: api, configurable: true, writable: true });
  return calls;
}

const mount = () =>
  render(
    <ThemeProvider>
      <Providers>
        <SettingsRoute />
      </Providers>
    </ThemeProvider>,
  );

beforeEach(() => {
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
      'settings.getPage': () =>
        pageDto({
          provider: 'Xai',
          capabilities: { xaiAccount: false, xaiSignIn: false, localModels: false },
        }),
    });
    mount();
    expect(await screen.findByRole('radio', { name: 'Grok (xAI)' })).toBeChecked();
    expect(screen.queryByText('Not signed in')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'API key' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Summary models' })).toBeNull();
  });

  it('offers the SuperGrok button only when the sign in exists', async () => {
    install({ 'settings.getPage': () => pageDto({ provider: 'Xai' }) });
    mount();
    await screen.findByText('Not signed in');
    expect(screen.queryByRole('button', { name: 'Sign in with SuperGrok' })).toBeNull();
  });

  it('asks Grok for its models when it opens already selected, and shows a failure in words', async () => {
    const calls = install({
      'settings.getPage': () =>
        pageDto({
          provider: 'Xai',
          xai: xai({
            signedIn: true,
            credentialKind: 'ApiKey',
            title: 'api-key',
            detail: { kind: 'loading-models' },
          }),
        }),
      'settings.xai.refresh': () =>
        xai({
          signedIn: true,
          credentialKind: 'ApiKey',
          title: 'error',
          detail: { kind: 'error', message: 'network down' },
          canRetry: true,
        }),
    });
    mount();
    expect(await screen.findByText('Could not reach Grok')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    expect(calls.filter((call) => call.name === 'settings.xai.refresh')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // Still signed in: the credentials are there, so sign out stays available.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('does not offer Grok when no account module exists, unless it is already chosen', async () => {
    install({
      'settings.getPage': () =>
        pageDto({
          capabilities: { xaiAccount: false, xaiSignIn: false, localModels: true },
        }),
    });
    mount();
    expect(await screen.findByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Grok (xAI)' })).toBeNull();
  });

  it('fades the content in, and shows a busy bar on the Grok card while it works', async () => {
    let finish: (value: unknown) => void = () => undefined;
    install({
      'settings.getPage': () =>
        pageDto({
          provider: 'Xai',
          xai: xai({ signedIn: true, credentialKind: 'ApiKey', title: 'api-key' }),
        }),
      'settings.xai.refresh': () =>
        xai({ signedIn: true, credentialKind: 'ApiKey', title: 'api-key' }),
      'settings.xai.signOut': () => new Promise((resolve) => (finish = resolve)),
    });
    mount();
    expect(await screen.findByTestId('settings-content')).toHaveClass('animate-fade-in');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    act(() => {
      finish({ status: 'ok', view: xai(), feedback: null });
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
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
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Model B is downloading. Cancel the download first.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.name === 'settings.models.delete')).toBe(true);
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
});
