// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemeAttribute, resolveTheme, ThemeProvider, useTheme } from './theme';

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${preference}/${resolved}`}</p>
      <button
        type="button"
        onClick={() => {
          setPreference('dark');
        }}
      >
        dark
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

describe('theme', () => {
  it('maps a preference to a resolved theme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('forces a theme with data-theme and leaves it off for system', () => {
    applyThemeAttribute(document.documentElement, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyThemeAttribute(document.documentElement, 'system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('starts from the system, applies the override and remembers it', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state')).toHaveTextContent('system/light');

    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(screen.getByTestId('state')).toHaveTextContent('dark/dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('vozella.theme')).toBe('dark');
  });

  it('restores a stored preference', () => {
    window.localStorage.setItem('vozella.theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state')).toHaveTextContent('light/light');
  });
});
