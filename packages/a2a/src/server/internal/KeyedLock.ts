/**
 * A lock for each key, removed once no fiber holds or waits for it.
 *
 * @internal
 */
import { Effect, MutableHashMap, Option, Semaphore } from 'effect';

interface Entry {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

/**
 * Runs effects with the same key one at a time.
 *
 * @internal
 */
export interface KeyedLock {
  readonly withLock: (
    key: string
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

/** @internal */
export const makeKeyedLock = (): KeyedLock => {
  const entries = MutableHashMap.empty<string, Entry>();
  const acquire = (key: string) =>
    Effect.sync(() => {
      const existing = MutableHashMap.get(entries, key);
      const entry: Entry = Option.isSome(existing)
        ? existing.value
        : { semaphore: Semaphore.makeUnsafe(1), users: 0 };
      entry.users += 1;
      MutableHashMap.set(entries, key, entry);
      return entry;
    });
  const release = (key: string, entry: Entry) =>
    Effect.sync(() => {
      entry.users -= 1;
      if (entry.users === 0) MutableHashMap.remove(entries, key);
    });
  return {
    withLock: (key) => (effect) =>
      Effect.acquireUseRelease(
        acquire(key),
        (entry) => Semaphore.withPermit(entry.semaphore, effect),
        (entry) => release(key, entry)
      ),
  };
};
