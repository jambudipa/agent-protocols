# presentation tests

These tests cover each public module of the presentation package: one test file
for each source module, plus `index.test.ts` for the public export surface.
They check the accepted shapes, the limits at and past their bounds, and the
exact rejection reason of each refused value.

## Harness

The tests are pure: no server and no I/O. They run under `it.effect` from
`@effect/vitest`. `effect.ts` holds the shared helpers: `expectSuccess` and
`expectFailure` yield the value or the typed error for `yield*`, and
`outOfBand` makes a value the compiler types as `T` but that arrives as
`undefined`, to test the guards against malformed input.
