/**
 * Loads the vendored AG-UI conformance fixtures from
 * `spec/1.0/conformance/streams/`.
 */
import { Effect, FileSystem, Path, Schema } from 'effect';

/** The part of a fixture that these tests read. */
export const Fixture = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  stream: Schema.Array(Schema.Json),
  expect: Schema.Struct({
    outcome: Schema.optionalKey(Schema.Literals(['completed', 'failed'])),
    errorContains: Schema.optionalKey(Schema.String),
  }),
}).annotate({ identifier: 'Fixture' });

/** A conformance fixture. */
export type Fixture = typeof Fixture.Type;

/** The fixture directory, resolved from this file. */
const STREAMS = new URL('../spec/1.0/conformance/streams/', import.meta.url);

/** Every fixture, sorted by file name. */
export const loadFixtures = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* path.fromFileUrl(STREAMS);
  const names = (yield* fs.readDirectory(directory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return yield* Effect.forEach(names, (name) =>
    fs
      .readFileString(path.join(directory, name))
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(Fixture))
        )
      )
  );
});
