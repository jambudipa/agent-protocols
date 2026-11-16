/**
 * The schemas: a round trip through JSON for every event family, and the
 * tolerance rules (unknown keys and union members stripped, a null on an
 * optional field and a wrong-typed field rejected).
 */
import { assert, it } from '@effect/vitest';
import { Effect, Exit, Option, Schema } from 'effect';
import {
  AgUiEvent,
  decodeEvent,
  decodeEventJson,
  encodeEventJson,
  encodeSse,
  RunAgentInput,
} from '../src/index.js';
import { richInput, richRun } from './samples.js';

it.effect('round-trips every event of the sample run through JSON', () =>
  Effect.gen(function* () {
    for (const event of richRun) {
      const json = yield* encodeEventJson(event);
      assert.deepStrictEqual(yield* decodeEventJson(json), Option.some(event));
      assert.strictEqual(yield* encodeSse(event), `data: ${json}\n\n`);
    }
  })
);

it('round-trips a RunAgentInput with every message role and part kind', () => {
  const codec = Schema.fromJsonString(RunAgentInput);
  const json = Schema.encodeSync(codec)(richInput);
  assert.deepStrictEqual(Schema.decodeUnknownSync(codec)(json), richInput);
});

it.effect('drops unknown keys and unknown union members, and keeps patch extras', () =>
  Effect.gen(function* () {
    const decoded = yield* decodeEvent({
      type: 'MESSAGES_SNAPSHOT',
      future: 1,
      messages: [
        { id: 'a', role: 'oracle', content: 'x' },
        {
          id: 'b',
          role: 'user',
          extra: true,
          content: [
            { type: 'text', text: 'keep' },
            { type: 'hologram' },
            { type: 'image', source: { type: 'ipfs', value: 'q' } },
          ],
        },
      ],
    });
    assert.deepStrictEqual(
      decoded,
      Option.some({
        type: 'MESSAGES_SNAPSHOT',
        messages: [{ id: 'b', role: 'user', content: [{ type: 'text', text: 'keep' }] }],
      })
    );
    const patch = yield* decodeEvent({
      type: 'STATE_DELTA',
      delta: [
        { op: 'remove', path: '/a', value: 'left over' },
        { op: 'increment', path: '/b' },
      ],
    });
    assert.deepStrictEqual(
      patch,
      Option.some({
        type: 'STATE_DELTA',
        delta: [{ op: 'remove', path: '/a', value: 'left over' }],
      })
    );
    const outcome = yield* decodeEvent({
      type: 'RUN_FINISHED',
      threadId: 't',
      runId: 'r',
      outcome: { type: 'paused' },
    });
    assert.deepStrictEqual(
      outcome,
      Option.some({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' })
    );
  })
);

it.effect('gives none for an event of an unknown type', () =>
  Effect.gen(function* () {
    assert.isTrue(Option.isNone(yield* decodeEvent({ type: 'THINKING_START' })));
    assert.isTrue(Option.isNone(yield* decodeEvent({ type: 'META_EVENT' })));
  })
);

it.effect('rejects a null on an optional field and a wrong-typed field', () =>
  Effect.gen(function* () {
    const withNull = yield* Effect.exit(
      decodeEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm', name: null })
    );
    assert.isTrue(Exit.isFailure(withNull));
    const wrongType = yield* Effect.exit(
      decodeEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 42 })
    );
    assert.isTrue(Exit.isFailure(wrongType));
    assert.include(String(wrongType), '/delta: expected string, received 42');
    const array = yield* Effect.exit(
      decodeEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: [] })
    );
    assert.include(String(array), 'expected object, received array');
  })
);

it.effect('rejects an event that does not match its schema on encode', () =>
  Effect.gen(function* () {
    const invalid = { type: 'TEXT_MESSAGE_START', messageId: 'm', name: null };
    const exit = yield* Effect.exit(
      encodeEventJson(invalid as unknown as AgUiEvent)
    );
    assert.isTrue(Exit.isFailure(exit));
  })
);
