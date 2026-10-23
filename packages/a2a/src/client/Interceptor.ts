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
  readonly getAgentCard: {
    readonly input: GetExtendedAgentCardRequest;
    readonly result: AgentCard;
  };
  readonly sendMessage: {
    readonly input: SendMessageRequest;
    readonly result: SendMessageResult;
  };
  readonly sendMessageStream: {
    readonly input: SendMessageRequest;
    readonly result: StreamResponse;
  };
  readonly createTaskPushNotificationConfig: {
    readonly input: TaskPushNotificationConfig;
    readonly result: TaskPushNotificationConfig;
  };
  readonly getTaskPushNotificationConfig: {
    readonly input: GetTaskPushNotificationConfigRequest;
    readonly result: TaskPushNotificationConfig;
  };
  readonly listTaskPushNotificationConfig: {
    readonly input: ListTaskPushNotificationConfigsRequest;
    readonly result: ListTaskPushNotificationConfigsResponse;
  };
  readonly deleteTaskPushNotificationConfig: {
    readonly input: DeleteTaskPushNotificationConfigRequest;
    readonly result: void;
  };
  readonly getTask: { readonly input: GetTaskRequest; readonly result: Task };
  readonly cancelTask: {
    readonly input: CancelTaskRequest;
    readonly result: Task;
  };
  readonly listTasks: {
    readonly input: ListTasksRequest;
    readonly result: ListTasksResponse;
  };
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
  readonly input: ClientCallInput;
  readonly agentCard: AgentCard;
  readonly options: CallOptions;
}

/**
 * What an interceptor returns before a call: the input and options to go
 * on with, or a result that answers the call without the transport.
 *
 * @since 0.1.0
 */
export interface BeforeResult {
  readonly input: ClientCallInput;
  readonly options: CallOptions;
  readonly earlyReturn?: ClientCallResult;
}

/**
 * What an interceptor sees after a call, or after each streamed event.
 *
 * @since 0.1.0
 */
export interface AfterArgs {
  readonly result: ClientCallResult;
  readonly agentCard: AgentCard;
  readonly options: CallOptions;
}

/**
 * What an interceptor returns after a call: the result, and whether to stop
 * (the remaining interceptors, and for a stream the remaining events).
 *
 * @since 0.1.0
 */
export interface AfterResult {
  readonly result: ClientCallResult;
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
  readonly before: (
    args: BeforeArgs
  ) => Effect.Effect<BeforeResult, ClientError>;
  readonly after: (args: AfterArgs) => Effect.Effect<AfterResult, ClientError>;
}
