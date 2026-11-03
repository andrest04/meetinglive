import type { AppInfo } from '@vozella/contracts';
import { useEffect, useState } from 'react';

type State =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'failed'; message: string };

/** Foundation shell: proves the page reaches the main process through the typed contract. */
export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    window.vozella
      .invoke('app.getInfo', {})
      .then((info) => {
        setState({ status: 'ready', info });
      })
      .catch((error: unknown) => {
        setState({ status: 'failed', message: error instanceof Error ? error.message : 'Failed' });
      });
  }, []);

  return (
    <main data-testid="app-root">
      <h1>Vozella</h1>
      {state.status === 'loading' && <p>Loading</p>}
      {state.status === 'failed' && <p role="alert">Could not read app info: {state.message}</p>}
      {state.status === 'ready' && (
        <p data-testid="app-version">
          Version {state.info.version} on Electron {state.info.electron}
        </p>
      )}
    </main>
  );
}
