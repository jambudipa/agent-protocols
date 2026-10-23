/**
 * Our gRPC transport against the gRPC server of `@a2a-js/sdk` 1.3.0.
 */
import {
  AgentCard as RefAgentCard,
  Message as RefMessage,
  Task as RefTask,
  TaskArtifactUpdateEvent as RefArtifactUpdate,
  TaskStatusUpdateEvent as RefStatusUpdate,
} from '@a2a-js/sdk';
import {
  type AgentExecutor as RefAgentExecutor,
  AgentEvent as RefAgentEvent,
  DefaultExecutionEventBusManager as RefDefaultExecutionEventBusManager,
  DefaultPushNotificationSender as RefDefaultPushNotificationSender,
  DefaultRequestHandler as RefDefaultRequestHandler,
  InMemoryPushNotificationStore as RefInMemoryPushNotificationStore,
  InMemoryTaskStore as RefInMemoryTaskStore,
} from '@a2a-js/sdk/server';
import {
  A2AService as RefA2AService,
  UserBuilder as RefUserBuilder,
  grpcService as refGrpcService,
} from '@a2a-js/sdk/server/grpc';
import * as grpc from '@grpc/grpc-js';
import { assert, layer } from '@effect/vitest';
import {
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  MutableHashMap,
  Option,
  Schema,
  Stream,
} from 'effect';
import { AgentCard, type Message as MessageType } from '../src/index.js';
import type { Transport } from '../src/client/Transport.js';
import { GrpcTransportFactory } from '../src/client/grpc/index.js';
import { echoCard } from './support.js';

const card = (url: string): AgentCard =>
  echoCard('', {
    supportedInterfaces: [
      { url, protocolBinding: 'GRPC', protocolVersion: '1.0' },
    ],
  });

const toReferenceCard = (value: AgentCard) =>
  RefAgentCard.fromJSON(Schema.encodeSync(AgentCard)(value));

const now = () => DateTime.formatIso(DateTime.nowUnsafe());

const textOf = (message: RefMessage): string =>
  message.parts
    .flatMap((part) =>
      part.content?.$case === 'text' ? [part.content.value] : []
    )
    .join('');

/** Executions that wait for a cancel, by task id. */
const waiting = MutableHashMap.empty<string, Deferred.Deferred<void>>();

/** The reference echo agent: the same behaviours as the Effect one. */
const referenceExecutor: RefAgentExecutor = {
  execute: (context, bus) => {
    const text = textOf(context.userMessage);
    const { taskId, contextId } = context;
    if (text === 'message') {
      bus.publish(
        RefAgentEvent.message(
          RefMessage.fromJSON({
            messageId: `reply-${context.userMessage.messageId}`,
            role: 'ROLE_AGENT',
            contextId,
            parts: [{ text: 'hello back' }],
          })
        )
      );
      return Effect.runPromise(Effect.void);
    }
    bus.publish(
      RefAgentEvent.task(
        RefTask.fromJSON({
          id: taskId,
          contextId,
          status: { state: 'TASK_STATE_SUBMITTED', timestamp: now() },
          history: [RefMessage.toJSON(context.userMessage)],
        })
      )
    );
    bus.publish(
      RefAgentEvent.statusUpdate(
        RefStatusUpdate.fromJSON({
          taskId,
          contextId,
          status: { state: 'TASK_STATE_WORKING', timestamp: now() },
        })
      )
    );
    if (text === 'wait') {
      const done = Deferred.makeUnsafe<void>();
      MutableHashMap.set(waiting, taskId, done);
      return Effect.runPromise(Deferred.await(done));
    }
    bus.publish(
      RefAgentEvent.artifactUpdate(
        RefArtifactUpdate.fromJSON({
          taskId,
          contextId,
          artifact: {
            artifactId: 'echo',
            name: 'echo',
            parts: [{ text: `echo: ${text}` }],
          },
        })
      )
    );
    bus.publish(
      RefAgentEvent.statusUpdate(
        RefStatusUpdate.fromJSON({
          taskId,
          contextId,
          status: { state: 'TASK_STATE_COMPLETED', timestamp: now() },
        })
      )
    );
    return Effect.runPromise(Effect.void);
  },
  cancelTask: (taskId, bus) => {
    bus.publish(
      RefAgentEvent.statusUpdate(
        RefStatusUpdate.fromJSON({
          taskId,
          status: { state: 'TASK_STATE_CANCELED', timestamp: now() },
        })
      )
    );
    Option.map(MutableHashMap.get(waiting, taskId), (done) =>
      Deferred.doneUnsafe(done, Exit.void)
    );
    return Effect.runPromise(Effect.void);
  },
};

/** The reference request handler with the reference echo agent. */
const makeReferenceHandler = () => {
  const extended = toReferenceCard({
    ...card('unused'),
    name: 'Reference Agent (extended)',
  });
  const pushStore = new RefInMemoryPushNotificationStore();
  return new RefDefaultRequestHandler(
    toReferenceCard(card('unused')),
    new RefInMemoryTaskStore(),
    referenceExecutor,
    new RefDefaultExecutionEventBusManager(),
    pushStore,
    new RefDefaultPushNotificationSender(pushStore),
    () => Effect.runPromise(Effect.succeed(extended))
  );
};

/** The reference gRPC server and our transport to it. */
class Connection extends Context.Service<
  Connection,
  { readonly transport: Transport }
>()('@jambudipa/a2a/test/grpc-client/Connection') {
  static readonly layer = Layer.effect(
    Connection,
    Effect.gen(function* () {
      const handler = makeReferenceHandler();
      const server = new grpc.Server();
      server.addService(
        RefA2AService,
        refGrpcService({
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
              resume(error ? Effect.die(error) : Effect.succeed(bound))
          );
        }),
        () => Effect.sync(() => server.forceShutdown())
      );
      const factory = yield* GrpcTransportFactory.make();
      const url = `127.0.0.1:${port}`;
      const transport = yield* factory.create(url, card(url));
      return Connection.of({ transport });
    })
  );
}

const message = (text: string, id: string): MessageType => ({
  messageId: id,
  role: 'ROLE_USER',
  parts: [{ text }],
});

layer(Connection.layer, { excludeTestServices: true })(
  'our gRPC transport with the reference server',
  (it) => {
    it.effect('sends a message and returns the completed task', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const result = yield* transport.sendMessage({
          message: message('hello', 'c-1'),
        });
        assert.isTrue('status' in result);
        if ('status' in result) {
          assert.strictEqual(result.status.state, 'TASK_STATE_COMPLETED');
          assert.strictEqual(result.artifacts?.[0]?.artifactId, 'echo');
        }
      })
    );

    it.effect('returns a message for a message-only answer', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const result = yield* transport.sendMessage({
          message: message('message', 'c-2'),
        });
        assert.isTrue('messageId' in result && result.role === 'ROLE_AGENT');
      })
    );

    it.effect('streams the task lifecycle', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const events = yield* Stream.runCollect(
          transport.sendMessageStream({ message: message('hi', 'c-3') })
        );
        assert.deepStrictEqual(
          events.map((event) => Object.keys(event)[0]),
          ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
        );
      })
    );

    it.effect('gets and lists tasks', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const sent = yield* transport.sendMessage({
          message: message('listed', 'c-4'),
        });
        const id = 'id' in sent ? sent.id : '';
        const fetched = yield* transport.getTask({ id, historyLength: 1 });
        assert.strictEqual(fetched.id, id);
        assert.strictEqual(fetched.history?.length, 1);
        const listed = yield* transport.listTasks({ pageSize: 100 });
        assert.isTrue(listed.tasks.some((task) => task.id === id));
        assert.isTrue(listed.totalSize >= 1);
      })
    );

    it.effect('cancels a running task and streams it to a subscriber', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const started = yield* transport.sendMessage({
          message: message('wait', 'c-5'),
          configuration: { returnImmediately: true },
        });
        const id = 'id' in started ? started.id : '';
        const subscriber = yield* Effect.forkChild(
          Stream.runCollect(transport.resubscribeTask({ id }))
        );
        yield* Effect.sleep('200 millis');
        const canceled = yield* transport.cancelTask({ id });
        assert.strictEqual(canceled.status.state, 'TASK_STATE_CANCELED');
        const events = yield* Fiber.join(subscriber);
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
        const { transport } = yield* Connection;
        const sent = yield* transport.sendMessage({
          message: message('push', 'c-6'),
        });
        const taskId = 'id' in sent ? sent.id : '';
        const created = yield* transport.createTaskPushNotificationConfig({
          taskId,
          url: 'http://127.0.0.1:9/hook',
          authentication: { scheme: 'Bearer', credentials: 'secret' },
        });
        const id = created.id ?? '';
        assert.notStrictEqual(id, '');
        const fetched = yield* transport.getTaskPushNotificationConfig({
          taskId,
          id,
        });
        assert.strictEqual(fetched.authentication?.scheme, 'Bearer');
        const listed = yield* transport.listTaskPushNotificationConfig({
          taskId,
        });
        assert.strictEqual(listed.configs?.length, 1);
        yield* transport.deleteTaskPushNotificationConfig({ taskId, id });
        const after = yield* transport.listTaskPushNotificationConfig({
          taskId,
        });
        assert.strictEqual(after.configs?.length ?? 0, 0);
      })
    );

    it.effect('returns the extended agent card', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const extended = yield* transport.getExtendedAgentCard({});
        assert.strictEqual(extended.name, 'Reference Agent (extended)');
      })
    );

    it.effect('decodes NOT_FOUND into TaskNotFoundError', () =>
      Effect.gen(function* () {
        const { transport } = yield* Connection;
        const error = yield* Effect.flip(transport.getTask({ id: 'missing' }));
        assert.strictEqual(error._tag, 'TaskNotFoundError');
      })
    );
  }
);
