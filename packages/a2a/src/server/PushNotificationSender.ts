/**
 * The push notification sender: it POSTs each task event to the webhooks of
 * the task.
 *
 * @since 0.1.0
 */
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  MutableHashMap,
  MutableHashSet,
  Option,
  Schema,
} from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { A2A_CONTENT_TYPE, A2A_PROTOCOL_VERSION } from '../Constants.js';
import {
  StreamResponse,
  type Task,
  type TaskPushNotificationConfig,
} from '../Types.js';
import {
  PushNotificationStore,
  type StoredPushNotificationConfig,
} from './PushNotificationStore.js';
import type { ServerCallContext } from './ServerCallContext.js';

/**
 * Sends the events of tasks to their push notification webhooks. `send`
 * returns at once; delivery runs in the background, in event order for each
 * task. A delivery failure is logged, never retried, and never fails the
 * request that caused it.
 *
 * @since 0.1.0
 */
export class PushNotificationSender extends Context.Service<
  PushNotificationSender,
  {
    readonly send: (
      streamResponse: StreamResponse,
      context: ServerCallContext,
      task: Option.Option<Task>
    ) => Effect.Effect<void>;
  }
>()('@jambudipa/a2a/server/PushNotificationSender') {}

/**
 * A serialized push notification body.
 *
 * @since 0.1.0
 */
export interface SerializedPushNotification {
  readonly body: string;
  readonly contentType: string;
}

/**
 * Serializes an event for the webhooks of one protocol version.
 *
 * @since 0.1.0
 */
export type PushNotificationSerializer = (
  streamResponse: StreamResponse,
  task: Option.Option<Task>
) => Effect.Effect<SerializedPushNotification, Schema.SchemaError>;

const encodeStreamResponse = Schema.encodeEffect(
  Schema.fromJsonString(StreamResponse)
);

/**
 * The v1.0 serializer: the StreamResponse JSON as `application/a2a+json`.
 *
 * @since 0.1.0
 */
export const V1PushNotificationSerializer: PushNotificationSerializer = (
  streamResponse
) =>
  Effect.map(encodeStreamResponse(streamResponse), (body) => ({
    body,
    contentType: A2A_CONTENT_TYPE,
  }));

/**
 * The options of the default sender.
 *
 * @since 0.1.0
 */
export interface DefaultPushNotificationSenderOptions {
  /** The timeout of one delivery. The default is 5 seconds. */
  readonly timeout?: Duration.Input;
  /**
   * The header that carries the `token` of a config without
   * `authentication`. The default is `X-A2A-Notification-Token`.
   */
  readonly tokenHeaderName?: string;
  /**
   * Serializers by wire version. The v1.0 serializer is built in; a config
   * saved under a version without a serializer gets the v1.0 body.
   */
  readonly serializers?: {
    readonly [version: string]: PushNotificationSerializer;
  };
}

/**
 * The headers that authenticate a delivery: `Authorization: <scheme>
 * <credentials>` when the config has both, else the token header when the
 * config has a token.
 *
 * @since 0.1.0
 */
export const authHeaders = (
  config: TaskPushNotificationConfig,
  tokenHeaderName: string
): Record<string, string> => {
  const scheme = config.authentication?.scheme ?? '';
  const credentials = config.authentication?.credentials ?? '';
  if (scheme !== '' && credentials !== '') {
    return { Authorization: `${scheme} ${credentials}` };
  }
  if (config.token !== undefined && config.token !== '') {
    return { [tokenHeaderName]: config.token };
  }
  return {};
};

const taskIdOf = (response: StreamResponse): string =>
  'task' in response
    ? response.task.id
    : 'message' in response
      ? (response.message.taskId ?? '')
      : 'statusUpdate' in response
        ? response.statusUpdate.taskId
        : response.artifactUpdate.taskId;

const makeDefaultPushNotificationSender = (
  options: DefaultPushNotificationSenderOptions = {}
) =>
  Effect.gen(function* () {
    const store = yield* PushNotificationStore;
    const client = yield* HttpClient.HttpClient;
    const fibers = yield* FiberSet.make();
    const timeout = Duration.fromInputUnsafe(options.timeout ?? '5 seconds');
    const tokenHeaderName =
      options.tokenHeaderName ?? 'X-A2A-Notification-Token';
    const serializers: {
      readonly [version: string]: PushNotificationSerializer;
    } = {
      [A2A_PROTOCOL_VERSION]: V1PushNotificationSerializer,
      ...options.serializers,
    };
    const fallback =
      serializers[A2A_PROTOCOL_VERSION] ?? V1PushNotificationSerializer;
    const warned = MutableHashSet.empty<string>();
    const tails = MutableHashMap.empty<string, Deferred.Deferred<void>>();

    const serializerFor = (wireVersion: string) =>
      Effect.suspend(() => {
        const serializer = serializers[wireVersion];
        if (serializer !== undefined) return Effect.succeed(serializer);
        if (MutableHashSet.has(warned, wireVersion)) {
          return Effect.succeed(fallback);
        }
        MutableHashSet.add(warned, wireVersion);
        return Effect.as(
          Effect.logWarning(
            `No push notification serializer registered for wire version '${wireVersion}'; falling back to '${A2A_PROTOCOL_VERSION}'.`
          ),
          fallback
        );
      });

    const dispatch = (
      streamResponse: StreamResponse,
      stored: StoredPushNotificationConfig,
      taskId: string,
      task: Option.Option<Task>
    ) =>
      Effect.gen(function* () {
        const serializer = yield* serializerFor(stored.wireVersion);
        const { body, contentType } = yield* serializer(streamResponse, task);
        const request = HttpClientRequest.post(stored.config.url).pipe(
          HttpClientRequest.setHeaders(
            authHeaders(stored.config, tokenHeaderName)
          ),
          HttpClientRequest.bodyText(body, contentType)
        );
        yield* client
          .execute(request)
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.timeout(timeout)
          );
        yield* Effect.logInfo(
          `Push notification sent for task_id=${taskId} to URL: ${stored.config.url}`
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(
            `Error sending push notification for task_id=${taskId} to URL: ${stored.config.url}`,
            cause
          )
        )
      );

    const deliver = (
      streamResponse: StreamResponse,
      context: ServerCallContext,
      taskId: string,
      task: Option.Option<Task>
    ) =>
      Effect.gen(function* () {
        const configs = yield* store.loadWithMetadata(taskId, context);
        yield* Effect.forEach(
          configs,
          (stored) => dispatch(streamResponse, stored, taskId, task),
          { concurrency: 'unbounded', discard: true }
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(
            `Error loading push notification configs for task_id=${taskId}`,
            cause
          )
        )
      );

    return PushNotificationSender.of({
      send: (streamResponse, context, task) =>
        Effect.gen(function* () {
          const taskId = taskIdOf(streamResponse);
          if (taskId === '') return;
          // The tail is swapped before the fork, so deliveries of one task
          // start in the order of the `send` calls.
          const done = yield* Deferred.make<void>();
          const previous = MutableHashMap.get(tails, taskId);
          MutableHashMap.set(tails, taskId, done);
          yield* FiberSet.run(
            fibers,
            Effect.gen(function* () {
              if (Option.isSome(previous)) {
                yield* Deferred.await(previous.value);
              }
              yield* deliver(streamResponse, context, taskId, task);
            }).pipe(
              Effect.ensuring(
                Effect.suspend(() => {
                  const tail = MutableHashMap.get(tails, taskId);
                  if (Option.isSome(tail) && tail.value === done) {
                    MutableHashMap.remove(tails, taskId);
                  }
                  return Deferred.done(done, Exit.void);
                })
              )
            )
          );
        }),
    });
  });

/**
 * The default sender of the reference SDK, on the Effect `HttpClient`: a POST
 * of the StreamResponse JSON with a 5 second timeout, authenticated by the
 * config.
 *
 * @since 0.1.0
 */
export const DefaultPushNotificationSender = {
  make: makeDefaultPushNotificationSender,
  layer: (
    options: DefaultPushNotificationSenderOptions = {}
  ): Layer.Layer<
    PushNotificationSender,
    never,
    PushNotificationStore | HttpClient.HttpClient
  > =>
    Layer.effect(
      PushNotificationSender,
      makeDefaultPushNotificationSender(options)
    ),
};
