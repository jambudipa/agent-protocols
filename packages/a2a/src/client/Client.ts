/**
 * The A2A client: the operations of one agent over the transport that the
 * client factory selected, with call interceptors and client configuration.
 *
 * @since 0.1.0
 */
import { Effect, Option, Ref, Stream } from 'effect';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../Constants.js';
import {
  A2ATransportError,
  type ClientError,
  PushNotificationNotSupportedError,
} from '../errors/index.js';
import { isLegacyVersion } from '../internal/version.js';
import type {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
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
import type {
  AfterArgs,
  BeforeArgs,
  CallInterceptor,
  ClientCallResult,
  ClientMethod,
  ClientMethodTypes,
} from './Interceptor.js';
import type { CallOptions, ServiceParameters, Transport } from './Transport.js';

/**
 * The header of the extensions in protocol 0.3.
 *
 * @since 0.1.0
 */
export const LEGACY_HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

/**
 * The configuration of a client.
 *
 * @since 0.1.0
 */
export interface ClientConfig {
  /**
   * Sends messages with `returnImmediately`, so `sendMessage` returns the
   * task at once and the caller polls it. The default is `false`.
   */
  readonly polling?: boolean;
  /** The default `acceptedOutputModes` of a message. */
  readonly acceptedOutputModes?: ReadonlyArray<string>;
  /** The default push notification config of a message. */
  readonly pushNotificationConfig?: TaskPushNotificationConfig;
  /** The interceptors of every call. */
  readonly interceptors?: ReadonlyArray<CallInterceptor>;
}

/**
 * The client of one agent.
 *
 * @since 0.1.0
 */
export interface Client {
  /**
   * The transport that the factory selected, tenant decorator included. A
   * call made on it directly skips the interceptors, the header
   * normalization and the client configuration.
   */
  readonly transport: Transport;
  /** The protocol version sent in `A2A-Version` with every call. */
  readonly protocolVersion: string;
  /** The Agent Card that the client works from. */
  readonly agentCard: Effect.Effect<AgentCard>;
  /**
   * Fetches the extended card when the card advertises one, verifies the
   * card when a verifier is given, and keeps it as the client's card.
   */
  readonly getAgentCard: <E = never, R = never>(
    options?: CallOptions,
    verifySignature?: (card: AgentCard) => Effect.Effect<void, E, R>
  ) => Effect.Effect<AgentCard, ClientError | E, R>;
  /** Sends a message; blocking unless the client is configured to poll. */
  readonly sendMessage: (
    params: SendMessageRequest,
    options?: CallOptions
  ) => Effect.Effect<SendMessageResult, ClientError>;
  /**
   * Sends a message and streams the task updates. Without the streaming
   * capability, it sends a blocking message and streams its one result.
   */
  readonly sendMessageStream: (
    params: SendMessageRequest,
    options?: CallOptions
  ) => Stream.Stream<StreamResponse, ClientError>;
  /**
   * Registers a push notification config. Fails with
   * `PushNotificationNotSupportedError` when the card lacks the capability.
   */
  readonly createTaskPushNotificationConfig: (
    params: TaskPushNotificationConfig,
    options?: CallOptions
  ) => Effect.Effect<TaskPushNotificationConfig, ClientError>;
  /**
   * Fetches a push notification config. Fails with
   * `PushNotificationNotSupportedError` when the card lacks the capability.
   */
  readonly getTaskPushNotificationConfig: (
    params: GetTaskPushNotificationConfigRequest,
    options?: CallOptions
  ) => Effect.Effect<TaskPushNotificationConfig, ClientError>;
  /**
   * Lists the push notification configs of a task. Fails with
   * `PushNotificationNotSupportedError` when the card lacks the capability.
   */
  readonly listTaskPushNotificationConfig: (
    params: ListTaskPushNotificationConfigsRequest,
    options?: CallOptions
  ) => Effect.Effect<ListTaskPushNotificationConfigsResponse, ClientError>;
  /**
   * Deletes a push notification config. Unlike the other push calls, it does
   * not check the push capability of the card first.
   */
  readonly deleteTaskPushNotificationConfig: (
    params: DeleteTaskPushNotificationConfigRequest,
    options?: CallOptions
  ) => Effect.Effect<void, ClientError>;
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
  /** Streams the updates of a task again, after a lost connection. */
  readonly resubscribeTask: (
    params: SubscribeToTaskRequest,
    options?: CallOptions
  ) => Stream.Stream<StreamResponse, ClientError>;
}

/** The input type of a client method, for the typed call pipeline. */
type Input<M extends ClientMethod> = ClientMethodTypes[M]['input'];
/** The result type of a client method; one event for a streaming method. */
type Output<M extends ClientMethod> = ClientMethodTypes[M]['result'];

/**
 * Sets `A2A-Version` to the transport's version and spells the extensions
 * header as that version does, whatever case or spelling the caller used.
 */
const normalizeHeaders = (
  options: CallOptions | undefined,
  protocolVersion: string
): CallOptions => {
  const legacy = isLegacyVersion(protocolVersion);
  const canonical = legacy
    ? LEGACY_HTTP_EXTENSION_HEADER
    : HTTP_EXTENSION_HEADER;
  const alias = legacy ? HTTP_EXTENSION_HEADER : LEGACY_HTTP_EXTENSION_HEADER;
  const entries = Object.entries(options?.serviceParameters ?? {});
  const pick = (name: string) => {
    const lower = name.toLowerCase();
    const matches = entries.filter(([key]) => key.toLowerCase() === lower);
    return Option.orElse(
      Option.fromUndefinedOr(matches.find(([key]) => key === name)),
      () => Option.fromUndefinedOr(matches.at(-1))
    ).pipe(Option.map(([, value]) => value));
  };
  const extensions = Option.orElse(pick(canonical), () => pick(alias));
  const rest = entries.filter(([key]) => {
    const lower = key.toLowerCase();
    return (
      lower !== canonical.toLowerCase() &&
      lower !== alias.toLowerCase() &&
      lower !== A2A_VERSION_HEADER.toLowerCase()
    );
  });
  const serviceParameters: ServiceParameters = {
    ...Object.fromEntries(rest),
    [A2A_VERSION_HEADER]: protocolVersion,
    ...(Option.isSome(extensions) ? { [canonical]: extensions.value } : {}),
  };
  return { ...options, serviceParameters };
};

/**
 * The error when an interceptor returns an input or a result of another
 * method than the call, which would break the typed result.
 */
const mismatch = (method: string) =>
  new A2ATransportError({
    message: `An interceptor changed the method of a ${method} call.`,
    protocol: 'client',
  });

/**
 * Builds a client over a transport.
 *
 * @since 0.1.0
 */
export const makeClient = (
  transport: Transport,
  initialCard: AgentCard,
  config: ClientConfig = {}
): Effect.Effect<Client> =>
  Effect.gen(function* () {
    const cardRef = yield* Ref.make(initialCard);
    const interceptors = config.interceptors ?? [];

    const runBefore = (args: BeforeArgs) =>
      Effect.gen(function* () {
        let current = args;
        let executed: ReadonlyArray<CallInterceptor> = [];
        for (const interceptor of interceptors) {
          const result = yield* interceptor.before(current);
          executed = [...executed, interceptor];
          current = {
            ...current,
            input: result.input,
            options: result.options,
          };
          if (result.earlyReturn !== undefined) {
            return {
              args: current,
              early: Option.some({ value: result.earlyReturn, executed }),
            };
          }
        }
        return {
          args: current,
          early: Option.none<{
            readonly value: ClientCallResult;
            readonly executed: ReadonlyArray<CallInterceptor>;
          }>(),
        };
      });

    const runAfter = (
      args: AfterArgs,
      chain: ReadonlyArray<CallInterceptor> = interceptors
    ) =>
      Effect.gen(function* () {
        let current = args;
        for (const interceptor of [...chain].reverse()) {
          const result = yield* interceptor.after(current);
          current = { ...current, result: result.result };
          if (result.earlyReturn === true) {
            return { result: current.result, earlyReturn: true };
          }
        }
        return { result: current.result, earlyReturn: false };
      });

    const outputOf = <M extends ClientMethod>(
      method: M,
      result: ClientCallResult
    ): Effect.Effect<Output<M>, ClientError> =>
      result.method === method
        ? Effect.succeed(result.value as Output<M>)
        : Effect.fail(mismatch(method));

    const execute = <M extends ClientMethod>(
      method: M,
      value: Input<M>,
      options: CallOptions | undefined,
      call: (
        value: Input<M>,
        options: CallOptions
      ) => Effect.Effect<Output<M>, ClientError>
    ): Effect.Effect<Output<M>, ClientError> =>
      Effect.gen(function* () {
        const agentCard = yield* Ref.get(cardRef);
        const before = yield* runBefore({
          input: { method, value } as BeforeArgs['input'],
          agentCard,
          options: normalizeHeaders(options, transport.protocolVersion),
        });
        if (Option.isSome(before.early)) {
          const after = yield* runAfter(
            {
              result: before.early.value.value,
              agentCard,
              options: before.args.options,
            },
            before.early.value.executed
          );
          return yield* outputOf(method, after.result);
        }
        if (before.args.input.method !== method) {
          return yield* mismatch(method);
        }
        const output = yield* call(
          before.args.input.value as Input<M>,
          before.args.options
        );
        const after = yield* runAfter({
          result: { method, value: output } as ClientCallResult,
          agentCard,
          options: before.args.options,
        });
        return yield* outputOf(method, after.result);
      });

    const executeStream = <M extends 'sendMessageStream' | 'resubscribeTask'>(
      method: M,
      value: Input<M>,
      options: CallOptions | undefined,
      call: (
        value: Input<M>,
        options: CallOptions,
        agentCard: AgentCard
      ) => Stream.Stream<StreamResponse, ClientError>
    ): Stream.Stream<StreamResponse, ClientError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const agentCard = yield* Ref.get(cardRef);
          const before = yield* runBefore({
            input: { method, value } as BeforeArgs['input'],
            agentCard,
            options: normalizeHeaders(options, transport.protocolVersion),
          });
          if (Option.isSome(before.early)) {
            const after = yield* runAfter(
              {
                result: before.early.value.value,
                agentCard,
                options: before.args.options,
              },
              before.early.value.executed
            );
            return Stream.fromEffect(outputOf(method, after.result)).pipe(
              Stream.map((event) => event as StreamResponse)
            );
          }
          if (before.args.input.method !== method) {
            return yield* mismatch(method);
          }
          const stopped = yield* Ref.make(false);
          return call(
            before.args.input.value as Input<M>,
            before.args.options,
            agentCard
          ).pipe(
            Stream.takeWhileEffect(() =>
              Effect.map(Ref.get(stopped), (stop) => !stop)
            ),
            Stream.mapEffect((event) =>
              Effect.gen(function* () {
                const after = yield* runAfter({
                  result: { method, value: event } as ClientCallResult,
                  agentCard,
                  options: before.args.options,
                });
                if (after.earlyReturn) yield* Ref.set(stopped, true);
                return (yield* outputOf(
                  method,
                  after.result
                )) as StreamResponse;
              })
            )
          );
        })
      );

    const applyClientConfig = (
      params: SendMessageRequest,
      returnImmediately: boolean
    ): SendMessageRequest => {
      const configuration = params.configuration ?? {};
      const pushConfig =
        configuration.taskPushNotificationConfig ??
        config.pushNotificationConfig;
      return {
        ...params,
        configuration: {
          ...configuration,
          acceptedOutputModes:
            configuration.acceptedOutputModes ??
            config.acceptedOutputModes ??
            [],
          ...(pushConfig === undefined
            ? {}
            : { taskPushNotificationConfig: pushConfig }),
          returnImmediately:
            configuration.returnImmediately ?? returnImmediately,
        },
      };
    };

    const requirePush = Effect.flatMap(Ref.get(cardRef), (card) =>
      card.capabilities.pushNotifications === true
        ? Effect.void
        : Effect.fail(new PushNotificationNotSupportedError({}))
    );

    return {
      transport,
      protocolVersion: transport.protocolVersion,
      agentCard: Ref.get(cardRef),
      getAgentCard: (options, verifySignature) =>
        Effect.gen(function* () {
          let card = yield* Ref.get(cardRef);
          if (card.capabilities.extendedAgentCard === true) {
            card = yield* execute(
              'getAgentCard',
              { tenant: '' },
              options,
              (value, callOptions) =>
                transport.getExtendedAgentCard(value, callOptions)
            );
          }
          if (verifySignature !== undefined) yield* verifySignature(card);
          yield* Ref.set(cardRef, card);
          return card;
        }),
      sendMessage: (params, options) =>
        execute(
          'sendMessage',
          applyClientConfig(params, config.polling ?? false),
          options,
          transport.sendMessage
        ),
      sendMessageStream: (params, options) =>
        executeStream(
          'sendMessageStream',
          applyClientConfig(params, false),
          options,
          (value, callOptions, agentCard) =>
            agentCard.capabilities.streaming === true
              ? transport.sendMessageStream(value, callOptions)
              : Stream.fromEffect(
                  Effect.map(
                    transport.sendMessage(value, callOptions),
                    (result): StreamResponse =>
                      'messageId' in result
                        ? { message: result }
                        : { task: result }
                  )
                )
        ),
      createTaskPushNotificationConfig: (params, options) =>
        Effect.andThen(requirePush, () =>
          execute(
            'createTaskPushNotificationConfig',
            params,
            options,
            transport.createTaskPushNotificationConfig
          )
        ),
      getTaskPushNotificationConfig: (params, options) =>
        Effect.andThen(requirePush, () =>
          execute(
            'getTaskPushNotificationConfig',
            params,
            options,
            transport.getTaskPushNotificationConfig
          )
        ),
      listTaskPushNotificationConfig: (params, options) =>
        Effect.andThen(requirePush, () =>
          execute(
            'listTaskPushNotificationConfig',
            params,
            options,
            transport.listTaskPushNotificationConfig
          )
        ),
      deleteTaskPushNotificationConfig: (params, options) =>
        execute(
          'deleteTaskPushNotificationConfig',
          params,
          options,
          transport.deleteTaskPushNotificationConfig
        ),
      getTask: (params, options) =>
        execute('getTask', params, options, transport.getTask),
      cancelTask: (params, options) =>
        execute('cancelTask', params, options, transport.cancelTask),
      listTasks: (params, options) =>
        execute('listTasks', params, options, transport.listTasks),
      resubscribeTask: (params, options) =>
        executeStream(
          'resubscribeTask',
          params,
          options,
          (value, callOptions) => transport.resubscribeTask(value, callOptions)
        ),
    };
  });
