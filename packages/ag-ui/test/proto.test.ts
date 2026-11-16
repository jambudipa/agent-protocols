/**
 * The protobuf binding against `@ag-ui/proto` 1.0.4: every event of the
 * conformance corpus encodes with our converters and decodes with the
 * reference, and the reverse; plus the framing and the failure cases.
 */
import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import {
  decode as referenceDecode,
  encode as referenceEncode,
} from '@ag-ui/proto';
import { Effect, Exit, Option, Stream } from 'effect';
import { type AgUiEvent, decodeEvent } from '../src/index.js';
import {
  decodeEventBytes,
  decodeFrames,
  encodeEvent,
  encodeFrame,
  frame,
} from '../src/proto/index.js';
import { loadFixtures } from './fixtures.js';
import { richRun } from './samples.js';

/** Every event of the corpus that decodes, as our schema reads it. */
const corpusEvents = Effect.gen(function* () {
  const fixtures = yield* loadFixtures;
  const decoded = yield* Effect.forEach(
    fixtures.flatMap((fixture) => fixture.stream),
    (raw) =>
      decodeEvent(raw).pipe(
        Effect.option,
        Effect.map((option) => Option.flatten(option))
      )
  );
  return [...decoded.flatMap(Option.toArray), ...richRun];
}).pipe(Effect.provide(NodeServices.layer));

/** The reference decoder's view of bytes, as plain data. */
const viaReference = (bytes: Uint8Array): unknown =>
  structuredClone(referenceDecode(bytes));

it.effect(
  'encodes every corpus event so that @ag-ui/proto decodes it unchanged',
  () =>
    Effect.gen(function* () {
      const events = yield* corpusEvents;
      assert.isAbove(events.length, 200);
      for (const event of events) {
        const bytes = yield* encodeEvent(event);
        assert.deepStrictEqual(viaReference(bytes), event, event.type);
      }
    })
);

it.effect('decodes every corpus event that @ag-ui/proto encodes', () =>
  Effect.gen(function* () {
    const events = yield* corpusEvents;
    for (const event of events) {
      const bytes = referenceEncode(event as never);
      assert.deepStrictEqual(yield* decodeEventBytes(bytes), event, event.type);
    }
  })
);

it.effect(
  'frames a stream of events and reads it back across chunk boundaries',
  () =>
    Effect.gen(function* () {
      const events: ReadonlyArray<AgUiEvent> = [
        { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
        { type: 'STATE_SNAPSHOT', snapshot: null },
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
      ];
      const frames = yield* Effect.forEach(events, encodeFrame);
      const joined = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
      frames.reduce((offset, f) => {
        joined.set(f, offset);
        return offset + f.length;
      }, 0);
      const pieces = Array.from({ length: joined.length }, (_, i) =>
        joined.slice(i, i + 1)
      );
      const decoded = yield* decodeFrames(Stream.fromIterable(pieces)).pipe(
        Stream.runCollect
      );
      assert.deepStrictEqual(decoded, events);
    })
);

it.effect('fails a stream that ends inside a frame', () =>
  Effect.gen(function* () {
    const whole = yield* encodeFrame({
      type: 'RUN_STARTED',
      threadId: 't',
      runId: 'r',
    });
    const exit = yield* decodeFrames(
      Stream.make(whole.slice(0, whole.length - 1))
    ).pipe(Stream.runDrain, Effect.exit);
    assert.isTrue(Exit.isFailure(exit));
  })
);

it.effect('fails an envelope whose oneof arm this build does not know', () =>
  Effect.gen(function* () {
    // Field 40, length-delimited, holding an empty message.
    const unknownArm = new Uint8Array([0xc2, 0x02, 0x00]);
    const exit = yield* decodeFrames(Stream.make(frame(unknownArm))).pipe(
      Stream.runDrain,
      Effect.exit
    );
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.include(String(exit.cause), 'AgUiDecodeError');
    }
  })
);
