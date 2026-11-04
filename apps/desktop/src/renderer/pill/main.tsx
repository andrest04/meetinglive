import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/index.css';
import './pill.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PillContainer } from '../features/live-copilot/PillContainer';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/translate';

// Always dark, whatever the app theme says (the Light dictionary of the WinUI window is dropped,
// bug 7). High contrast follows the system colors through forced-colors.
document.documentElement.setAttribute('data-theme', 'dark');

async function startupLocale(): Promise<Locale | undefined> {
  try {
    return (await window.vozella.invoke('i18n.getLocale', {})).locale;
  } catch {
    return undefined;
  }
}

const container = document.getElementById('pill-root');
if (!container) throw new Error('missing #pill-root');
const root = createRoot(container);
void startupLocale().then((locale) => {
  root.render(
    <StrictMode>
      <I18nProvider {...(locale ? { initialLocale: locale } : {})}>
        <PillContainer />
      </I18nProvider>
    </StrictMode>,
  );
});
