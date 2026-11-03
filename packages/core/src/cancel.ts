/** What a long operation watches so its caller can stop it. Adapters bridge it to `AbortSignal`. */
export interface CancelSignal {
  readonly cancelled: boolean;
  /** Runs the listener at once if already cancelled. Returns a function that removes it. */
  onCancel(listener: () => void): () => void;
}

/** Owns a cancel signal. Hand `signal` to the operation and keep the source to cancel it. */
export class CancelSource implements CancelSignal {
  private isCancelled = false;
  private readonly listeners = new Set<() => void>();

  get signal(): CancelSignal {
    return this;
  }

  get cancelled(): boolean {
    return this.isCancelled;
  }

  onCancel(listener: () => void): () => void {
    if (this.isCancelled) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  cancel(): void {
    if (this.isCancelled) return;
    this.isCancelled = true;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
