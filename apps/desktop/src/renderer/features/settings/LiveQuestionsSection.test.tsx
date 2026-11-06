// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { LiveQuestionsSection } from './LiveQuestionsSection';

function install(saved: { liveQuestions: string | null; selectedSummaryProvider: string | null }) {
  const invoke = vi.fn((name: string, input: { patch?: { liveQuestions: string } }) => {
    if (name === 'settings.get') return Promise.resolve(saved);
    if (name === 'settings.update') return Promise.resolve({ ...saved, ...input.patch });
    return Promise.reject(new Error(name));
  });
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on: () => () => undefined },
    configurable: true,
    writable: true,
  });
  return invoke;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (provider = 'Codex') =>
  render(
    <Providers>
      <LiveQuestionsSection selectedProvider={provider} />
    </Providers>,
  );

const trigger = () => screen.getByRole('combobox', { name: 'Question detection' });

describe('LiveQuestionsSection', () => {
  it('shows the engine default when nothing was chosen, without writing it', async () => {
    const invoke = install({ liveQuestions: null, selectedSummaryProvider: 'Codex' });
    mount();
    await waitFor(() => {
      expect(trigger().textContent).toContain('On, checked by the summary engine');
    });
    expect(screen.getByText('Detect questions while recording')).toBeTruthy();
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['settings.get']);
  });

  it('saves only this field when the user picks Off', async () => {
    const invoke = install({ liveQuestions: null, selectedSummaryProvider: 'Local' });
    mount('Local');
    await waitFor(() => {
      expect(trigger().textContent).toContain('On');
    });
    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', { patch: { liveQuestions: 'off' } });
    });
    await waitFor(() => {
      expect(trigger().textContent).toContain('Off');
    });
  });
});
