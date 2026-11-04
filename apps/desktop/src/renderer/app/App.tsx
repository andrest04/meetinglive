import { RouterProvider } from '@tanstack/react-router';
import { I18nProvider, useT } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/translate';
import { ToastProvider, TooltipProvider } from '../ui';
import { DialogHost } from '../features/shell/dialog-service';
import { router } from './router';
import { ThemeProvider } from './theme';

function Providers() {
  const t = useT();
  return (
    <TooltipProvider delay={400}>
      <ToastProvider dismissLabel={t('MeetingPrompt_Dismiss.Text')}>
        <DialogHost>
          <RouterProvider router={router} />
        </DialogHost>
      </ToastProvider>
    </TooltipProvider>
  );
}

export function App({ initialLocale }: { initialLocale?: Locale }) {
  return (
    <ThemeProvider>
      <I18nProvider {...(initialLocale ? { initialLocale } : {})}>
        <Providers />
      </I18nProvider>
    </ThemeProvider>
  );
}
