/**
 * Call interceptors: code that runs before and after each client call, for
 * example to add headers or to answer a call from a cache.
 *
 * @since 0.1.0
 */
import type { Effect } from 'effect';
import type { ClientError } from '../errors/index.js';
import type {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResult,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '../Types.js';
import type { CallOptions } from './Transport.js';

/**
 * The input and the result of each client method. A streaming method's
 * result is one event of the stream.
 *
 * @since 0.1.0
 */
export interface ClientMethodTypes {
  /** The extended card call that `Client.getAgentCard` makes. */
  readonly getAgentCard: {
    readonly input: GetExtendedAgentCardRequest;
    readonly result: AgentCard;
  };
  /** A blocking or polling message send. */
  readonly sendMessage: {
    readonly input: SendMessageRequest;
    readonly result: SendMessageResult;
  };
  /** A streaming message send; the result is one stream event. */
  readonly sendMessageStream: {
    readonly input: SendMessageRequest;
    readonly result: StreamResponse;
  };
  /** The registration of a push notification config. */
  readonly createTaskPushNotificationConfig: {
    readonly input: TaskPushNotificationConfig;
    readonly result: TaskPushNotificationConfig;
  };
  /** The fetch of one push notification config. */
  readonly getTaskPushNotificationConfig: {
    readonly input: GetTaskPushNotificationConfigRequest;
    readonly result: TaskPushNotificationConfig;
  };
  /** The listing of the push notification configs of a task. */
  readonly listTaskPushNotificationConfig: {
    readonly input: ListTaskPushNotificationConfigsRequest;
    readonly result: ListTaskPushNotificationConfigsResponse;
  };
  /** The deletion of a push notification config; its result is `void`. */
  readonly deleteTaskPushNotificationConfig: {
    readonly input: DeleteTaskPushNotificationConfigRequest;
    readonly result: void;
  };
  /** The fetch of a task by id. */
  readonly getTask: { readonly input: GetTaskRequest; readonly result: Task };
  /** The cancellation of a task. */
  readonly cancelTask: {
    readonly input: CancelTaskRequest;
    readonly result: Task;
  };
  /** The listing of tasks. */
  readonly listTasks: {
    readonly input: ListTasksRequest;
    readonly result: ListTasksResponse;
  };
  /** A resubscription to a task; the result is one stream event. */
  readonly resubscribeTask: {
    readonly input: SubscribeToTaskRequest;
    readonly result: StreamResponse;
  };
}

/**
 * A client method name.
 *
 * @since 0.1.0
 */
export type ClientMethod = keyof ClientMethodTypes;

/**
 * The input of a call, tagged by method.
 *
 * @since 0.1.0
 */
export type ClientCallInput<M extends ClientMethod = ClientMethod> = {
  readonly [K in M]: {
    readonly method: K;
    readonly value: ClientMethodTypes[K]['input'];
  };
}[M];

/**
 * The result of a call, tagged by method.
 *
 * @since 0.1.0
 */
export type ClientCallResult<M extends ClientMethod = ClientMethod> = {
  readonly [K in M]: {
    readonly method: K;
    readonly value: ClientMethodTypes[K]['result'];
  };
}[M];

/**
 * What an interceptor sees before a call.
 *
 * @since 0.1.0
 */
export interface BeforeArgs {
  /** The call input, as changed by the interceptors that ran before. */
  readonly input: ClientCallInput;
  /** The client's current card, read once at the start of the call. */
  readonly agentCard: AgentCard;
  /**
   * The call options, with `A2A-Version` and the extensions header already
   * normalized for the transport's protocol version.
   */
  readonly options: CallOptions;
}

/**
 * What an interceptor returns before a call: the input and options to go
 * on with, or a result that answers the call without the transport.
 *
 * @since 0.1.0
 */
export interface BeforeResult {
  /** The input to go on with; it must keep the method of the call. */
  readonly input: ClientCallInput;
  /**
   * The options to go on with. They replace the options in full and are not
   * normalized again.
   */
  readonly options: CallOptions;
  /**
   * A result that answers the call. The transport and the later `before`
   * hooks are skipped; only the interceptors that ran get `after`.
   */
  readonly earlyReturn?: ClientCallResult;
}

/**
 * What an interceptor sees after a call, or after each streamed event.
 *
 * @since 0.1.0
 */
export interface AfterArgs {
  /** The result, as changed by the interceptors that ran before. */
  readonly result: ClientCallResult;
  /** The card that the `before` hooks saw. */
  readonly agentCard: AgentCard;
  /** The options that the call was sent with. */
  readonly options: CallOptions;
}

/**
 * What an interceptor returns after a call: the result, and whether to stop
 * (the remaining interceptors, and for a stream the remaining events).
 *
 * @since 0.1.0
 */
export interface AfterResult {
  /** The result to go on with; it must keep the method of the call. */
  readonly result: ClientCallResult;
  /**
   * `true` skips the remaining `after` hooks. On a stream, it also ends the
   * stream after this event.
   */
  readonly earlyReturn?: boolean;
}

/**
 * An interceptor of client calls. `before` runs in order, `after` in
 * reverse order. An interceptor must keep the method of the input and the
 * result it returns.
 *
 * @since 0.1.0
 */
export interface CallInterceptor {
  /** Runs before the transport call, in the order of the interceptors. */
  readonly before: (
    args: BeforeArgs
  ) => Effect.Effect<BeforeResult, ClientError>;
  /**
   * Runs after the call in reverse order; on a stream, once for each event.
   */
  readonly after: (args: AfterArgs) => Effect.Effect<AfterResult, ClientError>;
}
