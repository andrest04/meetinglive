import { messageOf } from './commands';

/**
 * Asks whether the app may close now. The recording module registers one that protects an active
 * recording (asks to save or discard). Returning false keeps the app open.
 */
export type ExitGate = () => boolean | Promise<boolean>;

export class ExitGateRegistry {
  private readonly gates = new Set<ExitGate>();

  register(gate: ExitGate): () => void {
    this.gates.add(gate);
    return () => {
      this.gates.delete(gate);
    };
  }

  /** True when no gate objects. A gate that throws counts as a refusal. */
  async mayExit(): Promise<boolean> {
    for (const gate of this.gates) {
      try {
        if (!(await gate())) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}

export type RestartOutcome =
  | { readonly status: 'restarting' }
  | { readonly status: 'refused' }
  | { readonly status: 'failed'; readonly message: string };

export interface RestartDeps {
  readonly gates: ExitGateRegistry;
  /** Electron: `app.relaunch()` then `app.exit(0)`. */
  readonly relaunch: () => void | Promise<void>;
}

/** Restart for the language change: the exit gate first, then the platform relaunch. */
export class RestartService {
  constructor(private readonly deps: RestartDeps) {}

  async restart(): Promise<RestartOutcome> {
    if (!(await this.deps.gates.mayExit())) return { status: 'refused' };
    try {
      await this.deps.relaunch();
      return { status: 'restarting' };
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
  }
}
