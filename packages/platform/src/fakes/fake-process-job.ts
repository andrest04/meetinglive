import type { ProcessJobPort } from '../llama/process-guard';

/** Fake job: records the pids and kills nothing, so the watchdog fallback is the real guard. */
export class FakeProcessJob implements ProcessJobPort {
  readonly assigned: number[] = [];

  /** Set to make `assign` throw, as a real job does when nesting is refused. */
  failWith: Error | undefined;

  assign(pid: number): void {
    if (this.failWith) throw this.failWith;
    this.assigned.push(pid);
  }
}
