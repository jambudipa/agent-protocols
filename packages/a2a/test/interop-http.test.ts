/**
 * Interop over JSON-RPC and HTTP+JSON with `@a2a-js/sdk` 1.3.0: the
 * reference client against our server, and our client against the
 * reference server.
 */
import {
  CancelTaskRequest as RefCancel,
  DeleteTaskPushNotificationConfigRequest as RefDeletePush,
  GetTaskPushNotificationConfigRequest as RefGetPush,
  GetTaskRequest as RefGetTask,
  ListTaskPushNotificationConfigsRequest as RefListPush,
  ListTasksRequest as RefListTasks,
  SendMessageRequest as RefSend,
  StreamResponse as RefStreamResponse,
  SubscribeToTaskRequest as RefSubscribe,
  Task as RefTask,
  TaskPushNotificationConfig as RefPushConfig,
} from '@a2a-js/sdk';
import {
  type Client as RefClient,
  ClientFactory as RefClientFactory,
  ClientFactoryOptions as RefClientFactoryOptions,
} from '@a2a-js/sdk/client';
import { assert, layer } from '@effect/vitest';
import { Effect, Layer, Predicate, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { ClientFactory, type Client } from '../src/client/index.js';
import type {
  Message,
  SendMessageResult,
  StreamResponse,
} from '../src/index.js';
import { ReferenceHttpServer } from './reference.js';
import { echoCard, serverUrl, testServer } from './support.js';

const BINDINGS = ['JSONRPC', 'HTTP+JSON'] as const;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

const refJson = (text: string) => ({
  messageId: nextId('ref'),
  role: 'ROLE_USER',
  parts: [{ text }],
});

const promise = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause });

const collect = <A>(
  iterable: AsyncIterable<A>,
  limit = Number.POSITIVE_INFINITY
) =>
  Stream.fromAsyncIterable(iterable, (cause) => cause).pipe(
    Stream.take(limit),
    Stream.runCollect
  );

const refTaskOf = (result: unknown) => {
  assert.ok(Predicate.hasProperty(result, 'status'), 'expected a task');
  return RefTask.toJSON(result as RefTask) as Record<string, unknown>;
};

const errorName = (error: unknown) =>
  Predicate.hasProperty(error, 'name') ? error.name : String(error);

/** The reference client of one binding, against our server. */
const referenceClient = (binding: (typeof BINDINGS)[number], url: string) =>
  promise(() =>
    new RefClientFactory(
      RefClientFactoryOptions.createFrom(RefClientFactoryOptions.default, {
        preferredTransports: [binding],
      })
    ).createFromUrl(url)
  );

const extendedCard = (baseUrl: string) => ({
  ...echoCard(baseUrl),
  name: 'Echo Agent (extended)',
});

layer(
  testServer({
    handler: (baseUrl) => ({
      extendedAgentCard: () => Effect.succeed(extendedCard(baseUrl)),
    }),
  }),
  { excludeTestServices: true }
)('the reference client against our server', (it) => {
  for (const binding of BINDINGS) {
    it.effect(
      `${binding}: sends, streams, gets, lists, cancels and subscribes`,
      () =>
        Effect.gen(function* () {
          const url = yield* serverUrl;
          const client: RefClient = yield* referenceClient(binding, url);
          assert.strictEqual(client.transport.protocolName, binding);

          const sent = refTaskOf(
            yield* promise(() =>
              client.sendMessage(
                RefSend.fromJSON({ message: refJson('hello') })
              )
            )
          );
          assert.strictEqual(
            (sent['status'] as Record<string, unknown>)['state'],
            'TASK_STATE_COMPLETED'
          );
          const artifacts = sent['artifacts'] as ReadonlyArray<
            Record<string, unknown>
          >;
          assert.strictEqual(artifacts[0]?.['artifactId'], 'echo');

          const reply = yield* promise(() =>
            client.sendMessage(
              RefSend.fromJSON({ message: refJson('message') })
            )
          );
          assert.ok(Predicate.hasProperty(reply, 'messageId'));

          const events = yield* collect(
            client.sendMessageStream(
              RefSend.fromJSON({ message: refJson('stream') })
            )
          );
          assert.deepStrictEqual(
            events.map(
              (event) =>
                Object.keys(RefStreamResponse.toJSON(event) as object)[0]
            ),
            ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
          );

          const id = sent['id'] as string;
          const fetched = yield* promise(() =>
            client.getTask(RefGetTask.fromJSON({ id, historyLength: 1 }))
          );
          assert.strictEqual(fetched.id, id);
          assert.strictEqual(fetched.history.length, 1);

          const listed = yield* promise(() =>
            client.listTasks(RefListTasks.fromJSON({ pageSize: 100 }))
          );
          assert.ok(listed.tasks.some((task) => task.id === id));
          assert.ok(listed.totalSize >= 1);

          const waiting = refTaskOf(
            yield* promise(() =>
              client.sendMessage(
                RefSend.fromJSON({
                  message: refJson('wait'),
                  configuration: { returnImmediately: true },
                })
              )
            )
          );
          const canceled = yield* promise(() =>
            client.cancelTask(RefCancel.fromJSON({ id: waiting['id'] }))
          );
          assert.strictEqual(
            (refTaskOf(canceled)['status'] as Record<string, unknown>)['state'],
            'TASK_STATE_CANCELED'
          );

          const paused = refTaskOf(
            yield* promise(() =>
              client.sendMessage(
                RefSend.fromJSON({ message: refJson('input') })
              )
            )
          );
          const resubscribed = yield* collect(
            client.resubscribeTask(RefSubscribe.fromJSON({ id: paused['id'] })),
            1
          );
          assert.strictEqual(
            (
              RefStreamResponse.toJSON(
                resubscribed[0] as RefStreamResponse
              ) as { task: { id: string } }
            ).task.id,
            paused['id']
          );

          const missing = yield* Effect.flip(
            promise(() => client.getTask(RefGetTask.fromJSON({ id: 'nope' })))
          );
          assert.strictEqual(errorName(missing), 'TaskNotFoundError');
        })
    );

    it.effect(
      `${binding}: manages push configs and reads the extended card`,
      () =>
        Effect.gen(function* () {
          const url = yield* serverUrl;
          const client: RefClient = yield* referenceClient(binding, url);
          const task = refTaskOf(
            yield* promise(() =>
              client.sendMessage(RefSend.fromJSON({ message: refJson('push') }))
            )
          );
          const taskId = task['id'] as string;
          const created = yield* promise(() =>
            client.createTaskPushNotificationConfig(
              RefPushConfig.fromJSON({
                taskId,
                url: 'http://127.0.0.1:1/hook',
                authentication: { scheme: 'Bearer', credentials: 'secret' },
              })
            )
          );
          assert.ok(created.id.length > 0);
          const fetched = yield* promise(() =>
            client.getTaskPushNotificationConfig(
              RefGetPush.fromJSON({ taskId, id: created.id })
            )
          );
          assert.strictEqual(fetched.authentication?.credentials, 'secret');
          const listed = yield* promise(() =>
            client.listTaskPushNotificationConfig(
              RefListPush.fromJSON({ taskId })
            )
          );
          assert.deepStrictEqual(
            listed.configs.map((config) => config.id),
            [created.id]
          );
          yield* promise(() =>
            client.deleteTaskPushNotificationConfig(
              RefDeletePush.fromJSON({ taskId, id: created.id })
            )
          );
          const afterDelete = yield* Effect.flip(
            promise(() =>
              client.getTaskPushNotificationConfig(
                RefGetPush.fromJSON({ taskId, id: created.id })
              )
            )
          );
          assert.strictEqual(errorName(afterDelete), 'TaskNotFoundError');
          const card = yield* promise(() => client.getAgentCard());
          assert.strictEqual(card.name, 'Echo Agent (extended)');
        })
    );
  }
});

const ourClient = (binding: (typeof BINDINGS)[number], url: string) =>
  ClientFactory.make({ preferredTransports: [binding] }).pipe(
    Effect.flatMap((factory) => factory.createFromUrl(url)),
    Effect.provide(FetchHttpClient.layer)
  );

const message = (text: string, extra: Partial<Message> = {}): Message => ({
  messageId: nextId('ours'),
  role: 'ROLE_USER',
  parts: [{ text }],
  ...extra,
});

const taskOf = (result: SendMessageResult) => {
  assert.ok('status' in result, 'expected a task');
  return result;
};

const kinds = (events: ReadonlyArray<StreamResponse>) =>
  events.map((event) => Object.keys(event)[0]);

layer(Layer.provideMerge(ReferenceHttpServer.layer, FetchHttpClient.layer), {
  excludeTestServices: true,
})('our client against the reference server', (it) => {
  for (const binding of BINDINGS) {
    it.effect(
      `${binding}: sends, streams, gets, lists, cancels and subscribes`,
      () =>
        Effect.gen(function* () {
          const { url } = yield* ReferenceHttpServer;
          const client: Client = yield* ourClient(binding, url);
          assert.strictEqual(client.transport.protocolName, binding);

          const sent = taskOf(
            yield* client.sendMessage({ message: message('hello') })
          );
          assert.strictEqual(sent.status.state, 'TASK_STATE_COMPLETED');
          assert.strictEqual(sent.artifacts?.[0]?.artifactId, 'echo');

          const reply = yield* client.sendMessage({
            message: message('message'),
          });
          assert.ok('messageId' in reply);

          const events = yield* Stream.runCollect(
            client.sendMessageStream({ message: message('stream') })
          );
          assert.deepStrictEqual(kinds(events), [
            'task',
            'statusUpdate',
            'artifactUpdate',
            'statusUpdate',
          ]);

          const fetched = yield* client.getTask({
            id: sent.id,
            historyLength: 1,
          });
          assert.strictEqual(fetched.id, sent.id);
          assert.strictEqual(fetched.history?.length, 1);

          const listed = yield* client.listTasks({ pageSize: 100 });
          assert.ok(listed.tasks.some((task) => task.id === sent.id));

          const waiting = taskOf(
            yield* client.sendMessage({
              message: message('wait'),
              configuration: { returnImmediately: true },
            })
          );
          const canceled = yield* client.cancelTask({ id: waiting.id });
          assert.strictEqual(canceled.status.state, 'TASK_STATE_CANCELED');

          const paused = taskOf(
            yield* client.sendMessage({ message: message('input') })
          );
          assert.strictEqual(paused.status.state, 'TASK_STATE_INPUT_REQUIRED');
          const first = yield* Stream.runHead(
            client.resubscribeTask({ id: paused.id })
          );
          assert.ok(first._tag === 'Some' && 'task' in first.value);

          const missing = yield* Effect.flip(client.getTask({ id: 'nope' }));
          assert.strictEqual(missing._tag, 'TaskNotFoundError');
        })
    );

    it.effect(
      `${binding}: manages push configs and reads the extended card`,
      () =>
        Effect.gen(function* () {
          const { url } = yield* ReferenceHttpServer;
          const client: Client = yield* ourClient(binding, url);
          const task = taskOf(
            yield* client.sendMessage({ message: message('push') })
          );
          const created = yield* client.createTaskPushNotificationConfig({
            taskId: task.id,
            url: 'http://127.0.0.1:1/hook',
            token: 'opaque',
          });
          const configId = created.id ?? '';
          assert.ok(configId.length > 0);
          const fetched = yield* client.getTaskPushNotificationConfig({
            taskId: task.id,
            id: configId,
          });
          assert.strictEqual(fetched.token, 'opaque');
          const listed = yield* client.listTaskPushNotificationConfig({
            taskId: task.id,
          });
          assert.deepStrictEqual(
            listed.configs?.map((config) => config.id),
            [configId]
          );
          yield* client.deleteTaskPushNotificationConfig({
            taskId: task.id,
            id: configId,
          });
          const afterDelete = yield* Effect.flip(
            client.getTaskPushNotificationConfig({
              taskId: task.id,
              id: configId,
            })
          );
          assert.strictEqual(afterDelete._tag, 'TaskNotFoundError');
          const card = yield* client.getAgentCard();
          assert.strictEqual(card.name, 'Reference Echo Agent (extended)');
        })
    );
  }
});
