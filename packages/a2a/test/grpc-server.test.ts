/**
 * Our gRPC server against the gRPC client of `@a2a-js/sdk` 1.3.0.
 */
import {
  AgentCard as RefAgentCard,
  CancelTaskRequest as RefCancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest as RefDeleteConfigRequest,
  GetTaskPushNotificationConfigRequest as RefGetConfigRequest,
  GetTaskRequest as RefGetTaskRequest,
  ListTaskPushNotificationConfigsRequest as RefListConfigsRequest,
  ListTaskPushNotificationConfigsResponse as RefListConfigsResponse,
  ListTasksRequest as RefListTasksRequest,
  ListTasksResponse as RefListTasksResponse,
  Message as RefMessage,
  SendMessageRequest as RefSendMessageRequest,
  StreamResponse as RefStreamResponse,
  SubscribeToTaskRequest as RefSubscribeRequest,
  Task as RefTask,
  TaskPushNotificationConfig as RefPushConfig,
} from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import { GrpcTransportFactory as RefGrpcTransportFactory } from '@a2a-js/sdk/client/grpc';
import { create } from '@bufbuild/protobuf';
import * as grpc from '@grpc/grpc-js';
import { NodeCrypto } from '@effect/platform-node';
import { assert, layer } from '@effect/vitest';
import { Data, Effect, Fiber, Layer, Predicate, Schema, Stream } from 'effect';
import {
  AgentCard,
  ListTaskPushNotificationConfigsResponse,
  ListTasksResponse,
  Message,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
} from '../src/index.js';
import {
  GrpcTransportFactory,
  callUnary,
  openGrpcClient,
} from '../src/client/grpc/index.js';
import * as pb from '../src/generated/v1/a2a_pb.js';
import { A2AGrpcServer, methodPath } from '../src/server/grpc/index.js';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '../src/server/index.js';
import { EchoExecutor, echoCard } from './support.js';

const grpcCard = (url: string): AgentCard =>
  echoCard('', {
    supportedInterfaces: [
      { url, protocolBinding: 'GRPC', protocolVersion: '1.0' },
    ],
  });

const encodeCard = Schema.encodeSync(AgentCard);

const ServerLayer = A2AGrpcServer.layer({ host: '127.0.0.1', port: 0 }).pipe(
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

/** The reference client, connected to our server over gRPC. */
const referenceClient = Effect.gen(function* () {
  const { port } = yield* A2AGrpcServer;
  const factory = new ClientFactory({
    transports: [new RefGrpcTransportFactory()],
  });
  return yield* Effect.promise(() =>
    factory.createFromAgentCard(
      RefAgentCard.fromJSON(encodeCard(grpcCard(`127.0.0.1:${port}`)))
    )
  );
});

const userMessage = (text: string, id: string) =>
  RefSendMessageRequest.fromJSON({
    message: { messageId: id, role: 'ROLE_USER', parts: [{ text }] },
  });

const decodeTask = (value: unknown) =>
  Schema.decodeUnknownSync(Task)(RefTask.toJSON(value as RefTask));

const collect = <A>(iterable: AsyncIterable<A>) =>
  Stream.runCollect(Stream.fromAsyncIterable(iterable, (error) => error));

const decodeEvents = (events: ReadonlyArray<RefStreamResponse>) =>
  events.map((event) =>
    Schema.decodeUnknownSync(StreamResponse)(RefStreamResponse.toJSON(event))
  );

/** A failure of a reference client call. */
class ReferenceFailure extends Data.TaggedError('ReferenceFailure')<{
  readonly error: unknown;
}> {}

const failure = <A>(promise: () => Promise<A>) =>
  Effect.flip(
    Effect.tryPromise({
      try: promise,
      catch: (error) => new ReferenceFailure({ error }),
    })
  ).pipe(Effect.map((failed) => failed.error));

layer(ServerLayer, { excludeTestServices: true })(
  'our gRPC server with the reference client',
  (it) => {
    it.effect('sends a message and returns the completed task', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const result = yield* Effect.promise(() =>
          client.sendMessage(userMessage('hello', 'g-1'))
        );
        const task = decodeTask(result);
        assert.strictEqual(task.status.state, 'TASK_STATE_COMPLETED');
        assert.strictEqual(task.artifacts?.[0]?.artifactId, 'echo');
      })
    );

    it.effect('returns a message for a message-only answer', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const result = yield* Effect.promise(() =>
          client.sendMessage(userMessage('message', 'g-2'))
        );
        const message = Schema.decodeUnknownSync(Message)(
          RefMessage.toJSON(result as RefMessage)
        );
        assert.strictEqual(message.role, 'ROLE_AGENT');
        assert.deepStrictEqual(message.parts, [{ text: 'hello back' }]);
      })
    );

    it.effect('streams the task lifecycle', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const events = decodeEvents(
          yield* collect(client.sendMessageStream(userMessage('hi', 'g-3')))
        );
        assert.deepStrictEqual(
          events.map((event) => Object.keys(event)[0]),
          ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
        );
        const last = events.at(-1);
        assert.isTrue(
          last !== undefined &&
            'statusUpdate' in last &&
            last.statusUpdate.status.state === 'TASK_STATE_COMPLETED'
        );
      })
    );

    it.effect('gets and lists tasks', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const sent = decodeTask(
          yield* Effect.promise(() =>
            client.sendMessage(userMessage('listed', 'g-4'))
          )
        );
        const fetched = decodeTask(
          yield* Effect.promise(() =>
            client.getTask(
              RefGetTaskRequest.fromJSON({ id: sent.id, historyLength: 1 })
            )
          )
        );
        assert.strictEqual(fetched.id, sent.id);
        assert.strictEqual(fetched.history?.length, 1);
        const listed = Schema.decodeUnknownSync(ListTasksResponse)(
          RefListTasksResponse.toJSON(
            yield* Effect.promise(() =>
              client.listTasks(
                RefListTasksRequest.fromJSON({
                  pageSize: 100,
                  includeArtifacts: true,
                })
              )
            )
          )
        );
        assert.isTrue(listed.tasks.some((task) => task.id === sent.id));
        assert.isTrue(listed.totalSize >= 1);
      })
    );

    it.effect('cancels a running task and streams it to a subscriber', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const started = decodeTask(
          yield* Effect.promise(() =>
            client.sendMessage(
              RefSendMessageRequest.fromJSON({
                message: {
                  messageId: 'g-5',
                  role: 'ROLE_USER',
                  parts: [{ text: 'wait' }],
                },
                configuration: { returnImmediately: true },
              })
            )
          )
        );
        const subscriber = yield* Effect.forkChild(
          collect(
            client.resubscribeTask(
              RefSubscribeRequest.fromJSON({ id: started.id })
            )
          )
        );
        yield* Effect.sleep('200 millis');
        const canceled = decodeTask(
          yield* Effect.promise(() =>
            client.cancelTask(RefCancelTaskRequest.fromJSON({ id: started.id }))
          )
        );
        assert.strictEqual(canceled.status.state, 'TASK_STATE_CANCELED');
        const events = decodeEvents(yield* Fiber.join(subscriber));
        assert.isTrue(events[0] !== undefined && 'task' in events[0]);
        const last = events.at(-1);
        assert.isTrue(
          last !== undefined &&
            'statusUpdate' in last &&
            last.statusUpdate.status.state === 'TASK_STATE_CANCELED'
        );
      })
    );

    it.effect('creates, gets, lists and deletes push configs', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const task = decodeTask(
          yield* Effect.promise(() =>
            client.sendMessage(userMessage('push', 'g-6'))
          )
        );
        const created = Schema.decodeUnknownSync(TaskPushNotificationConfig)(
          RefPushConfig.toJSON(
            yield* Effect.promise(() =>
              client.createTaskPushNotificationConfig(
                RefPushConfig.fromJSON({
                  taskId: task.id,
                  url: 'http://127.0.0.1:9/hook',
                  token: 'secret',
                })
              )
            )
          )
        );
        assert.isTrue(Predicate.isString(created.id) && created.id !== '');
        const configId = created.id ?? '';
        const fetched = Schema.decodeUnknownSync(TaskPushNotificationConfig)(
          RefPushConfig.toJSON(
            yield* Effect.promise(() =>
              client.getTaskPushNotificationConfig(
                RefGetConfigRequest.fromJSON({ taskId: task.id, id: configId })
              )
            )
          )
        );
        assert.strictEqual(fetched.url, 'http://127.0.0.1:9/hook');
        const listed = Schema.decodeUnknownSync(
          ListTaskPushNotificationConfigsResponse
        )(
          RefListConfigsResponse.toJSON(
            yield* Effect.promise(() =>
              client.listTaskPushNotificationConfig(
                RefListConfigsRequest.fromJSON({ taskId: task.id })
              )
            )
          )
        );
        assert.strictEqual(listed.configs?.length, 1);
        yield* Effect.promise(() =>
          client.deleteTaskPushNotificationConfig(
            RefDeleteConfigRequest.fromJSON({ taskId: task.id, id: configId })
          )
        );
        const after = yield* Effect.promise(() =>
          client.listTaskPushNotificationConfig(
            RefListConfigsRequest.fromJSON({ taskId: task.id })
          )
        );
        assert.strictEqual(after.configs.length, 0);
      })
    );

    it.effect('returns the extended agent card', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const card = yield* Effect.promise(() => client.getAgentCard());
        assert.strictEqual(card.name, 'Echo Agent (extended)');
      })
    );

    it.effect('answers an unknown task with NOT_FOUND and TASK_NOT_FOUND', () =>
      Effect.gen(function* () {
        const client = yield* referenceClient;
        const error = yield* failure(() =>
          client.getTask(RefGetTaskRequest.fromJSON({ id: 'missing' }))
        );
        assert.isTrue(Predicate.hasProperty(error, 'name'));
        assert.strictEqual(
          Predicate.hasProperty(error, 'name') ? error.name : '',
          'TaskNotFoundError'
        );
        assert.strictEqual(
          Predicate.hasProperty(error, 'status') ? error.status : -1,
          5
        );
      })
    );

    it.effect('rejects a call that asks for protocol 0.3', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { port } = yield* A2AGrpcServer;
          const factory = yield* GrpcTransportFactory.make();
          const transport = yield* factory.create(
            `127.0.0.1:${port}`,
            grpcCard(`127.0.0.1:${port}`)
          );
          const error = yield* Effect.flip(
            transport.getTask(
              { id: 'missing' },
              { serviceParameters: { 'A2A-Version': '0.3' } }
            )
          );
          assert.strictEqual(error._tag, 'VersionNotSupportedError');
          const missing = yield* Effect.flip(
            transport.getTask({ id: 'missing' })
          );
          assert.strictEqual(missing._tag, 'TaskNotFoundError');
        })
      )
    );

    it.effect(
      'rejects a call without A2A-Version and a send without a message',
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { port } = yield* A2AGrpcServer;
            const client = yield* Effect.acquireRelease(
              Effect.sync(() =>
                openGrpcClient({ endpoint: `127.0.0.1:${port}` })
              ),
              (open) => Effect.sync(() => open.close())
            );
            const getTask = {
              path: methodPath('getTask'),
              input: pb.GetTaskRequestSchema,
              output: pb.TaskSchema,
            };
            const noVersion = yield* Effect.flip(
              callUnary(
                client,
                getTask,
                create(pb.GetTaskRequestSchema, { id: 'missing' }),
                new grpc.Metadata()
              )
            );
            assert.strictEqual(noVersion._tag, 'VersionNotSupportedError');
            const metadata = new grpc.Metadata();
            metadata.set('a2a-version', '1.0');
            const noMessage = yield* Effect.flip(
              callUnary(
                client,
                {
                  path: methodPath('sendMessage'),
                  input: pb.SendMessageRequestSchema,
                  output: pb.SendMessageResponseSchema,
                },
                create(pb.SendMessageRequestSchema, {}),
                metadata
              )
            );
            assert.strictEqual(noMessage._tag, 'RequestMalformedError');
          })
        )
    );
  }
);
