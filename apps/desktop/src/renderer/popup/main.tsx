import '@fontsource-variable/schibsted-grotesk';
import '../styles/index.css';
import './popup.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingPopupContainer } from '../features/meeting-popup/MeetingPopupContainer';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/translate';

// Always dark, whatever the app theme says.
document.documentElement.setAttribute('data-theme', 'dark');

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
      <I18nProvider {...(locale ? { initialLocale: locale } : {})}>
        <MeetingPopupContainer />
      </I18nProvider>
    </StrictMode>,
  );
});
