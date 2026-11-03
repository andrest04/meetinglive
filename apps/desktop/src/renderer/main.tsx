import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installRendererErrorReporting } from './app/error-reporting';
import type { Locale } from './i18n/translate';

installRendererErrorReporting(window);

/** The saved or OS language chosen by the main process, so the first paint is already right. */
async function startupLocale(): Promise<Locale | undefined> {
  try {
    return (await window.vozella.invoke('i18n.getLocale', {})).locale;
  } catch {
    return undefined;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
const root = createRoot(container);
void startupLocale().then((locale) => {
  root.render(
    <StrictMode>
      <App {...(locale ? { initialLocale: locale } : {})} />
    </StrictMode>,
  );
});
