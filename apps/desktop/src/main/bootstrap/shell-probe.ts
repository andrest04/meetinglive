import type { HandoffEvent } from '../recording/recording-handoff';

/**
 * What the shell e2e reads through `app.evaluate`: the tray menu model, the action runner behind
 * its items and every recording handoff event. Installed only in test mode, so a production
 * build exposes nothing.
 */
export interface ShellProbe {
  trayItems: { id: string; label: string }[];
  trayTooltip: string;
  trayRun: ((id: string) => void) | undefined;
  handoffEvents: HandoffEvent[];
}

export const SHELL_PROBE_KEY = '__vozellaShellProbe';

export function installShellProbe(target: Record<string, unknown> = globalThis): ShellProbe {
  const probe: ShellProbe = {
    trayItems: [],
    trayTooltip: '',
    trayRun: undefined,
    handoffEvents: [],
  };
  target[SHELL_PROBE_KEY] = probe;
  return probe;
}
