/**
 * The server and the client together, over SSE and protobuf, with one test
 * for each row of the plan's I/O matrix.
 */
import { assert, it, layer } from '@effect/vitest';
import { Data, Effect, Exit, Layer, Option, Predicate, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { AgUiClient } from '../src/client/index.js';
import {
  type AgUiEvent,
  PROTO_MEDIA_TYPE,
  type RunAgentInput,
} from '../src/index.js';
import { AgUiProto, encodeFrame, frame } from '../src/proto/index.js';
import type { Agent } from '../src/server/index.js';
import { richInput, richRun } from './samples.js';
import { AGENT_PATH, rawServer, testServer } from './support.js';

/** A small input for the agents that ignore theirs. */
const input: RunAgentInput = { threadId: 't-1', runId: 'r-1', messages: [] };

/** The fixed run that the replay agent sends. */
const replay: Agent = () => Stream.fromIterable(richRun);

/** An agent that fails after it opens the run. */
class Boom extends Data.TaggedError('Boom')<{ readonly message: string }> {}

/** Opens a run, then fails. */
const failing: Agent<Boom> = (request) =>
  Stream.concat(
    Stream.make<ReadonlyArray<AgUiEvent>>({
      type: 'RUN_STARTED',
      threadId: request.threadId,
      runId: request.runId,
    }),
    Stream.fail(new Boom({ message: 'the model is down' }))
  );

/** Runs the client over SSE and collects the run. */
const runSse = (body: RunAgentInput) =>
  Effect.gen(function* () {
    const client = yield* AgUiClient;
    return yield* Stream.runCollect(client.run(body));
  }).pipe(Effect.provide(AgUiClient.layer({ url: AGENT_PATH })));

/** Runs the client asking for protobuf and collects the run. */
const runProto = (body: RunAgentInput) =>
  Effect.gen(function* () {
    const client = yield* AgUiClient;
    return yield* Stream.runCollect(client.run(body));
  }).pipe(
    Effect.provide(
      AgUiClient.layer({ url: AGENT_PATH, encoding: 'proto' }).pipe(
        Layer.provide(AgUiProto.layer)
      )
    )
  );

/** Posts a JSON body with an `Accept` header and reads the raw response. */
const post = (body: string, accept: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.post(AGENT_PATH).pipe(
        HttpClientRequest.setHeader('Accept', accept),
        HttpClientRequest.bodyText(body, 'application/json')
      )
    );
    return {
      status: response.status,
      contentType: response.headers['content-type'] ?? '',
      bytes: new Uint8Array(yield* response.arrayBuffer),
    };
  });

/** The tag of a failed exit, for assertions. */
const failureTag = <A, E>(exit: Exit.Exit<A, E>): string =>
  Option.match(Exit.findErrorOption(exit), {
    onNone: () => 'none',
    onSome: (error) =>
      Predicate.hasProperty(error, '_tag') ? String(error._tag) : 'none',
  });

/** The message of a failed exit, for assertions. */
const failureMessage = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? String(exit.cause) : '';

layer(testServer(replay, { proto: true }))('a fixed run', (it) => {
  it.effect('reaches the client unchanged over SSE', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runSse(richInput), richRun);
    })
  );

  it.effect('reaches the client unchanged over protobuf', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runProto(richInput), richRun);
    })
  );

  it.effect(
    'is one data: frame for each event, with no event: or id: line',
    () =>
      Effect.gen(function* () {
        const response = yield* post(
          '{"threadId":"t","runId":"r","messages":[]}',
          'text/event-stream'
        );
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.contentType, 'text/event-stream');
        const text = new TextDecoder().decode(response.bytes);
        const frames = text.split('\n\n').filter((frame) => frame !== '');
        assert.strictEqual(frames.length, richRun.length);
        for (const frame of frames) {
          assert.match(frame, /^data: \{.*\}$/);
        }
        assert.notInclude(text, 'null,');
      })
  );

  it.effect('answers protobuf only when Accept prefers it', () =>
    Effect.gen(function* () {
      const body = '{"threadId":"t","runId":"r","messages":[]}';
      const proto = yield* post(body, PROTO_MEDIA_TYPE);
      assert.strictEqual(proto.contentType, PROTO_MEDIA_TYPE);
      const first = yield* encodeFrame(richRun[0] as AgUiEvent);
      assert.deepStrictEqual(proto.bytes.slice(0, first.length), first);
      const any = yield* post(body, '*/*');
      assert.strictEqual(any.contentType, 'text/event-stream');
      const preferred = yield* post(
        body,
        `text/event-stream;q=0.5, ${PROTO_MEDIA_TYPE}`
      );
      assert.strictEqual(preferred.contentType, PROTO_MEDIA_TYPE);
      const sse = yield* post(
        body,
        `${PROTO_MEDIA_TYPE};q=0.1, text/event-stream`
      );
      assert.strictEqual(sse.contentType, 'text/event-stream');
    })
  );

  it.effect(
    'answers 400 to an invalid body, and the client fails with it',
    () =>
      Effect.gen(function* () {
        const response = yield* post('{}', 'text/event-stream');
        assert.strictEqual(response.status, 400);
        assert.include(new TextDecoder().decode(response.bytes), 'threadId');
        const exit = yield* Effect.exit(runSse({} as RunAgentInput));
        assert.strictEqual(failureTag(exit), 'AgUiEncodeError');
        const http = yield* HttpClient.HttpClient;
        const raw = yield* Effect.exit(
          Effect.gen(function* () {
            const client = yield* AgUiClient;
            return yield* Stream.runCollect(client.run(input));
          }).pipe(
            Effect.provide(AgUiClient.layer({ url: AGENT_PATH })),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.mapRequest(
                http,
                HttpClientRequest.bodyText('{}', 'application/json')
              )
            )
          )
        );
        assert.strictEqual(failureTag(raw), 'AgUiHttpError');
        if (Exit.isFailure(raw) && raw.cause.reasons[0]?._tag === 'Fail') {
          const error = raw.cause.reasons[0].error;
          assert.strictEqual(
            error._tag === 'AgUiHttpError' && error.status,
            400
          );
          assert.include(
            error._tag === 'AgUiHttpError' ? error.body : '',
            'threadId'
          );
        }
      })
  );
});

layer(testServer(failing, { proto: true }))(
  'an agent that fails mid-run',
  (it) => {
    it.effect('ends the stream with RUN_ERROR and status 200', () =>
      Effect.gen(function* () {
        const response = yield* post(
          '{"threadId":"t","runId":"r","messages":[]}',
          'text/event-stream'
        );
        assert.strictEqual(response.status, 200);
        for (const run of [runSse, runProto]) {
          const events = yield* run(input);
          assert.deepStrictEqual(events, [
            { type: 'RUN_STARTED', threadId: 't-1', runId: 'r-1' },
            { type: 'RUN_ERROR', message: 'the model is down' },
          ]);
        }
      })
    );
  }
);

layer(
  testServer(() =>
    Stream.make<ReadonlyArray<AgUiEvent>>(
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-opened', delta: 'x' }
    )
  )
)('an out-of-order run', (it) => {
  it.effect('fails the client with a verification error naming the rule', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runSse(input));
      assert.strictEqual(failureTag(exit), 'AgUiVerifyError');
      assert.include(
        failureMessage(exit),
        "No active text message found with ID 'never-opened'"
      );
    })
  );
});

layer(
  testServer(
    () =>
      Stream.make<ReadonlyArray<AgUiEvent>>(
        { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
        {
          type: 'TEXT_MESSAGE_CHUNK',
          messageId: 'm',
          role: 'user',
          delta: 'a',
        },
        { type: 'TEXT_MESSAGE_CHUNK', delta: 'b' },
        {
          type: 'TOOL_CALL_CHUNK',
          toolCallId: 'tc',
          toolCallName: 'f',
          delta: '{',
        },
        { type: 'TOOL_CALL_CHUNK', delta: '}' },
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }
      ),
    { proto: true }
  )
)('a run of chunks', (it) => {
  it.effect('reaches the client expanded, over SSE and protobuf', () =>
    Effect.gen(function* () {
      const expected: ReadonlyArray<AgUiEvent> = [
        { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
        { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'user' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'a' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'b' },
        { type: 'TEXT_MESSAGE_END', messageId: 'm' },
        { type: 'TOOL_CALL_START', toolCallId: 'tc', toolCallName: 'f' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'tc', delta: '{' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'tc', delta: '}' },
        { type: 'TOOL_CALL_END', toolCallId: 'tc' },
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
      ];
      assert.deepStrictEqual(yield* runSse(input), expected);
      assert.deepStrictEqual(yield* runProto(input), expected);
    })
  );
});

layer(
  testServer(() =>
    Stream.make<ReadonlyArray<AgUiEvent>>(
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'TOOL_CALL_CHUNK', toolCallId: 'tc', toolCallName: 'f' },
      { type: 'TOOL_CALL_CHUNK', toolCallName: 'g', delta: '{}' }
    )
  )
)('chunks that disagree with their opener', (it) => {
  it.effect('fail the client with a verification error', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runSse(input));
      assert.strictEqual(failureTag(exit), 'AgUiVerifyError');
      assert.include(
        failureMessage(exit),
        "does not match the open stream's toolCallName"
      );
    })
  );
});

const sseOf = (...events: ReadonlyArray<string>) =>
  events.map((event) => `data: ${event}\n\n`).join('');

layer(
  rawServer(
    sseOf(
      '{"type":"RUN_STARTED","threadId":"t","runId":"r"}',
      '{"type":"TEXT_MESSAGE_START","messageId":"m","name":null}'
    ),
    'text/event-stream'
  )
)('an event with an explicit null', (it) => {
  it.effect('fails the client with a decode error', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runSse(input));
      assert.strictEqual(failureTag(exit), 'AgUiDecodeError');
      assert.include(failureMessage(exit), '/name');
    })
  );
});

layer(
  rawServer(
    sseOf(
      '{"type":"RUN_STARTED","threadId":"t","runId":"r","futureField":{"x":1}}',
      '{"type":"RUN_FINISHED","threadId":"t","runId":"r","extra":true}'
    ),
    'text/event-stream'
  )
)('events with unknown fields', (it) => {
  it.effect('decode with the fields dropped', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runSse(input), [
        { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
      ]);
    })
  );
});

layer(
  // Field 40 of the envelope: an arm that AG-UI 1.0 does not define.
  rawServer(frame(new Uint8Array([0xc2, 0x02, 0x00])), PROTO_MEDIA_TYPE)
)('a protobuf frame with an unknown oneof arm', (it) => {
  it.effect('fails the protobuf client with a decode error', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runProto(input));
      assert.strictEqual(failureTag(exit), 'AgUiDecodeError');
    })
  );
});

it('keeps the AG-UI wire constants', () => {
  assert.strictEqual(PROTO_MEDIA_TYPE, 'application/vnd.ag-ui.event+proto');
});
