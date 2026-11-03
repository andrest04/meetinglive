/**
 * Runs async tasks one at a time per key, in the order they were queued (B5). A failing task
 * rejects only its own promise; the next one still runs.
 */
export class PatchQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  get pendingKeys(): number {
    return this.tails.size;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
