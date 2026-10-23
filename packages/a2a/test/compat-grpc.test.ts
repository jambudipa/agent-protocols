/**
 * v0.3 interop over gRPC with `@a2a-js/sdk` 1.3.0: the reference v0.3 gRPC
 * transport against our server with the v0.3 service, and our v0.3 gRPC
 * transport against the reference v0.3 service.
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
import { Client as RefClient } from '@a2a-js/sdk/client';
import { LegacyGrpcTransport as RefLegacyGrpcTransport } from '@a2a-js/sdk/compat/v0_3/client/grpc';
import {
  LegacyA2AService as RefLegacyA2AService,
  legacyGrpcService as refLegacyGrpcService,
} from '@a2a-js/sdk/compat/v0_3/server/grpc';
import { UserBuilder as RefUserBuilder } from '@a2a-js/sdk/server/grpc';
import { NodeCrypto } from '@effect/platform-node';
import * as grpc from '@grpc/grpc-js';
import { assert, layer } from '@effect/vitest';
import { Context, Data, Effect, Layer, Predicate, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import type { Client } from '../src/client/index.js';
import { LegacyGrpcTransportFactory } from '../src/compat/v0_3/client/grpc/index.js';
import { LegacyCompatClient } from '../src/compat/v0_3/client/index.js';
import { legacyGrpcService } from '../src/compat/v0_3/server/grpc/index.js';
import type { AgentCard, Message } from '../src/index.js';
import { A2AGrpcServer } from '../src/server/grpc/index.js';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '../src/server/index.js';
import { makeReferenceHandler, toReferenceCard } from './reference.js';
import { EchoExecutor, echoCard } from './support.js';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/** A gRPC card with a v1.0 and a v0.3 interface at `url`. */
const grpcCard = (url: string): AgentCard =>
  echoCard('', {
    supportedInterfaces: [
      { url, protocolBinding: 'GRPC', protocolVersion: '1.0' },
      { url, protocolBinding: 'GRPC', protocolVersion: '0.3' },
    ],
  });

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

const OurServer = A2AGrpcServer.layer({
  host: '127.0.0.1',
  port: 0,
  additionalServices: [legacyGrpcService()],
}).pipe(
  Layer.provide(
    DefaultRequestHandler.layer({
      agentCard: grpcCard('unused'),
      extendedAgentCard: () =>
        Effect.succeed({
          ...grpcCard('unused'),
          name: 'Echo Agent (extended)',
        }),
    })
  ),
  Layer.provide(Layer.fresh(InMemoryTaskStore.layer)),
  Layer.provide(EchoExecutor),
  Layer.provide(NodeCrypto.layer)
);

layer(OurServer, { excludeTestServices: true })(
  'the reference v0.3 gRPC client against our server',
  (it) => {
    it.effect('every v0.3 operation', () =>
      Effect.gen(function* () {
        const { port } = yield* A2AGrpcServer;
        const client = new RefClient(
          new RefLegacyGrpcTransport({ endpoint: `127.0.0.1:${port}` }),
          toReferenceCard(grpcCard(`127.0.0.1:${port}`))
        );
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

        const card = yield* promise(() => client.getAgentCard());
        assert.strictEqual(card.name, 'Echo Agent (extended)');

        const missing = yield* Effect.flip(
          promise(() => client.getTask(RefGetTask.fromJSON({ id: 'nope' })))
        );
        assert.strictEqual(errorName(missing), 'TaskNotFoundError');
      })
    );
  }
);

// ---------------------------------------------------------------------------
// Our v0.3 gRPC client against the reference v0.3 service
// ---------------------------------------------------------------------------

/** The reference gRPC server with the v0.3 service, on an ephemeral port. */
class ReferenceLegacyGrpcServer extends Context.Service<
  ReferenceLegacyGrpcServer,
  { readonly url: string }
>()('@jambudipa/a2a/test/ReferenceLegacyGrpcServer') {
  static readonly layer = Layer.effect(
    ReferenceLegacyGrpcServer,
    Effect.gen(function* () {
      const server = new grpc.Server();
      const handler = makeReferenceHandler(grpcCard('unused'));
      server.addService(
        RefLegacyA2AService,
        refLegacyGrpcService({
          requestHandler: handler,
          userBuilder: RefUserBuilder.noAuthentication,
        })
      );
      const port = yield* Effect.acquireRelease(
        Effect.callback<number>((resume) => {
          server.bindAsync(
            '127.0.0.1:0',
            grpc.ServerCredentials.createInsecure(),
            (error, bound) =>
              resume(
                Predicate.isNotNullish(error)
                  ? Effect.die(error)
                  : Effect.succeed(bound)
              )
          );
        }),
        () => Effect.sync(() => server.forceShutdown())
      );
      return ReferenceLegacyGrpcServer.of({ url: `127.0.0.1:${port}` });
    })
  );
}

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

layer(ReferenceLegacyGrpcServer.layer, { excludeTestServices: true })(
  'our v0.3 gRPC client against the reference server',
  (it) => {
    it.effect('every v0.3 operation', () =>
      Effect.gen(function* () {
        const { url } = yield* ReferenceLegacyGrpcServer;
        const grpcFactory = yield* LegacyGrpcTransportFactory.make();
        const factory = yield* LegacyCompatClient.clientFactory({
          transports: [grpcFactory],
          preferredTransports: ['GRPC'],
        });
        const card = grpcCard(url);
        const client: Client = yield* factory.createFromAgentCard({
          ...card,
          supportedInterfaces: card.supportedInterfaces.filter(
            (agentInterface) => agentInterface.protocolVersion === '0.3'
          ),
        });
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

        const extended = yield* client.getAgentCard();
        assert.strictEqual(extended.name, 'Echo Agent (extended)');

        const missing = yield* Effect.flip(client.getTask({ id: 'nope' }));
        assert.strictEqual(missing._tag, 'TaskNotFoundError');
        const list = yield* Effect.flip(client.listTasks({}));
        assert.strictEqual(list._tag, 'UnsupportedOperationError');
      }).pipe(Effect.provide(FetchHttpClient.layer))
    );
  }
);
