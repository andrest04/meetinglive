import fs from 'node:fs';
import path from 'node:path';
import type { Clock, LogContext, Logger, LogLevel } from '@vozella/core';
import { SystemClock } from '../clock/system-clock';

export interface RotatingFileLoggerOptions {
  readonly dir: string;
  readonly fileName?: string;
  /** Rotate when the active file would grow past this. Default 1 MiB. */
  readonly maxBytes?: number;
  /** Total files kept, the active one included. Default 5. */
  readonly maxFiles?: number;
  readonly clock?: Clock;
  readonly scope?: string;
  /** Called when the log cannot be written. The logger itself never throws. */
  readonly onWriteError?: (error: unknown) => void;
}

/** Adapter: synchronous, size-rotated log file. `vozella.log`, `vozella.log.1`, ... */
export class RotatingFileLogger implements Logger {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly clock: Clock;
  private readonly scope: string | undefined;
  private readonly onWriteError: (error: unknown) => void;
  private readonly state: { size: number };

  constructor(
    private readonly options: RotatingFileLoggerOptions,
    shared?: { size: number },
  ) {
    this.state = shared ?? { size: 0 };
    this.file = path.join(options.dir, options.fileName ?? 'vozella.log');
    this.maxBytes = options.maxBytes ?? 1_048_576;
    this.maxFiles = Math.max(1, options.maxFiles ?? 5);
    this.clock = options.clock ?? new SystemClock();
    this.scope = options.scope;
    this.onWriteError = options.onWriteError ?? (() => undefined);
    try {
      fs.mkdirSync(options.dir, { recursive: true });
      if (!shared) {
        this.state.size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      }
    } catch (error) {
      this.onWriteError(error);
    }
  }

  get filePath(): string {
    return this.file;
  }

  child(scope: string): RotatingFileLogger {
    return new RotatingFileLogger(
      { ...this.options, scope: this.scope ? `${this.scope}:${scope}` : scope },
      this.state,
    );
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const scope = this.scope ? ` [${this.scope}]` : '';
    const tail = context ? ` ${safeJson(context)}` : '';
    const line = `${this.clock.now().toISOString()} ${level.toUpperCase().padEnd(5)}${scope} ${oneLine(message)}${tail}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (this.state.size > 0 && this.state.size + bytes > this.maxBytes) {
        this.rotate();
      }
      fs.appendFileSync(this.file, line);
      this.state.size += bytes;
    } catch (error) {
      this.onWriteError(error);
    }
  }

  private rotate(): void {
    const oldest = `${this.file}.${this.maxFiles - 1}`;
    if (this.maxFiles > 1) {
      fs.rmSync(oldest, { force: true });
      for (let i = this.maxFiles - 2; i >= 1; i -= 1) {
        const from = `${this.file}.${i}`;
        if (fs.existsSync(from)) {
          fs.renameSync(from, `${this.file}.${i + 1}`);
        }
      }
      fs.renameSync(this.file, `${this.file}.1`);
    } else {
      fs.rmSync(this.file, { force: true });
    }
    this.state.size = 0;
  }
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, '\\n');
}

function safeJson(context: LogContext): string {
  try {
    return oneLine(
      JSON.stringify(context, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      ),
    );
  } catch {
    return '{"unserializable":true}';
  }
}
