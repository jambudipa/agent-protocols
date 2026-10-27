/**
 * The push notification store: the webhooks of each task, scoped by tenant
 * and owner.
 *
 * @since 0.1.0
 */
import {
  Context,
  Crypto,
  Effect,
  Layer,
  MutableHashMap,
  Option,
  Schema,
} from 'effect';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../Constants.js';
import type { TaskPushNotificationConfig } from '../Types.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type ServerCallContext,
} from './ServerCallContext.js';

/**
 * A push notification store failed to read or write.
 *
 * @since 0.1.0
 */
export class PushNotificationStoreError extends Schema.TaggedError<PushNotificationStoreError>()(
  'PushNotificationStoreError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * A stored push notification config with the protocol version of the call
 * that saved it. The sender serializes notifications for that version.
 *
 * @since 0.1.0
 */
export interface StoredPushNotificationConfig {
  /** The config, with its `id` set. */
  readonly config: TaskPushNotificationConfig;
  /**
   * The `A2A-Version` of the call that saved the config; see
   * {@link wireVersionOf}.
   */
  readonly wireVersion: string;
}

/**
 * Keeps the push notification configs of tasks.
 *
 * @since 0.1.0
 */
export class PushNotificationStore extends Context.Service<
  PushNotificationStore,
  {
    /**
     * Saves a config. A config without an `id` gets a new UUID; a config with
     * the id of a stored one replaces it. Returns the config as stored.
     */
    readonly save: (
      taskId: string,
      context: ServerCallContext,
      config: TaskPushNotificationConfig
    ) => Effect.Effect<TaskPushNotificationConfig, PushNotificationStoreError>;
    /** Loads the configs of a task, in save order. */
    readonly load: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<
      ReadonlyArray<TaskPushNotificationConfig>,
      PushNotificationStoreError
    >;
    /** Loads the configs of a task with the wire version of each. */
    readonly loadWithMetadata: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<
      ReadonlyArray<StoredPushNotificationConfig>,
      PushNotificationStoreError
    >;
    /** Deletes a config. Deleting a missing config succeeds. */
    readonly delete: (
      taskId: string,
      context: ServerCallContext,
      configId: string
    ) => Effect.Effect<void, PushNotificationStoreError>;
  }
>()('@jambudipa/a2a/server/PushNotificationStore') {}

/**
 * The wire version under which a call saves a config.
 *
 * @since 0.1.0
 */
export const wireVersionOf = (context: ServerCallContext): string =>
  context.requestedVersion === ''
    ? A2A_LEGACY_PROTOCOL_VERSION
    : context.requestedVersion;

/**
 * Builds the in-memory store. Records are keyed by tenant, owner and
 * task, so a caller cannot see the configs of another scope. The
 * records live as long as the store value and are lost on restart.
 */
const makeInMemoryPushNotificationStore = Effect.gen(function* () {
  const ownerResolver = yield* CurrentOwnerResolver;
  const crypto = yield* Crypto.Crypto;
  const entries = MutableHashMap.empty<
    string,
    ReadonlyArray<StoredPushNotificationConfig>
  >();
  const entryKey = (taskId: string, context: ServerCallContext) => {
    const { tenant, owner } = callerScope(context, ownerResolver);
    return `${tenant}\u0000${owner}\u0000${taskId}`;
  };
  const get = (key: string) =>
    Option.getOrElse(MutableHashMap.get(entries, key), () => []);
  return PushNotificationStore.of({
    save: (taskId, context, config) =>
      Effect.gen(function* () {
        const stored =
          config.id !== undefined && config.id !== ''
            ? config
            : { ...config, id: yield* crypto.randomUUIDv4() };
        const key = entryKey(taskId, context);
        MutableHashMap.set(entries, key, [
          ...get(key).filter((entry) => entry.config.id !== stored.id),
          { config: stored, wireVersion: wireVersionOf(context) },
        ]);
        return stored;
      }).pipe(
        Effect.catchTag('PlatformError', (cause) =>
          Effect.fail(
            new PushNotificationStoreError({
              message: 'Cannot generate a config id.',
              cause,
            })
          )
        )
      ),
    load: (taskId, context) =>
      Effect.sync(() =>
        get(entryKey(taskId, context)).map((entry) => entry.config)
      ),
    loadWithMetadata: (taskId, context) =>
      Effect.sync(() => get(entryKey(taskId, context))),
    delete: (taskId, context, configId) =>
      Effect.sync(() => {
        const key = entryKey(taskId, context);
        const remaining = get(key).filter(
          (entry) => entry.config.id !== configId
        );
        if (remaining.length === 0) {
          MutableHashMap.remove(entries, key);
        } else {
          MutableHashMap.set(entries, key, remaining);
        }
      }),
  });
});

/**
 * A push notification store in memory, with the semantics of the reference
 * `InMemoryPushNotificationStore`.
 *
 * @since 0.1.0
 */
export const InMemoryPushNotificationStore = {
  /** Builds an empty in-memory store. */
  make: makeInMemoryPushNotificationStore,
  /** A layer of an empty in-memory store. */
  layer: Layer.effect(PushNotificationStore, makeInMemoryPushNotificationStore),
};
