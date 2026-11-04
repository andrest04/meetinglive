import {
  pillOpenApp,
  pillReady,
  pillSetExpanded,
  pillStop,
  pillTogglePause,
  type PillStateDto,
} from '@vozella/contracts';
import { registerRequest, type IpcServerDeps } from './ipc-server';

/** What the pill buttons call. The recording service and the pill controller own the rules. */
export interface PillActions {
  /** Pause while recording, resume while paused. */
  togglePause(): Promise<void>;
  stop(): Promise<void>;
  /** Restore the main window when minimized and bring it forward. */
  openApp(): void;
  setExpanded(expanded: boolean): PillStateDto;
  state(): PillStateDto;
}

export function registerPillHandlers(server: IpcServerDeps, actions: PillActions): void {
  registerRequest(server, pillTogglePause, async () => {
    await actions.togglePause();
    return { done: true as const };
  });
  registerRequest(server, pillStop, async () => {
    await actions.stop();
    return { done: true as const };
  });
  registerRequest(server, pillOpenApp, () => {
    actions.openApp();
    return { done: true as const };
  });
  registerRequest(server, pillSetExpanded, ({ expanded }) => actions.setExpanded(expanded));
  registerRequest(server, pillReady, () => actions.state());
}
