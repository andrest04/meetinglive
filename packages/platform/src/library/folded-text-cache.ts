import type { MeetingSearchText } from '@vozella/core';

interface Entry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly text: MeetingSearchText;
  readonly bytes: number;
  lastPass: number;
}

/** V8 keeps text that fits Latin-1 at one byte a character, and anything else at two. */
const WIDE = /[Ā-￿]/;

const stringBytes = (value: string): number => value.length * (WIDE.test(value) ? 2 : 1);

export const foldedTextBytes = (text: MeetingSearchText): number =>
  stringBytes(text.title) +
  stringBytes(text.summary) +
  stringBytes(text.notes) +
  stringBytes(text.transcript);

/**
 * Folded meeting text by file version, least recently used first, under a byte cap.
 *
 * A search reads every file in the same order, and that is the worst case for plain LRU: once the
 * library outgrows the cap, each search evicts what the next one needs and nothing ever hits. So
 * an entry used by this search or the one before stays, and a new one that does not fit is simply
 * not kept. A library over the cap then still gets hits for the part that fits.
 */
export class FoldedTextCache {
  private readonly entries = new Map<string, Entry>();
  private pass = 0;
  private held = 0;

  constructor(private readonly maxBytes: number) {}

  get bytes(): number {
    return this.held;
  }

  /** Call when a search starts. */
  beginPass(): void {
    this.pass += 1;
  }

  get(path: string, mtimeMs: number, size: number): MeetingSearchText | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.entries.delete(path);
    if (entry.mtimeMs !== mtimeMs || entry.size !== size) {
      this.held -= entry.bytes;
      return undefined;
    }
    entry.lastPass = this.pass;
    this.entries.set(path, entry);
    return entry.text;
  }

  set(path: string, mtimeMs: number, size: number, text: MeetingSearchText): void {
    const replaced = this.entries.get(path);
    if (replaced) {
      this.entries.delete(path);
      this.held -= replaced.bytes;
    }
    const bytes = foldedTextBytes(text);
    if (!this.makeRoom(bytes)) return;
    this.entries.set(path, { mtimeMs, size, text, bytes, lastPass: this.pass });
    this.held += bytes;
  }

  private makeRoom(bytes: number): boolean {
    if (bytes > this.maxBytes) return false;
    for (const [path, entry] of this.entries) {
      if (this.held + bytes <= this.maxBytes) return true;
      // Use order is pass order, so everything after this entry is recent too.
      if (entry.lastPass >= this.pass - 1) return false;
      this.entries.delete(path);
      this.held -= entry.bytes;
    }
    return this.held + bytes <= this.maxBytes;
  }
}
