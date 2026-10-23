/**
 * The reference side of the interop tests: an echo agent written against
 * `@a2a-js/sdk` 1.3.0, its request handler, and its Express server with the
 * JSON-RPC, HTTP+JSON and Agent Card routes.
 *
 * The reference SDK speaks Promises; each Promise here comes from
 * `Effect.runPromise` at this test boundary.
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
  UserBuilder as RefUserBuilder,
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
} from '@a2a-js/sdk/server/express';
import express from 'express';
import type { Server } from 'node:http';
import {
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Layer,
  MutableHashMap,
  Option,
  Predicate,
  Schema,
} from 'effect';
import { AgentCard } from '../src/index.js';
import { echoCard } from './support.js';

/** A v1.0 card in the reference SDK's form. */
export const toReferenceCard = (value: AgentCard) =>
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

const status = (
  taskId: string,
  contextId: string,
  state: string,
  text?: string
) =>
  RefAgentEvent.statusUpdate(
    RefStatusUpdate.fromJSON({
      taskId,
      contextId,
      status: {
        state,
        timestamp: now(),
        ...(text === undefined
          ? {}
          : {
              message: {
                messageId: `${taskId}-${state}`,
                role: 'ROLE_AGENT',
                taskId,
                contextId,
                parts: [{ text }],
              },
            }),
      },
    })
  );

/**
 * The reference echo agent, with the behaviours of the Effect one:
 * `message` answers with a message, `input` stops in INPUT_REQUIRED, `wait`
 * waits for a cancel, and anything else completes with one artifact.
 */
export const referenceExecutor: RefAgentExecutor = {
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
    if (context.task === undefined) {
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
    }
    bus.publish(status(taskId, contextId, 'TASK_STATE_WORKING'));
    if (text === 'input') {
      bus.publish(
        status(taskId, contextId, 'TASK_STATE_INPUT_REQUIRED', 'more?')
      );
      return Effect.runPromise(Effect.void);
    }
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
      status(taskId, contextId, 'TASK_STATE_COMPLETED', `done: ${text}`)
    );
    return Effect.runPromise(Effect.void);
  },
  cancelTask: (taskId, bus) => {
    bus.publish(status(taskId, '', 'TASK_STATE_CANCELED'));
    Option.map(MutableHashMap.get(waiting, taskId), (done) =>
      Deferred.doneUnsafe(done, Exit.void)
    );
    return Effect.runPromise(Effect.void);
  },
};

/** The reference request handler for a card, with push and an extended card. */
export const makeReferenceHandler = (card: AgentCard) => {
  const extended = toReferenceCard({
    ...card,
    name: `${card.name} (extended)`,
  });
  const pushStore = new RefInMemoryPushNotificationStore();
  return new RefDefaultRequestHandler(
    toReferenceCard(card),
    new RefInMemoryTaskStore(),
    referenceExecutor,
    new RefDefaultExecutionEventBusManager(),
    pushStore,
    new RefDefaultPushNotificationSender(pushStore),
    () => Effect.runPromise(Effect.succeed(extended))
  );
};

/** The paths of the reference HTTP server. */
export const REFERENCE_JSONRPC_PATH = '/a2a/jsonrpc';
export const REFERENCE_REST_PATH = '/a2a/rest';

/** The card of the reference HTTP server at `baseUrl`. */
export const referenceCard = (baseUrl: string): AgentCard =>
  echoCard(baseUrl, {
    name: 'Reference Echo Agent',
    supportedInterfaces: [
      {
        url: `${baseUrl}${REFERENCE_JSONRPC_PATH}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
      {
        url: `${baseUrl}${REFERENCE_REST_PATH}`,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      },
    ],
  });

/** The reference Express server on an ephemeral port. */
export class ReferenceHttpServer extends Context.Service<
  ReferenceHttpServer,
  { readonly url: string }
>()('@jambudipa/a2a/test/ReferenceHttpServer') {
  static readonly layer = Layer.effect(
    ReferenceHttpServer,
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
      const handler = makeReferenceHandler(referenceCard(url));
      app.use(
        '/.well-known/agent-card.json',
        agentCardHandler({ agentCardProvider: handler })
      );
      app.use(
        REFERENCE_JSONRPC_PATH,
        jsonRpcHandler({
          requestHandler: handler,
          userBuilder: RefUserBuilder.noAuthentication,
        })
      );
      app.use(
        REFERENCE_REST_PATH,
        restHandler({
          requestHandler: handler,
          userBuilder: RefUserBuilder.noAuthentication,
        })
      );
      return ReferenceHttpServer.of({ url });
    })
  );
}
