/**
 * The shared AG-UI conformance corpus through `expandChunks` and `verify`:
 * every fixture that the specification expects a client to accept
 * completes, and every one it expects a client to reject fails with the
 * error text that the fixture names.
 */
import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Cause, Effect, Exit, Filter, Option, Stream } from 'effect';
import { decodeEvent, expandChunks, verify } from '../src/index.js';
import { type Fixture, loadFixtures } from './fixtures.js';

/** Replays a fixture's stream the way `AgUiClient` reads a response. */
const replay = (fixture: Fixture) =>
  Stream.fromIterable(fixture.stream).pipe(
    Stream.mapEffect(decodeEvent),
    Stream.filterMap(Filter.fromPredicateOption((event) => event)),
    expandChunks,
    verify,
    Stream.runDrain,
    Effect.exit
  );

/** What went wrong with one fixture, or none when it held. */
const check = (fixture: Fixture) =>
  Effect.map(replay(fixture), (exit): Option.Option<string> => {
    const failed = fixture.expect.outcome === 'failed';
    if (Exit.isSuccess(exit)) {
      return failed
        ? Option.some(`${fixture.name}: completed, expected a failure`)
        : Option.none();
    }
    const message = Cause.pretty(exit.cause);
    if (!failed) {
      return Option.some(`${fixture.name}: failed with ${message}`);
    }
    const expected = fixture.expect.errorContains ?? '';
    return message.includes(expected)
      ? Option.none()
      : Option.some(
          `${fixture.name}: failed with ${message}, expected "${expected}"`
        );
  });

it.effect('replays every conformance fixture with the expected outcome', () =>
  Effect.gen(function* () {
    const fixtures = yield* loadFixtures;
    assert.isAbove(fixtures.length, 60);
    const problems = (yield* Effect.forEach(fixtures, check)).flatMap((p) =>
      Option.toArray(p)
    );
    assert.deepStrictEqual(problems, []);
  }).pipe(Effect.provide(NodeServices.layer))
);

it.effect('names the fatal fixtures and the rule each one breaks', () =>
  Effect.gen(function* () {
    const fatal = (yield* loadFixtures).filter((fixture) =>
      fixture.name.endsWith('-fatal')
    );
    assert.isAbove(fatal.length, 15);
    for (const fixture of fatal) {
      assert.strictEqual(fixture.expect.outcome, 'failed', fixture.name);
      assert.isString(fixture.expect.errorContains, fixture.name);
    }
  }).pipe(Effect.provide(NodeServices.layer))
);
