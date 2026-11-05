import type { ThemePreference } from '@vozella/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from 'react';
import { readStored, writeStored } from './preference-storage';

export type { ThemePreference } from '@vozella/contracts';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'vozella.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

/** "system" removes the attribute so prefers-color-scheme decides; the others force a theme. */
export function applyThemeAttribute(root: HTMLElement, preference: ThemePreference): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light';
  return preference;
}

interface ThemeValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

// Hot reload re-runs this module; reuse the context so consumers stay bound to the Provider.
const ThemeContext: Context<ThemeValue | null> =
  (import.meta.hot?.data.themeContext as Context<ThemeValue | null> | undefined) ??
  createContext<ThemeValue | null>(null);
if (import.meta.hot) import.meta.hot.data.themeContext = ThemeContext;

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: ReactNode;
  initialPreference?: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (initialPreference) return initialPreference;
    const stored = readStored(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  });
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemIsDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    applyThemeAttribute(document.documentElement, preference);
    // The main process mirrors the choice into nativeTheme and the title bar overlay.
    // Outside Electron (unit tests, a plain browser) there is no bridge, and that is fine.
    (window as { vozella?: Window['vozella'] }).vozella
      ?.invoke('app.setThemePreference', { preference })
      .catch(() => undefined);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeStored(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved: resolveTheme(preference, systemIsDark), setPreference }),
    [preference, systemIsDark, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
