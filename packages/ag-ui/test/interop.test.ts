/**
 * Interop with the reference SDK, `@ag-ui/client` and `@ag-ui/encoder`
 * 1.0.4: the reference `HttpAgent` runs against our server over SSE and
 * protobuf, and our readers accept what the reference `EventEncoder` writes.
 */
import { HttpAgent } from '@ag-ui/client';
import { EventEncoder } from '@ag-ui/encoder';
import { assert, it, layer } from '@effect/vitest';
import { Data, Effect, Stream } from 'effect';
import {
  type AgUiEvent,
  decodeSse,
  encodeSse,
  PROTO_MEDIA_TYPE,
} from '../src/index.js';
import { decodeFrames, encodeFrame } from '../src/proto/index.js';
import type { Agent } from '../src/server/index.js';
import { richRun } from './samples.js';
import { AGENT_PATH, serverUrl, testServer } from './support.js';

/** A failure of the reference SDK, at the Promise boundary. */
class ReferenceSdkError extends Data.TaggedError('ReferenceSdkError')<{
  readonly cause: unknown;
}> {}

/** The reference agent, asking for protobuf instead of SSE. */
class ProtoHttpAgent extends HttpAgent {
  protected override requestInit(input: Parameters<HttpAgent['run']>[0]) {
    const init = super.requestInit(input);
    return {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Accept: PROTO_MEDIA_TYPE },
    };
  }
}

/** Runs the reference agent against our server and collects its events. */
const runReference = (encoding: 'sse' | 'proto') =>
  Effect.gen(function* () {
    const url = `${yield* serverUrl}${AGENT_PATH}`;
    const agent =
      encoding === 'proto' ? new ProtoHttpAgent({ url }) : new HttpAgent({ url });
    let events: ReadonlyArray<unknown> = [];
    yield* Effect.tryPromise({
      try: () =>
        agent.runAgent(
          {},
          {
            onEvent: ({ event }) => {
              events = [...events, event];
            },
          }
        ),
      catch: (cause) => new ReferenceSdkError({ cause }),
    });
    return events;
  });

/** The run that the replay agent sends. */
const replay: Agent = () => Stream.fromIterable(richRun);

layer(testServer(replay, { proto: true }))('the reference HttpAgent', (it) => {
  it.effect('runs against our server over SSE without a verification error', () =>
    Effect.gen(function* () {
      const events = yield* runReference('sse');
      assert.deepStrictEqual(
        events.map((event) => (event as AgUiEvent).type),
        richRun.map((event) => event.type)
      );
    })
  );

  it.effect('runs against our server over protobuf without a verification error', () =>
    Effect.gen(function* () {
      const events = yield* runReference('proto');
      assert.deepStrictEqual(
        events.map((event) => (event as AgUiEvent).type),
        richRun.map((event) => event.type)
      );
    })
  );
});

it.effect('reads the SSE that the reference EventEncoder writes', () =>
  Effect.gen(function* () {
    const encoder = new EventEncoder();
    const bytes = new TextEncoder().encode(
      richRun.map((event) => encoder.encodeSSE(event as never)).join('')
    );
    const decoded = yield* decodeSse(Stream.make(bytes)).pipe(Stream.runCollect);
    assert.deepStrictEqual(decoded, richRun);
  })
);

it.effect('writes the same SSE frame as the reference EventEncoder', () =>
  Effect.gen(function* () {
    const encoder = new EventEncoder();
    const event: AgUiEvent = {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'm-1',
      delta: 'Hi',
      subagentRunId: 's-1',
      timestamp: 1,
    };
    assert.strictEqual(yield* encodeSse(event), encoder.encodeSSE(event as never));
  })
);

it.effect('writes the same protobuf frames as the reference EventEncoder', () =>
  Effect.gen(function* () {
    const encoder = new EventEncoder({ accept: PROTO_MEDIA_TYPE });
    assert.strictEqual(encoder.getContentType(), PROTO_MEDIA_TYPE);
    for (const event of richRun) {
      const reference = encoder.encodeBinary(event as never);
      assert.deepStrictEqual(yield* encodeFrame(event), reference, event.type);
      const [decoded] = yield* decodeFrames(Stream.make(reference)).pipe(
        Stream.runCollect
      );
      assert.deepStrictEqual(decoded, event, event.type);
    }
  })
);
