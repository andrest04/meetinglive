import type { CancelSignal } from '../cancel';
import type { CliProcessRunner, CliRunResult } from './cli-failure';
import type { CliRunOptions } from './cli-provider';

export interface FakeRunCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string | null;
  readonly timeoutMs: number;
  /** Set only when the run asked for another working folder. */
  readonly cwd?: string;
}

/**
 * A scripted `CliProcessRunner`. It records every spawn and answers with a fixed result, or
 * rejects with what `fail` holds. `onPath` false makes `isOnPath` answer no, so no spawn happens.
 */
export class FakeCliProcessRunner implements CliProcessRunner {
  readonly calls: FakeRunCall[] = [];
  readonly pathChecks: string[] = [];
  onPath = true;
  result: CliRunResult;
  fail: unknown = null;

  constructor(stdout = '') {
    this.result = { exitCode: 0, stdout, stderr: '' };
  }

  isOnPath(executable: string): boolean {
    this.pathChecks.push(executable);
    return this.onPath;
  }

  run(
    executable: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    _cancel: CancelSignal,
    options?: CliRunOptions,
  ): Promise<CliRunResult> {
    this.calls.push({
      executable,
      args: [...args],
      stdin,
      timeoutMs,
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the double rejects with any scripted value
    if (this.fail !== null) return Promise.reject(this.fail);
    return Promise.resolve(this.result);
  }

  /** Every prompt that reached stdin, in order. */
  sentPrompts(): string[] {
    return this.calls.map((c) => c.stdin ?? '');
  }
}
