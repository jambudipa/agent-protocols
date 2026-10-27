/**
 * The client transport contract: one implementation for each protocol
 * binding (JSON-RPC, HTTP+JSON, gRPC) and each protocol version.
 *
 * @since 0.1.0
 */
import { Array as Arr, Option } from 'effect';
import type { Effect, Stream } from 'effect';
import type { ClientError } from '../errors/index.js';
import type {
  AgentCard,
  AgentInterface,
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

/**
 * Service parameters of a call: the headers (or gRPC metadata) to send,
 * such as `A2A-Version` and `A2A-Extensions`.
 *
 * @since 0.1.0
 */
export type ServiceParameters = { readonly [name: string]: string };

/**
 * The options of one client call.
 *
 * @since 0.1.0
 */
export interface CallOptions {
  /**
   * Headers to send with the call. A transport's own headers, such as
   * `Content-Type`, win over a parameter of the same name.
   */
  readonly serviceParameters?: ServiceParameters;
}

/**
 * A connection to an agent over one protocol binding.
 *
 * @since 0.1.0
 */
export interface Transport {
  /** The binding name: `JSONRPC`, `HTTP+JSON`, `GRPC` or a custom one. */
  readonly protocolName: string;
  /** The protocol version that the transport speaks, such as `1.0`. */
  readonly protocolVersion: string;
  /** Fetches the authenticated extended card; the caller checks the capability. */
  readonly getExtendedAgentCard: (
    params: GetExtendedAgentCardRequest,
    options?: CallOptions
  ) => Effect.Effect<AgentCard, ClientError>;
  /** Sends a message and returns the task or the direct reply message. */
  readonly sendMessage: (
    params: SendMessageRequest,
    options?: CallOptions
  ) => Effect.Effect<SendMessageResult, ClientError>;
  /** Sends a message and streams the events; needs the streaming capability. */
  readonly sendMessageStream: (
    params: SendMessageRequest,
    options?: CallOptions
  ) => Stream.Stream<StreamResponse, ClientError>;
  /** Fetches a task by id. */
  readonly getTask: (
    params: GetTaskRequest,
    options?: CallOptions
  ) => Effect.Effect<Task, ClientError>;
  /** Asks the agent to cancel a task; returns the task in its new state. */
  readonly cancelTask: (
    params: CancelTaskRequest,
    options?: CallOptions
  ) => Effect.Effect<Task, ClientError>;
  /** Lists tasks, one page at a time. */
  readonly listTasks: (
    params: ListTasksRequest,
    options?: CallOptions
  ) => Effect.Effect<ListTasksResponse, ClientError>;
  /** Registers a push notification config for a task. */
  readonly createTaskPushNotificationConfig: (
    params: TaskPushNotificationConfig,
    options?: CallOptions
  ) => Effect.Effect<TaskPushNotificationConfig, ClientError>;
  /** Fetches one push notification config of a task. */
  readonly getTaskPushNotificationConfig: (
    params: GetTaskPushNotificationConfigRequest,
    options?: CallOptions
  ) => Effect.Effect<TaskPushNotificationConfig, ClientError>;
  /** Lists the push notification configs of a task. */
  readonly listTaskPushNotificationConfig: (
    params: ListTaskPushNotificationConfigsRequest,
    options?: CallOptions
  ) => Effect.Effect<ListTaskPushNotificationConfigsResponse, ClientError>;
  /** Deletes one push notification config of a task. */
  readonly deleteTaskPushNotificationConfig: (
    params: DeleteTaskPushNotificationConfigRequest,
    options?: CallOptions
  ) => Effect.Effect<void, ClientError>;
  /** Streams the events of an existing task again. */
  readonly resubscribeTask: (
    params: SubscribeToTaskRequest,
    options?: CallOptions
  ) => Stream.Stream<StreamResponse, ClientError>;
}

/**
 * Creates the transport of one binding for an agent interface.
 *
 * @since 0.1.0
 */
export interface TransportFactory {
  /** The binding name that the factory serves, matched case-insensitively. */
  readonly protocolName: string;
  /** Creates a transport for the interface at `url` of the card. */
  readonly create: (
    url: string,
    agentCard: AgentCard
  ) => Effect.Effect<Transport, ClientError>;
}

/**
 * The interface of the card that a factory should serve: the interfaces of
 * the binding, those at `url` first, preferring protocol version 1.0.
 *
 * @since 0.1.0
 */
export const pickMatchingInterface = (
  agentCard: AgentCard,
  protocolBinding: string,
  url: string
): Option.Option<AgentInterface> => {
  const target = protocolBinding.toUpperCase();
  const candidates = agentCard.supportedInterfaces.filter(
    (candidate) => candidate.protocolBinding.toUpperCase() === target
  );
  const atUrl = candidates.filter((candidate) => candidate.url === url);
  const pool = atUrl.length > 0 ? atUrl : candidates;
  return Arr.findFirst(
    pool,
    (candidate) => candidate.protocolVersion === '1.0'
  ).pipe(Option.orElse(() => Arr.head(pool)));
};
