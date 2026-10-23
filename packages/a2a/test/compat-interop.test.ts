/**
 * v0.3 interop over JSON-RPC and HTTP+JSON with `@a2a-js/sdk` 1.3.0: the
 * reference v0.3 transports against our server with legacy compat, and our
 * v0.3 transports against the reference server with legacy compat.
 */
import {
  CancelTaskRequest as RefCancel,
  DeleteTaskPushNotificationConfigRequest as RefDeletePush,
  GetTaskPushNotificationConfigRequest as RefGetPush,
  GetTaskRequest as RefGetTask,
  ListTaskPushNotificationConfigsRequest as RefListPush,
  SendMessageRequest as RefSend,
  StreamResponse as RefStreamResponse,
  SubscribeToTaskRequest as RefSubscribe,
  Task as RefTask,
  TaskPushNotificationConfig as RefPushConfig,
} from '@a2a-js/sdk';
import {
  Client as RefClient,
  type Transport as RefTransport,
} from '@a2a-js/sdk/client';
import {
  LegacyJsonRpcTransport,
  LegacyRestTransport,
  isLegacyAgentCard as refIsLegacyAgentCard,
  parseLegacyAgentCard as refParseLegacyAgentCard,
} from '@a2a-js/sdk/compat/v0_3/client';
import {
  UserBuilder as RefUserBuilder,
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
} from '@a2a-js/sdk/server/express';
import { assert, layer } from '@effect/vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Context, Data, Effect, Layer, Predicate, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import type { Client } from '../src/client/index.js';
import {
  LegacyCompatClient,
  legacyCardParser,
} from '../src/compat/v0_3/client/index.js';
import {
  duplicateInterfacesForLegacy,
  parseLegacyAgentCard,
} from '../src/compat/v0_3/index.js';
import { legacyCompat } from '../src/compat/v0_3/server/index.js';
import type { AgentCard, Message } from '../src/index.js';
import { legacyCard } from './compat-support.js';
import {
  REFERENCE_JSONRPC_PATH,
  REFERENCE_REST_PATH,
  makeReferenceHandler,
  referenceCard,
  toReferenceCard,
} from './reference.js';
import { serverUrl, testServer } from './support.js';

const BINDINGS = ['JSONRPC', 'HTTP+JSON'] as const;
type Binding = (typeof BINDINGS)[number];

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/** A failure of the reference SDK, at the Promise boundary. */
class ReferenceSdkFailure extends Data.TaggedError('ReferenceSdkFailure')<{
  readonly cause: unknown;
}> {}

const promise = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new ReferenceSdkFailure({ cause }),
  });

const collect = <A>(
  iterable: AsyncIterable<A>,
  limit = Number.POSITIVE_INFINITY
) =>
  Stream.fromAsyncIterable(
    iterable,
    (cause) => new ReferenceSdkFailure({ cause })
  ).pipe(Stream.take(limit), Stream.runCollect);

const errorName = (error: ReferenceSdkFailure) =>
  Predicate.hasProperty(error.cause, 'name')
    ? error.cause.name
    : String(error.cause);

const refMessage = (text: string) => ({
  messageId: nextId('ref'),
  role: 'ROLE_USER',
  parts: [{ text }],
});

const refStateOf = (task: RefTask) =>
  (RefTask.toJSON(task) as { status: { state: string } }).status.state;

const asRefTask = (result: unknown): RefTask => {
  assert.ok(Predicate.hasProperty(result, 'status'), 'expected a task');
  return result as RefTask;
};

const extended = (baseUrl: string): AgentCard => ({
  ...legacyCard(baseUrl),
  name: 'Echo Agent (extended)',
});

/** The reference v0.3 transport of a binding against our server. */
const referenceLegacyClient = (binding: Binding, url: string) => {
  const transport: RefTransport =
    binding === 'JSONRPC'
      ? new LegacyJsonRpcTransport({ endpoint: `${url}/` })
      : new LegacyRestTransport({ endpoint: url });
  return new RefClient(transport, toReferenceCard(legacyCard(url)));
};

layer(
  testServer({
    card: legacyCard,
    handler: (baseUrl) => ({
      extendedAgentCard: () => Effect.succeed(extended(baseUrl)),
    }),
    routes: { legacyCompat },
  }),
  { excludeTestServices: true }
)('the reference v0.3 client against our server', (it) => {
  for (const binding of BINDINGS) {
    it.effect(`${binding}: every v0.3 operation`, () =>
      Effect.gen(function* () {
        const url = yield* serverUrl;
        const client = referenceLegacyClient(binding, url);
        assert.strictEqual(client.protocolVersion, '0.3');

        const sent = asRefTask(
          yield* promise(() =>
            client.sendMessage(
              RefSend.fromJSON({ message: refMessage('hello') })
            )
          )
        );
        assert.strictEqual(refStateOf(sent), 'TASK_STATE_COMPLETED');
        assert.strictEqual(sent.artifacts[0]?.artifactId, 'echo');

        const reply = yield* promise(() =>
          client.sendMessage(
            RefSend.fromJSON({ message: refMessage('message') })
          )
        );
        assert.ok(Predicate.hasProperty(reply, 'messageId'));

        const events = yield* collect(
          client.sendMessageStream(
            RefSend.fromJSON({ message: refMessage('stream') })
          )
        );
        assert.deepStrictEqual(
          events.map(
            (event) => Object.keys(RefStreamResponse.toJSON(event) as object)[0]
          ),
          ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
        );

        const fetched = yield* promise(() =>
          client.getTask(RefGetTask.fromJSON({ id: sent.id }))
        );
        assert.strictEqual(fetched.id, sent.id);

        const waiting = asRefTask(
          yield* promise(() =>
            client.sendMessage(
              RefSend.fromJSON({
                message: refMessage('wait'),
                configuration: { returnImmediately: true },
              })
            )
          )
        );
        const canceled = yield* promise(() =>
          client.cancelTask(RefCancel.fromJSON({ id: waiting.id }))
        );
        assert.strictEqual(refStateOf(canceled), 'TASK_STATE_CANCELED');

        const paused = asRefTask(
          yield* promise(() =>
            client.sendMessage(
              RefSend.fromJSON({ message: refMessage('input') })
            )
          )
        );
        assert.strictEqual(refStateOf(paused), 'TASK_STATE_INPUT_REQUIRED');
        const resubscribed = yield* collect(
          client.resubscribeTask(RefSubscribe.fromJSON({ id: paused.id })),
          1
        );
        assert.strictEqual(
          (
            RefStreamResponse.toJSON(resubscribed[0] as RefStreamResponse) as {
              task: { id: string };
            }
          ).task.id,
          paused.id
        );

        const created = yield* promise(() =>
          client.createTaskPushNotificationConfig(
            RefPushConfig.fromJSON({
              taskId: sent.id,
              id: 'hook-1',
              url: 'http://127.0.0.1:9/hook',
              token: 'secret',
            })
          )
        );
        assert.strictEqual(created.id, 'hook-1');
        assert.strictEqual(created.taskId, sent.id);
        const got = yield* promise(() =>
          client.getTaskPushNotificationConfig(
            RefGetPush.fromJSON({ taskId: sent.id, id: 'hook-1' })
          )
        );
        assert.strictEqual(got.token, 'secret');
        const listed = yield* promise(() =>
          client.listTaskPushNotificationConfig(
            RefListPush.fromJSON({ taskId: sent.id })
          )
        );
        assert.deepStrictEqual(
          listed.configs.map((config) => config.id),
          ['hook-1']
        );
        yield* promise(() =>
          client.deleteTaskPushNotificationConfig(
            RefDeletePush.fromJSON({ taskId: sent.id, id: 'hook-1' })
          )
        );
        const afterDelete = yield* promise(() =>
          client.listTaskPushNotificationConfig(
            RefListPush.fromJSON({ taskId: sent.id })
          )
        );
        assert.strictEqual(afterDelete.configs.length, 0);

        const card = yield* promise(() => client.getAgentCard());
        assert.strictEqual(card.name, 'Echo Agent (extended)');

        const missing = yield* Effect.flip(
          promise(() => client.getTask(RefGetTask.fromJSON({ id: 'nope' })))
        );
        assert.strictEqual(errorName(missing), 'TaskNotFoundError');
      })
    );
  }

  it.effect('the reference reads our v0.3 card', () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const response = yield* http.execute(
        HttpClientRequest.get('/.well-known/agent-card.json')
      );
      const raw = yield* response.json;
      const parsed = refParseLegacyAgentCard(raw as never);
      assert.isFalse(refIsLegacyAgentCard(raw));
      assert.strictEqual(parsed.name, 'Echo Agent');
      assert.strictEqual(parsed.supportedInterfaces[0]?.protocolVersion, '0.3');
    })
  );
});

// ---------------------------------------------------------------------------
// Our v0.3 client against the reference legacy server
// ---------------------------------------------------------------------------

/** The card of the reference legacy server: v1.0 and v0.3 interfaces. */
const referenceLegacyCard = (url: string): AgentCard => {
  const card = referenceCard(url);
  return {
    ...card,
    supportedInterfaces: duplicateInterfacesForLegacy(
      card.supportedInterfaces,
      ['JSONRPC', 'HTTP+JSON']
    ),
  };
};

/** The reference Express server with legacy compat, on an ephemeral port. */
class ReferenceLegacyServer extends Context.Service<
  ReferenceLegacyServer,
  { readonly url: string }
>()('@jambudipa/a2a/test/ReferenceLegacyServer') {
  static readonly layer = Layer.effect(
    ReferenceLegacyServer,
    Effect.gen(function* () {
      const app = express();
      const server = yield* Effect.acquireRelease(
        Effect.callback<Server>((resume) => {
          const listening: Server = app.listen(0, '127.0.0.1', () =>
            resume(Effect.succeed(listening))
          );
        }),
        (listening) =>
          Effect.callback<void>((resume) => {
            listening.closeAllConnections();
            listening.close(() => resume(Effect.void));
          })
      );
      const address = server.address();
      const port =
        Predicate.hasProperty(address, 'port') &&
        Predicate.isNumber(address.port)
          ? address.port
          : 0;
      const url = `http://127.0.0.1:${port}`;
      const handler = makeReferenceHandler(referenceLegacyCard(url));
      const legacy = { enabled: true };
      app.use(
        '/.well-known/agent-card.json',
        agentCardHandler({ agentCardProvider: handler, legacyCompat: legacy })
      );
      app.use(
        REFERENCE_JSONRPC_PATH,
        jsonRpcHandler({
          requestHandler: handler,
          userBuilder: RefUserBuilder.noAuthentication,
          legacyCompat: legacy,
        })
      );
      app.use(
        REFERENCE_REST_PATH,
        restHandler({
          requestHandler: handler,
          userBuilder: RefUserBuilder.noAuthentication,
          legacyCompat: legacy,
        })
      );
      return ReferenceLegacyServer.of({ url });
    })
  );
}

/** Our client of a binding, from a card with only v0.3 interfaces. */
const ourLegacyClient = (binding: Binding, url: string) =>
  Effect.gen(function* () {
    const card = referenceLegacyCard(url);
    const factory = yield* LegacyCompatClient.clientFactory({
      preferredTransports: [binding],
    });
    return yield* factory.createFromAgentCard({
      ...card,
      supportedInterfaces: card.supportedInterfaces.filter(
        (agentInterface) => agentInterface.protocolVersion === '0.3'
      ),
    });
  }).pipe(Effect.provide(FetchHttpClient.layer));

const userMessage = (text: string): Message => ({
  messageId: nextId('ours'),
  role: 'ROLE_USER',
  parts: [{ text }],
});

const taskOf = (result: unknown) => {
  assert.ok(Predicate.hasProperty(result, 'status'), 'expected a task');
  return result as {
    readonly id: string;
    readonly status: { readonly state: string };
    readonly artifacts?: ReadonlyArray<{ readonly artifactId: string }>;
  };
};

layer(ReferenceLegacyServer.layer, { excludeTestServices: true })(
  'our v0.3 client against the reference server',
  (it) => {
    for (const binding of BINDINGS) {
      it.effect(`${binding}: every v0.3 operation`, () =>
        Effect.gen(function* () {
          const { url } = yield* ReferenceLegacyServer;
          const client: Client = yield* ourLegacyClient(binding, url);
          assert.strictEqual(client.transport.protocolName, binding);
          assert.strictEqual(client.protocolVersion, '0.3');

          const sent = taskOf(
            yield* client.sendMessage({ message: userMessage('hello') })
          );
          assert.strictEqual(sent.status.state, 'TASK_STATE_COMPLETED');
          assert.strictEqual(sent.artifacts?.[0]?.artifactId, 'echo');

          const reply = yield* client.sendMessage({
            message: userMessage('message'),
          });
          assert.ok('messageId' in reply);

          const events = yield* Stream.runCollect(
            client.sendMessageStream({ message: userMessage('stream') })
          );
          assert.deepStrictEqual(
            events.map((event) => Object.keys(event)[0]),
            ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
          );

          const fetched = yield* client.getTask({ id: sent.id });
          assert.strictEqual(fetched.id, sent.id);

          const waiting = taskOf(
            yield* client.sendMessage({
              message: userMessage('wait'),
              configuration: { returnImmediately: true },
            })
          );
          const canceled = yield* client.cancelTask({ id: waiting.id });
          assert.strictEqual(canceled.status.state, 'TASK_STATE_CANCELED');

          const paused = taskOf(
            yield* client.sendMessage({ message: userMessage('input') })
          );
          const resubscribed = yield* client
            .resubscribeTask({ id: paused.id })
            .pipe(Stream.take(1), Stream.runCollect);
          const first = resubscribed[0];
          assert.ok(first !== undefined && 'task' in first);

          const created = yield* client.createTaskPushNotificationConfig({
            taskId: sent.id,
            id: 'hook-1',
            url: 'http://127.0.0.1:9/hook',
            token: 'secret',
          });
          assert.strictEqual(created.id, 'hook-1');
          const got = yield* client.getTaskPushNotificationConfig({
            taskId: sent.id,
            id: 'hook-1',
          });
          assert.strictEqual(got.token, 'secret');
          const listed = yield* client.listTaskPushNotificationConfig({
            taskId: sent.id,
          });
          assert.deepStrictEqual(
            (listed.configs ?? []).map((config) => config.id),
            ['hook-1']
          );
          yield* client.deleteTaskPushNotificationConfig({
            taskId: sent.id,
            id: 'hook-1',
          });

          const card = yield* client.getAgentCard();
          assert.strictEqual(card.name, 'Reference Echo Agent (extended)');

          const missing = yield* Effect.flip(client.getTask({ id: 'nope' }));
          assert.strictEqual(missing._tag, 'TaskNotFoundError');
          const list = yield* Effect.flip(client.listTasks({}));
          assert.ok(
            list._tag === 'A2ATransportError' ||
              list._tag === 'UnsupportedOperationError'
          );
        })
      );
    }

    it.effect('parses the reference v0.3 card', () =>
      Effect.gen(function* () {
        const { url } = yield* ReferenceLegacyServer;
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.execute(
          HttpClientRequest.get(`${url}/.well-known/agent-card.json`)
        );
        const raw = yield* response.json;
        // The reference embeds the v1.0 interfaces, so, by its own rule, the
        // card is not a legacy card; it still parses as one.
        assert.strictEqual(
          legacyCardParser(raw)._tag,
          refIsLegacyAgentCard(raw) ? 'Some' : 'None'
        );
        const card = yield* parseLegacyAgentCard(raw);
        assert.strictEqual(card.name, 'Reference Echo Agent');
        assert.strictEqual(card.supportedInterfaces[0]?.protocolVersion, '0.3');
      }).pipe(Effect.provide(FetchHttpClient.layer))
    );
  }
);
