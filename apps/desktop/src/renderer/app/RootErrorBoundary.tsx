import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createTranslator, detectLocale, isLocale, type Locale } from '../i18n/translate';
import { Button } from '../ui/Button';
import { reportRendererError } from './error-reporting';
import { recoverFromRenderCrash } from './hmr-recovery';

interface Props {
  readonly children: ReactNode;
  /** Used when the page has not set a language yet; the OS language otherwise. */
  readonly locale?: Locale;
  /** Shows the error message under the title (development builds). */
  readonly showDetails?: boolean;
  /** Called once per caught error (main log, hot-update recovery). */
  readonly onError?: (error: Error) => void;
  readonly onReload?: () => void;
}

interface State {
  readonly error: Error | undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

interface CrashFallbackProps {
  readonly error: Error;
  readonly locale?: Locale | undefined;
  readonly showDetails?: boolean | undefined;
  readonly onReload?: (() => void) | undefined;
}

/** Says something broke and offers a reload; never a blank window. Needs no provider. */
export function CrashFallback({ error, locale, showDetails, onReload }: CrashFallbackProps) {
  const pageLocale = document.documentElement.lang;
  const t = createTranslator(
    isLocale(pageLocale) ? pageLocale : (locale ?? detectLocale(navigator.languages)),
  );
  return (
    <main className="flex h-full min-h-screen w-full items-center justify-center bg-paper p-8 text-ink">
      <div role="alert" className="flex max-w-md flex-col items-start gap-3">
        <h1 className="text-heading font-semibold">{t('Ui_SomethingWentWrong')}</h1>
        {showDetails ? (
          <pre className="max-h-48 w-full overflow-auto rounded-control border border-hairline bg-paper-raised p-3 font-mono text-ui whitespace-pre-wrap text-ink-muted">
            {error.message}
          </pre>
        ) : null}
        <Button
          variant="primary"
          onClick={() => {
            if (onReload) onReload();
            else window.location.reload();
          }}
        >
          {t('Ui_Reload')}
        </Button>
      </div>
    </main>
  );
}

/**
 * The router's own error screen: a route that throws while rendering lands here. It logs the
 * error to the main process and, in development, reloads when a hot update caused it and
 * tries the route again after the next hot update (the fix).
 */
export function RouteCrash({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    if ('vozella' in window) reportRendererError(window.vozella, 'react', error);
    recoverFromRenderCrash();
  }, [error]);
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return undefined;
    const retry = () => {
      reset();
      void router.invalidate();
    };
    hot.on('vite:afterUpdate', retry);
    return () => {
      hot.off('vite:afterUpdate', retry);
    };
  }, [reset, router]);
  return <CrashFallback error={toError(error)} showDetails={import.meta.env.DEV} />;
}

/**
 * The last line of defence: a render error outside the router (providers, the shell) shows the
 * same notice instead of an empty window. It sits outside every provider, so it reads the
 * language from the page and translates on its own.
 */
export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error: toError(error) };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError?.(toError(error));
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <CrashFallback
        error={error}
        locale={this.props.locale}
        showDetails={this.props.showDetails}
        onReload={this.props.onReload}
      />
    );
  }
}
