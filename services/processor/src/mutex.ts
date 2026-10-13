/**
 * A mutex per key, in process. The pipeline runs PROCESSOR_CONCURRENCY
 * documents at once and the database has no unique key on a person (an
 * email, a phone number: a column that is often null), so two exports of
 * the same CV in one batch could both look the person up, both see
 * nothing and both insert. The section between the lookup and the write
 * is therefore run one organisation at a time: tasks of one key wait for
 * each other, tasks of different keys never do. The service is one
 * process on Railway, so this is enough; a second instance would need a
 * database-side key (a partial unique index) instead.
 *
 * A task that throws releases the lock like one that returns; the next
 * task of the key starts whatever happened to the previous one.
 */

export class KeyedMutex {
  /** The promise the next task of each key must wait for; dropped once the key is idle. */
  private readonly tails = new Map<string, Promise<void>>();

  /** Runs `task` once every task queued before it on `key` has finished. */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The chain never rejects: `current` is always released, in `finally`.
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Keys with a task running or waiting. */
  get size(): number {
    return this.tails.size;
  }
}
