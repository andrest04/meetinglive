/** The one gate that decides what a take may do next (spec 3.1). UI thread only, no I/O. */

export type RecordingPhase = 'Idle' | 'Preparing' | 'Recording' | 'Stopping' | 'Processing';

export type PhaseListener = (phase: RecordingPhase, previous: RecordingPhase) => void;

export class RecordingSessionGate {
  private current: RecordingPhase = 'Idle';
  private readonly listeners = new Set<PhaseListener>();

  get phase(): RecordingPhase {
    return this.current;
  }

  /** Record or Stop may be pressed. */
  get canToggle(): boolean {
    return this.current === 'Idle' || this.current === 'Recording';
  }

  get canImport(): boolean {
    return this.current === 'Idle';
  }

  /** Pause, discard and highlight. */
  get canControlCapture(): boolean {
    return this.current === 'Recording';
  }

  get requiresCloseConfirmation(): boolean {
    return this.current === 'Recording';
  }

  /** Called after every real transition, never after a refused one. Returns an unsubscribe. */
  onChange(listener: PhaseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  tryBeginPreparing(): boolean {
    return this.move(['Idle'], 'Preparing');
  }

  cancelPreparing(): boolean {
    return this.move(['Preparing'], 'Idle');
  }

  markRecording(): boolean {
    return this.move(['Preparing'], 'Recording');
  }

  tryBeginStopping(): boolean {
    return this.move(['Recording'], 'Stopping');
  }

  markProcessing(): boolean {
    return this.move(['Stopping', 'Preparing'], 'Processing');
  }

  /** Refused while Recording, so a late callback cannot end the next take. */
  markIdle(): boolean {
    return this.move(['Processing', 'Stopping'], 'Idle');
  }

  private move(from: readonly RecordingPhase[], to: RecordingPhase): boolean {
    if (!from.includes(this.current)) return false;
    const previous = this.current;
    this.current = to;
    for (const listener of [...this.listeners]) listener(to, previous);
    return true;
  }
}
