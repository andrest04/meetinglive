import type { Clock } from '../clock';

/** Spec 3.5: the most often a streamed answer reaches the screen. */
export const STREAM_FLUSH_INTERVAL_MS = 80;

/**
 * Turns a fast chunk stream into a slow stream of pushes (spec 3.5). Nothing is pushed until a
 * chunk with visible text has arrived. The first visible chunk is pushed at once, later chunks at
 * most once per interval, and `flush` pushes what the last push left out. Pushed text never has
 * leading whitespace. Time comes from the injected clock, so tests move it by hand.
 */
export class StreamCoalescer {
  private buffer = '';
  private lastPushAt: number | null = null;
  private pushedLength = 0;

  constructor(
    private readonly clock: Clock,
    private readonly push: (text: string) => void,
    private readonly intervalMs: number = STREAM_FLUSH_INTERVAL_MS,
  ) {}

  /** Everything received so far, untrimmed. */
  get text(): string {
    return this.buffer;
  }

  append(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.trim() === '') return;
    const now = this.clock.now().getTime();
    if (this.lastPushAt === null || now - this.lastPushAt >= this.intervalMs) {
      this.pushNow(now);
    }
  }

  /** The final push, only when the last one did not include everything. */
  flush(): void {
    if (this.buffer.trim() === '' || this.pushedLength === this.buffer.length) return;
    this.pushNow(this.clock.now().getTime());
  }

  private pushNow(now: number): void {
    this.lastPushAt = now;
    this.pushedLength = this.buffer.length;
    this.push(this.buffer.trimStart());
  }
}
