/**
 * Test support: an echo agent, its Agent Card and a real A2A server on an
 * ephemeral port, with the raw `HttpClient` pointed at it.
 */
import { NodeCrypto, NodeHttpServer } from '@effect/platform-node';
import { DateTime, Effect, Layer, Option } from 'effect';
import { FetchHttpClient, HttpRouter, HttpServer } from 'effect/http';
import type { AgentCard, Message, Part } from '../src/index.js';
import {
  A2AHttpRoutes,
  AgentEvent,
  AgentExecutionError,
  AgentExecutor,
  DefaultRequestHandler,
  ServerCallContext,
  type DefaultRequestHandlerOptions,
  InMemoryTaskStore,
  type A2AHttpRoutesOptions,
} from '../src/server/index.js';

/** The extension that the echo card declares and the echo agent activates. */
export const TEST_EXTENSION = 'urn:a2a:test-extension';

/** The current time as an RFC 3339 timestamp. */
export const now = Effect.map(DateTime.now, DateTime.formatIso);

/** The text of the first text part of a message. */
export const textOf = (message: Message): string =>
  message.parts
    .flatMap((part: Part) => ('text' in part ? [part.text] : []))
    .join('');

/**
 * An agent whose behaviour follows the message text:
 * - `message`: answers with a message;
 * - `fail`: fails before any event;
 * - `fail-late`: publishes a working task, then fails;
 * - `input`: stops in INPUT_REQUIRED;
 * - `auth`: stops in AUTH_REQUIRED, then completes;
 * - `wait`: works until canceled;
 * - `bad-order`: publishes a second task event, which breaks the stream;
 * - `extension`: activates {@link TEST_EXTENSION}, then completes;
 * - anything else: a task that works, adds an artifact and completes.
 */
export const EchoExecutor = Layer.succeed(
  AgentExecutor,
  AgentExecutor.of({
    execute: (context, bus) =>
      Effect.gen(function* () {
        const timestamp = yield* now;
        const text = textOf(context.userMessage);
        const { taskId, contextId } = context;
        const status = (
          state:
            | 'TASK_STATE_WORKING'
            | 'TASK_STATE_COMPLETED'
            | 'TASK_STATE_INPUT_REQUIRED'
            | 'TASK_STATE_AUTH_REQUIRED'
            | 'TASK_STATE_CANCELED',
          reply?: string
        ) =>
          bus.publish(
            AgentEvent.statusUpdate({
              taskId,
              contextId,
              status: {
                state,
                timestamp,
                ...(reply === undefined
                  ? {}
                  : {
                      message: {
                        messageId: `${taskId}-${state}`,
                        role: 'ROLE_AGENT',
                        taskId,
                        contextId,
                        parts: [{ text: reply }],
                      },
                    }),
              },
            })
          );
        if (text === 'message') {
          return yield* bus.publish(
            AgentEvent.message({
              messageId: `reply-${context.userMessage.messageId}`,
              role: 'ROLE_AGENT',
              contextId,
              parts: [{ text: 'hello back' }],
            })
          );
        }
        if (text === 'fail') {
          return yield* new AgentExecutionError({ message: 'boom' });
        }
        if (Option.isNone(context.task)) {
          yield* bus.publish(
            AgentEvent.task({
              id: taskId,
              contextId,
              status: {
                state: 'TASK_STATE_SUBMITTED',
                timestamp,
              },
              history: [context.userMessage],
            })
          );
        }
        yield* status('TASK_STATE_WORKING');
        if (text === 'fail-late') {
          return yield* new AgentExecutionError({ message: 'late boom' });
        }
        if (text === 'input')
          return yield* status('TASK_STATE_INPUT_REQUIRED', 'more?');
        if (text === 'auth') {
          yield* status('TASK_STATE_AUTH_REQUIRED', 'log in');
          yield* Effect.sleep('50 millis');
          return yield* status('TASK_STATE_COMPLETED', 'done after auth');
        }
        if (text === 'wait') return yield* Effect.never;
        if (text === 'bad-order') {
          return yield* bus.publish(
            AgentEvent.task({
              id: taskId,
              contextId,
              status: { state: 'TASK_STATE_WORKING', timestamp },
            })
          );
        }
        if (text === 'extension') {
          yield* ServerCallContext.activateExtension(
            context.context,
            TEST_EXTENSION
          );
        }
        yield* bus.publish(
          AgentEvent.artifactUpdate({
            taskId,
            contextId,
            artifact: {
              artifactId: 'echo',
              name: 'echo',
              parts: [{ text: `echo: ${text}` }],
            },
          })
        );
        yield* status('TASK_STATE_COMPLETED', `done: ${text}`);
      }),
    cancelTask: (taskId, bus) =>
      Effect.flatMap(now, (timestamp) =>
        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId: '',
            status: { state: 'TASK_STATE_CANCELED', timestamp },
          })
        )
      ),
  })
);

/** The card of the echo agent, served at `baseUrl`. */
export const echoCard = (
  baseUrl: string,
  overrides: Partial<AgentCard> = {}
): AgentCard => ({
  name: 'Echo Agent',
  description: 'Echoes messages.',
  version: '1.0.0',
  supportedInterfaces: [
    { url: `${baseUrl}/`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    {
      url: `${baseUrl}/`,
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
    },
  ],
  capabilities: {
    streaming: true,
    pushNotifications: true,
    extendedAgentCard: true,
    extensions: [{ uri: TEST_EXTENSION, description: 'A test extension.' }],
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    { id: 'echo', name: 'Echo', description: 'Echoes.', tags: ['echo'] },
  ],
  ...overrides,
});

/** The base URL of the test server. */
export const serverUrl = Effect.map(HttpServer.HttpServer, (server) =>
  server.address._tag === 'UnixPathAddress'
    ? ''
    : `http://127.0.0.1:${server.address.port}`
);

/**
 * A real A2A server with the echo agent, and the raw `HttpClient` with the
 * server URL prepended.
 */
export const testServer = (
  options: {
    readonly card?: (baseUrl: string) => AgentCard;
    readonly handler?: Omit<DefaultRequestHandlerOptions, 'agentCard'>;
    readonly routes?: A2AHttpRoutesOptions;
  } = {}
) => {
  const handler = Layer.unwrap(
    Effect.map(serverUrl, (baseUrl) =>
      DefaultRequestHandler.layer({
        ...options.handler,
        agentCard: (options.card ?? echoCard)(baseUrl),
      })
    )
  );
  return HttpRouter.serve(A2AHttpRoutes.layer(options.routes), {
    disableLogger: true,
  }).pipe(
    // The push sender needs a client without the test URL prefix.
    Layer.provide(Layer.provide(handler, FetchHttpClient.layer)),
    Layer.provide(Layer.fresh(InMemoryTaskStore.layer)),
    Layer.provide(EchoExecutor),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeCrypto.layer)
  );
};
