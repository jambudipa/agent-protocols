/**
 * Assertion helpers for the presentation tests, ported from jam-flow's
 * `packages/flow/src/test/effect.ts`. Only the three helpers these tests use
 * came across: `expectSuccess`, `expectFailure` and `outOfBand`.
 *
 * jam-flow's helpers ran the Effect into a `Promise`. Here the tests run under
 * `it.effect`, so the two Effect helpers return Effects for `yield*` instead,
 * and the test fails on the same outcomes as before.
 */
import { Effect } from 'effect';

/**
 * Expects `effect` to fail and yields its typed error. When the Effect
 * succeeds, the success value becomes the failure, so the test fails instead
 * of reading a success as an error.
 */
export const expectFailure = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<E, A> => Effect.flip(effect);

/**
 * Expects `effect` to succeed and yields its value. When the Effect fails, the
 * test fails with the typed error.
 */
export const expectSuccess = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E> => effect;

/**
 * A value the compiler types as `T` but that is `undefined` when it arrives.
 *
 * Reading past the end of an empty array is exactly that: under
 * `noUncheckedIndexedAccess` the lookup is `T | undefined`, the non-null
 * assertion makes it `T`, and nothing is asserted about a *type* — which is why
 * this exists rather than an `as unknown as T` cast.
 */
export const outOfBand = <T>(): T => {
  const empty: readonly T[] = [];
  return empty[0]!;
};
