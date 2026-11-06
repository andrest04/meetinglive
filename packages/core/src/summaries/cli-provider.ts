import type { CancelSignal } from '../cancel';
import {
  CliToolError,
  runRequiredStdout,
  wrapCliError,
  type CliProcessRunner,
} from './cli-failure';
import {
  CLAUDE_STREAM_FLAGS,
  CODEX_STREAM_FLAGS,
  claudeImageArgs,
  codexImageInvocation,
} from './cli-invocation';
import {
  createClaudeStreamParser,
  createCodexStreamParser,
  type CliStreamParser,
} from './cli-stream-parsers';
import { buildSummaryPrompt } from './prompt-builders';
import {
  CancelledError,
  summaryResultFromResponse,
  throwIfCancelled,
  withDefaultStream,
  type PromptCallOptions,
  type ProviderId,
  type SummarizeRequest,
  type SummaryProvider,
  type SummaryResult,
} from './provider';

/** Spec 3.7 and B31: five minutes, kept for parity. Callers may inject another value. */
export const CLI_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-run process options. `cwd` unset keeps the app's own working directory. */
export interface CliRunOptions {
  readonly cwd?: string;
}

/** Images copied for one chat send: a folder that holds only them, and their paths. */
export interface PromptImageFiles {
  readonly directory: string;
  readonly paths: readonly string[];
}

/** Chat's prompt options: the shared ones plus the images of the send. */
export interface CliPromptOptions extends PromptCallOptions {
  readonly images?: PromptImageFiles;
}

/**
 * Optional runner port for chat streaming: stdout as it arrives, one line at a time. The timeout
 * is an idle timeout (it restarts on every line); cancel and timeout kill the process tree, like
 * `run`. A non-zero exit ends the lines with a `CliExitError`.
 */
export interface CliLineRunner {
  runLines(
    executable: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    cancel: CancelSignal,
    options?: CliRunOptions,
  ): AsyncIterable<string>;
}

/** The process ended with a non-zero code. `stderr` is its tail, for classification. */
export class CliExitError extends Error {
  constructor(
    readonly executable: string,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`'${executable}' exited with code ${String(exitCode)}.`);
    this.name = 'CliExitError';
  }
}

export function canStreamLines<T extends object>(runner: T): runner is T & CliLineRunner {
  return typeof (runner as Partial<CliLineRunner>).runLines === 'function';
}

/** How one CLI streams: the flags added to its normal argv and the parser for its output. */
interface CliStreamFormat {
  readonly flags: readonly string[];
  readonly parser: () => CliStreamParser;
}

const STREAM_FORMATS: Partial<Record<ProviderId, CliStreamFormat>> = {
  'claude-code': { flags: CLAUDE_STREAM_FLAGS, parser: createClaudeStreamParser },
  codex: { flags: CODEX_STREAM_FLAGS, parser: createCodexStreamParser },
};

/** Extra argv for attached images, and the folder to run in, if any. */
interface ImageInvocation {
  readonly args: readonly string[];
  readonly cwd?: string;
}

/** How each CLI receives attached images, on the streaming and the one-chunk path alike. */
const IMAGE_FORMATS: Partial<Record<ProviderId, (files: PromptImageFiles) => ImageInvocation>> = {
  'claude-code': (files) => ({ args: claudeImageArgs(files.directory), cwd: files.directory }),
  codex: (files) => codexImageInvocation(files.directory, files.paths),
};

/** A stdout line that is not a JSON event: kept for the plain-text fallback and classification. */
const isPlainLine = (line: string): boolean => !line.trimStart().startsWith('{');

/**
 * The base of the CLI providers (`CliToolProviderBase`): four values (executable, timeout, argv,
 * display name) and one way to run. The prompt goes to stdin, the answer is the trimmed stdout.
 * Prompts are sent whole; there is no chunking for CLI providers (B31, recorded in the ledger).
 */
export abstract class CliToolProvider implements SummaryProvider {
  abstract readonly id: ProviderId;
  protected abstract readonly executable: string;
  protected abstract readonly displayName: string;

  protected constructor(
    private readonly runner: CliProcessRunner,
    private readonly timeoutMs: number = CLI_TIMEOUT_MS,
  ) {}

  /** Built per call so a bad stored model or effort fails before anything is started. */
  protected abstract buildArgs(): readonly string[];

  async summarize(request: SummarizeRequest, cancel: CancelSignal): Promise<SummaryResult> {
    const raw = await this.run(buildSummaryPrompt(request), cancel);
    return summaryResultFromResponse(this.id, raw);
  }

  completePrompt(prompt: string, cancel: CancelSignal): Promise<string> {
    return this.run(prompt, cancel);
  }

  /**
   * Real token streaming when the runner can stream lines and this CLI has a stream format: the
   * same argv plus the stream flags, parsed into text pieces. With no pieces, the CLI's final
   * answer is sent whole; with no JSON at all, the plain stdout is (the old one-chunk answer).
   * Other runners keep the one-chunk path. `completePrompt` (summaries) never streams.
   * Attached images (`options.images`) ride on both paths: Claude Code reads them from their
   * folder, Codex gets `-i` per image.
   */
  streamPrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: CliPromptOptions,
  ): AsyncIterable<string> {
    const format = STREAM_FORMATS[this.id];
    if (format === undefined || !canStreamLines(this.runner)) {
      return withDefaultStream((p, c) => this.run(p, c, options?.images))(prompt, cancel);
    }
    return this.streamLines(this.runner, format, prompt, cancel, options?.images);
  }

  /** The argv extras and folder for the images of a send; null without images. */
  private imageInvocation(images: PromptImageFiles | undefined): ImageInvocation | null {
    const format = IMAGE_FORMATS[this.id];
    if (format === undefined || images === undefined || images.paths.length === 0) return null;
    return format(images);
  }

  private async *streamLines(
    runner: CliProcessRunner & CliLineRunner,
    format: CliStreamFormat,
    prompt: string,
    cancel: CancelSignal,
    images: PromptImageFiles | undefined,
  ): AsyncGenerator<string> {
    throwIfCancelled(cancel);
    const withImages = this.imageInvocation(images);
    const args = [...this.buildArgs(), ...format.flags, ...(withImages?.args ?? [])];
    const runOptions = withImages?.cwd === undefined ? undefined : { cwd: withImages.cwd };
    if (!(await runner.isOnPath(this.executable))) {
      throw new CliToolError(this.displayName, 'NotInstalled');
    }
    const parser = format.parser();
    const plain: string[] = [];
    let streamed = false;
    let final: string | null = null;
    try {
      const lines = runner.runLines(
        this.executable,
        args,
        prompt,
        this.timeoutMs,
        cancel,
        runOptions,
      );
      for await (const line of lines) {
        if (isPlainLine(line)) plain.push(line);
        for (const event of parser.push(line)) {
          if (event.kind === 'error') {
            throw CliToolError.fromProcess(this.displayName, 1, '', event.message);
          }
          if (event.kind === 'final') {
            final = event.text;
          } else {
            streamed = true;
            yield event.text;
          }
        }
      }
    } catch (error) {
      if (error instanceof CliExitError) {
        throw CliToolError.fromProcess(
          this.displayName,
          error.exitCode,
          plain.join('\n'),
          error.stderr,
        );
      }
      throw wrapCliError(this.displayName, error);
    }
    if (cancel.cancelled) throw new CancelledError();
    if (streamed) return;
    const whole = (parser.parsedAny ? (final ?? '') : plain.join('\n')).trim();
    if (whole === '') throw new CliToolError(this.displayName, 'EmptyOutput');
    yield whole;
  }

  private async run(
    prompt: string,
    cancel: CancelSignal,
    images?: PromptImageFiles,
  ): Promise<string> {
    const withImages = this.imageInvocation(images);
    return await runRequiredStdout(
      this.runner,
      this.executable,
      [...this.buildArgs(), ...(withImages?.args ?? [])],
      prompt,
      this.timeoutMs,
      this.displayName,
      cancel,
      withImages?.cwd === undefined ? undefined : { cwd: withImages.cwd },
    );
  }
}
