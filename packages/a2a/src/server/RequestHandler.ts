/**
 * The request handler: the A2A operations, independent of any binding.
 *
 * `DefaultRequestHandler` ports `DefaultRequestHandler` of `@a2a-js/sdk`
 * 1.3.0 to Effect. The executor publishes to an event bus; each request reads
 * the bus through a subscription that it opens before the executor starts;
 * streaming results are `Stream`s; and cancellation is the executor's
 * `cancelTask` followed by the interruption of the execution fiber.
 *
 * @since 0.1.0
 */
import {
  Cause,
  Context,
  Crypto,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  MutableHashMap,
  Option,
  Ref,
  Scope,
  Stream,
} from 'effect';
import { HttpClient } from 'effect/http';
import { DEFAULT_PAGE_SIZE } from '../Constants.js';
import {
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  InternalError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  type ServerError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../errors/index.js';
import type { AgentCardSignatureGenerator } from '../Signature.js';
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
  Message,
  SendMessageRequest,
  SendMessageResult,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
  TaskState,
  TaskStatus,
} from '../Types.js';
import { AgentExecutor } from './AgentExecutor.js';
import {
  AgentEvent,
  type AgentExecutionEvent,
  type ExecutionEventBus,
  ExecutionEventBusManager,
  InMemoryExecutionEventBusManager,
} from './ExecutionEventBus.js';
import { makeKeyedLock } from './internal/KeyedLock.js';
import {
  makeResultManager,
  type ResultManager,
} from './internal/ResultManager.js';
import {
  INTERRUPTED_STATES,
  applyHistoryLength,
  isTask,
  isTerminal,
} from './internal/utils.js';
import {
  InMemoryPushNotificationStore,
  PushNotificationStore,
} from './PushNotificationStore.js';
import {
  DefaultPushNotificationSender,
  PushNotificationSender,
} from './PushNotificationSender.js';
import type { RequestContext } from './RequestContext.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type ServerCallContext,
} from './ServerCallContext.js';
import { TaskStore } from './TaskStore.js';

/**
 * The A2A operations. Each binding decodes a request, calls one method and
 * encodes the result or the failure.
 *
 * @since 0.1.0
 */
export class A2ARequestHandler extends Context.Service<
  A2ARequestHandler,
  {
    /** The public Agent Card, signed when the handler has a signer. */
    readonly getAgentCard: Effect.Effect<AgentCard, ServerError>;
    readonly getAuthenticatedExtendedAgentCard: (
      params: GetExtendedAgentCardRequest,
      context: ServerCallContext
    ) => Effect.Effect<AgentCard, ServerError>;
    readonly sendMessage: (
      params: SendMessageRequest,
      context: ServerCallContext
    ) => Effect.Effect<SendMessageResult, ServerError>;
    readonly sendMessageStream: (
      params: SendMessageRequest,
      context: ServerCallContext
    ) => Stream.Stream<StreamResponse, ServerError>;
    readonly getTask: (
      params: GetTaskRequest,
      context: ServerCallContext
    ) => Effect.Effect<Task, ServerError>;
    readonly listTasks: (
      params: ListTasksRequest,
      context: ServerCallContext
    ) => Effect.Effect<ListTasksResponse, ServerError>;
    readonly cancelTask: (
      params: CancelTaskRequest,
      context: ServerCallContext
    ) => Effect.Effect<Task, ServerError>;
    readonly createTaskPushNotificationConfig: (
      params: TaskPushNotificationConfig,
      context: ServerCallContext
    ) => Effect.Effect<TaskPushNotificationConfig, ServerError>;
    readonly getTaskPushNotificationConfig: (
      params: GetTaskPushNotificationConfigRequest,
      context: ServerCallContext
    ) => Effect.Effect<TaskPushNotificationConfig, ServerError>;
    readonly listTaskPushNotificationConfigs: (
      params: ListTaskPushNotificationConfigsRequest,
      context: ServerCallContext
    ) => Effect.Effect<ListTaskPushNotificationConfigsResponse, ServerError>;
    readonly deleteTaskPushNotificationConfig: (
      params: DeleteTaskPushNotificationConfigRequest,
      context: ServerCallContext
    ) => Effect.Effect<void, ServerError>;
    /** `SubscribeToTask`: the task, then its live events. */
    readonly resubscribe: (
      params: SubscribeToTaskRequest,
      context: ServerCallContext
    ) => Stream.Stream<StreamResponse, ServerError>;
  }
>()('@jambudipa/a2a/server/A2ARequestHandler') {}

/**
 * The extended Agent Card of the handler: a card for authenticated callers,
 * or a function of the call context.
 *
 * @since 0.1.0
 */
export type ExtendedAgentCardProvider =
  | AgentCard
  | ((context: ServerCallContext) => Effect.Effect<AgentCard, ServerError>);

/**
 * The options of {@link DefaultRequestHandler}.
 *
 * @since 0.1.0
 */
export interface DefaultRequestHandlerOptions {
  /**
   * The public card. Its capabilities switch features on: `streaming`
   * for streamed sends and subscriptions, `pushNotifications` for the
   * push config methods and delivery, `extendedAgentCard` for the
   * extended card.
   */
  readonly agentCard: AgentCard;
  /**
   * The extended card. A card value goes to authenticated callers only; the
   * others get the public card.
   */
  readonly extendedAgentCard?: ExtendedAgentCardProvider;
  /** Signs every card that the handler returns. */
  readonly signAgentCard?: AgentCardSignatureGenerator;
  /**
   * The states in which a bus outlives its execution, so that a follow-up
   * message or a subscriber can attach. The default is the interrupted
   * states, `INPUT_REQUIRED` and `AUTH_REQUIRED`.
   */
  readonly keepBusAliveStates?: ReadonlyArray<TaskState>;
  /**
   * Rejects a message part whose media type is not in the card's
   * `defaultInputModes`. The default is `false`.
   */
  readonly validateInputModes?: boolean;
}

/**
 * How the caller consumes an execution. It decides which task an
 * executor failure is reported against; see `runExecutor`.
 */
type ExecutionVariant = 'blocking' | 'streaming';

/**
 * The shape that a streamed execution commits to with its first event:
 * one message, or a task followed by updates only. Any other order is
 * an `UnsupportedOperationError`.
 */
type StreamPattern = 'undetermined' | 'message-only' | 'task-lifecycle';

/** The queue of a request ends after a message, a terminal or an input-required status. */
const isStopEvent = (event: AgentExecutionEvent): boolean =>
  'message' in event ||
  ('statusUpdate' in event &&
    (isTerminal(event.statusUpdate.status.state) ||
      event.statusUpdate.status.state === 'TASK_STATE_INPUT_REQUIRED'));

/**
 * Cuts the bus stream of one request at its stop event, inclusive, so
 * that the request ends while the bus can carry later executions.
 */
const queueEvents = (
  events: Stream.Stream<AgentExecutionEvent>
): Stream.Stream<AgentExecutionEvent> =>
  events.pipe(Stream.takeUntil(isStopEvent));

/**
 * Wraps an unexpected failure as an `InternalError` with a prefix that
 * names the failing step, so that it reaches the caller as a protocol
 * error instead of a defect.
 */
const toInternal =
  (message: string) =>
  (cause: unknown): InternalError =>
    new InternalError({
      message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });

/**
 * The text of the main failure of a cause, for the status message of
 * a FAILED task.
 */
const messageOfCause = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.squash(cause);
  return failure instanceof Error ? failure.message : String(failure);
};

/**
 * Builds the default handler. It uses the provided bus manager and push
 * store when the context has them, else in-memory ones. Executions run
 * in a fiber set owned by the enclosing scope, so closing the scope
 * interrupts every running execution.
 */
const makeDefaultRequestHandler = (options: DefaultRequestHandlerOptions) =>
  Effect.gen(function* () {
    const agentCard = options.agentCard;
    const taskStore = yield* TaskStore;
    const executor = yield* AgentExecutor;
    const crypto = yield* Crypto.Crypto;
    const ownerResolver = yield* CurrentOwnerResolver;
    const busManager = yield* Effect.serviceOption(
      ExecutionEventBusManager
    ).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => InMemoryExecutionEventBusManager.make,
          onSome: Effect.succeed,
        })
      )
    );
    const fibers = yield* FiberSet.make();
    const lock = makeKeyedLock();
    const keepBusAlive = options.keepBusAliveStates ?? INTERRUPTED_STATES;
    const pushEnabled = agentCard.capabilities.pushNotifications === true;

    const pushStore = pushEnabled
      ? Option.some(
          yield* Effect.serviceOption(PushNotificationStore).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => InMemoryPushNotificationStore.make,
                onSome: Effect.succeed,
              })
            )
          )
        )
      : Option.none<PushNotificationStore['Service']>();
    const pushSender = yield* makePushSender(pushStore);

    const executions = MutableHashMap.empty<
      string,
      ReadonlyArray<Fiber.Fiber<unknown, unknown>>
    >();
    const executionKey = (taskId: string, context: ServerCallContext) => {
      const { tenant, owner } = callerScope(context, ownerResolver);
      return `${tenant}\u0000${owner}\u0000${taskId}`;
    };

    const uuid = crypto
      .randomUUIDv4()
      .pipe(Effect.mapError(toInternal('Cannot generate an id')));
    const now = Effect.map(DateTime.now, DateTime.formatIso);
    const storeError = Effect.mapError(toInternal('Task store failure'));
    const pushStoreError = Effect.mapError(
      toInternal('Push notification store failure')
    );

    const agentMessage = (taskId: string, contextId: string, text: string) =>
      Effect.map(uuid, (messageId): Message => ({
        role: 'ROLE_AGENT',
        messageId,
        taskId,
        contextId,
        parts: [{ text, mediaType: 'text/plain' }],
      }));

    const failedStatus = (taskId: string, contextId: string, text: string) =>
      Effect.gen(function* () {
        const message = yield* agentMessage(taskId, contextId, text);
        const timestamp = yield* now;
        return {
          state: 'TASK_STATE_FAILED',
          message,
          timestamp,
        } satisfies TaskStatus;
      });

    const sign = (card: AgentCard) =>
      options.signAgentCard === undefined
        ? Effect.succeed(card)
        : options
            .signAgentCard(card)
            .pipe(
              Effect.mapError(
                (error) => new InternalError({ message: error.message })
              )
            );

    const getAgentCard = sign(agentCard);

    const requireValidTaskId = (taskId: string | undefined) =>
      taskId === undefined || taskId.trim() === ''
        ? Effect.fail(
            new RequestMalformedError({ message: 'Task ID is required' })
          )
        : Effect.succeed(taskId);

    const loadTask = (taskId: string, context: ServerCallContext) =>
      taskStore.load(taskId, context).pipe(storeError);

    const requireTask = (taskId: string, context: ServerCallContext) =>
      Effect.flatMap(
        loadTask(taskId, context),
        Option.match({
          onNone: () =>
            Effect.fail(
              new TaskNotFoundError({ message: `Task not found: ${taskId}` })
            ),
          onSome: Effect.succeed,
        })
      );

    const validateInputModes = (message: Message, card: AgentCard) => {
      const supported = card.defaultInputModes;
      if (options.validateInputModes !== true || supported.length === 0) {
        return Effect.void;
      }
      const unsupported = message.parts.find(
        (part) =>
          part.mediaType !== undefined &&
          part.mediaType !== '' &&
          !supported.includes(part.mediaType)
      );
      return unsupported === undefined
        ? Effect.void
        : Effect.fail(
            new ContentTypeNotSupportedError({
              message: `Media type '${unsupported.mediaType}' is not supported. Supported media types: ${supported.join(', ')}.`,
            })
          );
    };

    const createRequestContext = (
      request: SendMessageRequest,
      context: ServerCallContext
    ): Effect.Effect<RequestContext, ServerError> =>
      Effect.gen(function* () {
        const incoming = request.message;
        const card = yield* getAgentCard;
        yield* validateInputModes(incoming, card);
        const agentExtensions = card.capabilities.extensions ?? [];
        const requested = yield* Ref.get(context.requestedExtensions);
        const missingRequired = agentExtensions
          .filter(
            (extension) =>
              extension.required === true &&
              !requested.includes(extension.uri ?? '')
          )
          .map((extension) => extension.uri ?? '');
        if (missingRequired.length > 0) {
          return yield* new ExtensionSupportRequiredError({
            message: `Client must declare support for required extensions: ${missingRequired.join(', ')}`,
          });
        }
        let task = Option.none<Task>();
        const incomingTaskId = incoming.taskId ?? '';
        if (incomingTaskId !== '') {
          yield* requireValidTaskId(incomingTaskId);
          const existing = yield* requireTask(incomingTaskId, context);
          if (isTerminal(existing.status.state)) {
            return yield* new UnsupportedOperationError({
              message: `Task ${existing.id} is in a terminal state (${existing.status.state}) and cannot be modified.`,
            });
          }
          if (
            incoming.contextId !== undefined &&
            incoming.contextId !== '' &&
            existing.contextId !== undefined &&
            existing.contextId !== '' &&
            incoming.contextId !== existing.contextId
          ) {
            return yield* new RequestMalformedError({
              message: `contextId mismatch: message contextId '${incoming.contextId}' does not match task '${existing.id}' contextId '${existing.contextId}'`,
            });
          }
          const updated: Task = {
            ...existing,
            history: [...(existing.history ?? []), incoming],
          };
          yield* taskStore.save(updated, context).pipe(storeError);
          task = Option.some(updated);
        }
        const taskId = incomingTaskId === '' ? yield* uuid : incomingTaskId;
        const referenceIds = incoming.referenceTaskIds ?? [];
        let referenceTasks = Option.none<ReadonlyArray<Task>>();
        if (referenceIds.length > 0) {
          const found = yield* Effect.forEach(referenceIds, (referenceId) =>
            Effect.tap(loadTask(referenceId, context), (loaded) =>
              Option.isNone(loaded)
                ? Effect.logWarning(`Reference task ${referenceId} not found.`)
                : Effect.void
            )
          );
          referenceTasks = Option.some(found.flatMap(Option.toArray));
        }
        const contextId =
          incoming.contextId !== undefined && incoming.contextId !== ''
            ? incoming.contextId
            : yield* Option.match(
                Option.flatMap(task, (existing) =>
                  existing.contextId === undefined || existing.contextId === ''
                    ? Option.none()
                    : Option.some(existing.contextId)
                ),
                { onNone: () => uuid, onSome: Effect.succeed }
              );
        const exposed = agentExtensions.map((extension) => extension.uri ?? '');
        yield* Ref.update(context.requestedExtensions, (current) =>
          current.filter((uri) => exposed.includes(uri))
        );
        const userMessage: Message = { ...incoming, contextId, taskId };
        return {
          request: { ...request, message: userMessage },
          userMessage,
          taskId,
          contextId,
          task,
          referenceTasks,
          context,
        };
      });

    const savePushConfig = (
      request: SendMessageRequest,
      taskId: string,
      context: ServerCallContext
    ) => {
      const config = request.configuration?.taskPushNotificationConfig;
      return config === undefined || Option.isNone(pushStore)
        ? Effect.void
        : pushStore.value
            .save(taskId, context, { ...config, taskId })
            .pipe(pushStoreError, Effect.asVoid);
    };

    const mapEventToStreamResponse = (
      event: AgentExecutionEvent,
      context: ServerCallContext
    ): Effect.Effect<StreamResponse> =>
      'task' in event
        ? taskStore.load(event.task.id, context).pipe(
            Effect.map((loaded) => ({
              task: Option.getOrElse(loaded, () => event.task),
            })),
            Effect.catch((error) =>
              Effect.as(
                Effect.logWarning(
                  'Failed to load full task from store, falling back to event data',
                  error
                ),
                { task: event.task }
              )
            )
          )
        : Effect.succeed(event);

    const sendPush = (
      context: ServerCallContext,
      response: StreamResponse,
      task: Option.Option<Task>
    ) =>
      Option.match(pushSender, {
        onNone: () => Effect.void,
        onSome: (sender) => sender.send(response, context, task),
      });

    const settleBus = (
      taskId: string,
      bus: ExecutionEventBus,
      lastState: Option.Option<TaskState>,
      context: ServerCallContext
    ) =>
      Option.isSome(lastState) && keepBusAlive.includes(lastState.value)
        ? Effect.void
        : Effect.andThen(bus.finished, () =>
            busManager.cleanupByTaskId(taskId, context)
          );

    const registerExecution = (key: string) =>
      Effect.withFiber((fiber) =>
        Effect.sync(() => {
          const current = Option.getOrElse(
            MutableHashMap.get(executions, key),
            () => []
          );
          MutableHashMap.set(executions, key, [...current, fiber]);
          return fiber;
        })
      );

    const unregisterExecution = (
      key: string,
      fiber: Fiber.Fiber<unknown, unknown>
    ) =>
      Effect.sync(() => {
        const remaining = Option.getOrElse(
          MutableHashMap.get(executions, key),
          () => []
        ).filter((other) => other !== fiber);
        if (remaining.length === 0) MutableHashMap.remove(executions, key);
        else MutableHashMap.set(executions, key, remaining);
      });

    /**
     * Runs the executor in the background. A failure before the result
     * becomes a FAILED task on the bus: the blocking variant always publishes
     * a task and a FAILED status; the streaming variant publishes the task
     * only when the executor published none.
     */
    const runExecutor = (
      taskId: string,
      bus: ExecutionEventBus,
      requestContext: RequestContext,
      variant: ExecutionVariant
    ) =>
      FiberSet.run(
        fibers,
        Effect.scoped(
          Effect.gen(function* () {
            const key = executionKey(taskId, requestContext.context);
            const self = yield* registerExecution(key);
            const snapshot = yield* bus.track;
            const userMessage = requestContext.userMessage;
            const contextId = requestContext.contextId;
            yield* executor.execute(requestContext, bus).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : Effect.gen(function* () {
                      const errorMessage = messageOfCause(cause);
                      yield* Effect.logError(
                        `Agent execution failed for message ${userMessage.messageId}`,
                        cause
                      );
                      const latest = (yield* snapshot).task;
                      const errorTaskId =
                        variant === 'streaming' && Option.isSome(latest)
                          ? latest.value.id
                          : requestContext.taskId;
                      const errorContextId =
                        variant === 'streaming' && Option.isSome(latest)
                          ? (latest.value.contextId ?? contextId)
                          : contextId;
                      if (variant === 'blocking' || Option.isNone(latest)) {
                        const status = yield* failedStatus(
                          requestContext.taskId,
                          contextId,
                          `Agent execution error: ${errorMessage}`
                        );
                        const history = Option.match(requestContext.task, {
                          onNone: () => [],
                          onSome: (task) => task.history ?? [],
                        });
                        const errorTask: Task = {
                          id: requestContext.taskId,
                          contextId,
                          status,
                          artifacts: [],
                          history: history.some(
                            (message) =>
                              message.messageId === userMessage.messageId
                          )
                            ? history
                            : [...history, userMessage],
                          metadata: {},
                        };
                        yield* bus.publish(AgentEvent.task(errorTask));
                        if (variant === 'blocking') {
                          yield* bus.publish(
                            AgentEvent.statusUpdate({
                              taskId: errorTask.id,
                              contextId,
                              status,
                              metadata: {},
                            })
                          );
                          return;
                        }
                      }
                      const status = yield* failedStatus(
                        errorTaskId,
                        errorContextId,
                        `Agent execution error: ${errorMessage}`
                      );
                      yield* bus.publish(
                        AgentEvent.statusUpdate({
                          taskId: errorTaskId,
                          contextId: errorContextId,
                          status,
                          metadata: {},
                        })
                      );
                    }).pipe(
                      Effect.catchCause((failure) =>
                        Effect.logError(
                          'Cannot record the execution failure',
                          failure
                        )
                      )
                    )
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  const { state } = yield* snapshot;
                  yield* settleBus(taskId, bus, state, requestContext.context);
                  yield* unregisterExecution(key, self);
                })
              )
            );
          })
        )
      );

    const failedStatusEvent = (task: Task, text: string) =>
      Effect.map(
        failedStatus(task.id, task.contextId ?? '', text),
        (status): AgentExecutionEvent =>
          AgentEvent.statusUpdate({
            taskId: task.id,
            contextId: task.contextId ?? '',
            status,
            metadata: {},
          })
      );

    /**
     * Drains the queue of a request in the background and completes
     * `result`: with the first result when non-blocking, at an AUTH_REQUIRED
     * status or at the end when blocking.
     */
    const processEvents = (
      events: Stream.Stream<AgentExecutionEvent>,
      resultManager: ResultManager,
      context: ServerCallContext,
      blocking: boolean,
      historyLength: number | undefined,
      result: Deferred.Deferred<SendMessageResult, ServerError>
    ) =>
      Effect.gen(function* () {
        const firstResultSent = yield* Ref.make(false);
        const resolve = (value: SendMessageResult) =>
          Effect.andThen(Ref.set(firstResultSent, true), () =>
            Deferred.succeed(
              result,
              isTask(value) ? applyHistoryLength(value, historyLength) : value
            )
          );
        const drained = Stream.runForEach(queueEvents(events), (event) =>
          Effect.gen(function* () {
            yield* resultManager.processEvent(event).pipe(storeError);
            const response = yield* mapEventToStreamResponse(event, context);
            yield* sendPush(
              context,
              response,
              yield* resultManager.currentTask
            );
            if (!blocking && !(yield* Ref.get(firstResultSent))) {
              const first: Option.Option<SendMessageResult> =
                'message' in event
                  ? Option.some(event.message)
                  : 'task' in event
                    ? Option.some(event.task)
                    : yield* resultManager.finalResult;
              if (Option.isSome(first)) yield* resolve(first.value);
            }
            if (
              blocking &&
              'statusUpdate' in event &&
              event.statusUpdate.status.state === 'TASK_STATE_AUTH_REQUIRED' &&
              !(yield* Ref.get(firstResultSent))
            ) {
              const current = yield* resultManager.currentTask;
              if (Option.isSome(current)) yield* resolve(current.value);
            }
          })
        );
        const outcome = yield* Effect.exit(drained);
        if (Exit.isFailure(outcome)) {
          const error = Cause.squash(outcome.cause);
          yield* Effect.logError('Event processing loop failed', outcome.cause);
          if (!(yield* Ref.get(firstResultSent))) {
            yield* Deferred.failCause(result, outcome.cause);
            return;
          }
          const current = yield* resultManager.currentTask;
          if (Option.isSome(current)) {
            const failed = yield* failedStatusEvent(
              current.value,
              `Event processing loop failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            yield* resultManager
              .processEvent(failed)
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logError('Event processing loop failed', cause)
                )
              );
          }
          return;
        }
        if (yield* Ref.get(firstResultSent)) return;
        if (!blocking) {
          yield* Deferred.fail(
            result,
            new RequestMalformedError({
              message:
                'Execution finished before a message or task was produced.',
            })
          );
          return;
        }
        const final = yield* resultManager.finalResult;
        yield* Option.match(final, {
          onNone: () =>
            Deferred.fail(
              result,
              new InternalError({
                message:
                  'Agent execution finished without a result, and no task context found.',
              })
            ),
          onSome: (value) => resolve(value),
        });
      });

    const sendMessage = (
      params: SendMessageRequest,
      context: ServerCallContext
    ): Effect.Effect<SendMessageResult, ServerError> =>
      Effect.gen(function* () {
        const incoming = params.message;
        if (incoming.messageId === '') {
          return yield* new RequestMalformedError({
            message: 'message.messageId is required.',
          });
        }
        const blocking = params.configuration?.returnImmediately !== true;
        const resultManager = yield* makeResultManager(
          taskStore,
          context,
          lock,
          Option.some(incoming)
        );
        const requestContext = yield* createRequestContext(params, context);
        const taskId = requestContext.taskId;
        yield* savePushConfig(params, taskId, context);
        const bus = yield* busManager.createOrGetByTaskId(taskId, context);
        const scope = yield* Scope.make();
        const events = yield* bus.subscribe.pipe(Scope.provide(scope));
        yield* runExecutor(taskId, bus, requestContext, 'blocking');
        const result = yield* Deferred.make<SendMessageResult, ServerError>();
        yield* FiberSet.run(
          fibers,
          processEvents(
            events,
            resultManager,
            context,
            blocking,
            params.configuration?.historyLength,
            result
          ).pipe(Effect.ensuring(Scope.close(scope, Exit.void)))
        );
        return yield* Deferred.await(result);
      });

    const advanceStreamPattern = (
      event: AgentExecutionEvent,
      pattern: StreamPattern
    ): Effect.Effect<StreamPattern, UnsupportedOperationError> => {
      const kind =
        'message' in event
          ? 'message'
          : 'task' in event
            ? 'task'
            : 'statusUpdate' in event
              ? 'statusUpdate'
              : 'artifactUpdate';
      switch (pattern) {
        case 'undetermined':
          if (kind === 'message') return Effect.succeed('message-only');
          if (kind === 'task') return Effect.succeed('task-lifecycle');
          return Effect.fail(
            new UnsupportedOperationError({
              message: `Received ${kind} before initial 'Message'/'Task' event.`,
            })
          );
        case 'message-only':
          return Effect.fail(
            new UnsupportedOperationError({
              message: `Received ${kind} after message-only response.`,
            })
          );
        case 'task-lifecycle':
          return kind === 'statusUpdate' || kind === 'artifactUpdate'
            ? Effect.succeed(pattern)
            : Effect.fail(
                new UnsupportedOperationError({
                  message: `Stream ordering violation: received ${kind} in task lifecycle stream.`,
                })
              );
      }
    };

    const sendMessageStream = (
      params: SendMessageRequest,
      context: ServerCallContext
    ): Stream.Stream<StreamResponse, ServerError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (agentCard.capabilities.streaming !== true) {
            return yield* new UnsupportedOperationError({
              message: 'Streaming is not supported.',
            });
          }
          const incoming = params.message;
          if (incoming.messageId === '') {
            return yield* new RequestMalformedError({
              message: 'message.messageId is required for streaming.',
            });
          }
          const resultManager = yield* makeResultManager(
            taskStore,
            context,
            lock,
            Option.some(incoming)
          );
          const requestContext = yield* createRequestContext(params, context);
          const taskId = requestContext.taskId;
          const bus = yield* busManager.createOrGetByTaskId(taskId, context);
          const events = yield* bus.subscribe;
          yield* savePushConfig(params, taskId, context);
          yield* runExecutor(taskId, bus, requestContext, 'streaming');
          const pattern = yield* Ref.make<StreamPattern>('undetermined');
          return queueEvents(events).pipe(
            Stream.mapEffect((event) =>
              Effect.gen(function* () {
                const next = yield* advanceStreamPattern(
                  event,
                  yield* Ref.get(pattern)
                );
                yield* Ref.set(pattern, next);
                yield* resultManager.processEvent(event).pipe(storeError);
                const mapped = yield* mapEventToStreamResponse(event, context);
                const response: StreamResponse =
                  'task' in mapped
                    ? {
                        task: applyHistoryLength(
                          mapped.task,
                          params.configuration?.historyLength
                        ),
                      }
                    : mapped;
                yield* sendPush(
                  context,
                  response,
                  yield* resultManager.currentTask
                );
                return response;
              })
            )
          );
        })
      );

    const getTask = (
      params: GetTaskRequest,
      context: ServerCallContext
    ): Effect.Effect<Task, ServerError> =>
      Effect.gen(function* () {
        const taskId = yield* requireValidTaskId(params.id);
        const task = yield* requireTask(taskId, context);
        return applyHistoryLength(task, params.historyLength);
      });

    const listTasks = (
      params: ListTasksRequest,
      context: ServerCallContext
    ): Effect.Effect<ListTasksResponse, ServerError> =>
      Effect.gen(function* () {
        const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
          return yield* new RequestMalformedError({
            message: 'pageSize must be between 1 and 100',
          });
        }
        const response = yield* taskStore
          .list({ ...params, pageSize }, context)
          .pipe(
            Effect.catchTag('TaskStoreError', (error) =>
              Effect.fail(toInternal('Task store failure')(error))
            )
          );
        return {
          ...response,
          tasks: response.tasks.map((task) =>
            applyHistoryLength(task, params.historyLength)
          ),
        };
      });

    const cancelTask = (
      params: CancelTaskRequest,
      context: ServerCallContext
    ): Effect.Effect<Task, ServerError> =>
      Effect.gen(function* () {
        const taskId = yield* requireValidTaskId(params.id);
        const task = yield* requireTask(taskId, context);
        const state = task.status.state;
        if (state === 'TASK_STATE_CANCELED') return task;
        if (isTerminal(state)) {
          return yield* new TaskNotCancelableError({
            message: `Task not cancelable: ${params.id}`,
          });
        }
        const resultManager = yield* makeResultManager(
          taskStore,
          context,
          lock,
          Option.none()
        );
        const bus = yield* busManager.getByTaskId(taskId, context);
        if (Option.isSome(bus)) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const events = yield* bus.value.subscribe;
              yield* executor
                .cancelTask(taskId, bus.value)
                .pipe(
                  Effect.mapError(
                    (error) => new InternalError({ message: error.message })
                  )
                );
              yield* Stream.runForEach(queueEvents(events), (event) =>
                Effect.gen(function* () {
                  yield* resultManager.processEvent(event).pipe(storeError);
                  const response = yield* mapEventToStreamResponse(
                    event,
                    context
                  );
                  yield* sendPush(
                    context,
                    response,
                    yield* resultManager.currentTask
                  );
                })
              );
            })
          );
        } else {
          const message = yield* agentMessage(
            task.id,
            task.contextId ?? '',
            'Task cancellation requested by user.'
          );
          const timestamp = yield* now;
          yield* resultManager
            .processEvent(
              AgentEvent.statusUpdate({
                taskId: task.id,
                contextId: task.contextId ?? '',
                status: { state: 'TASK_STATE_CANCELED', message, timestamp },
                metadata: {},
              })
            )
            .pipe(storeError);
        }
        const latest = yield* loadTask(taskId, context);
        if (Option.isNone(latest)) {
          return yield* new InternalError({
            message: `Task ${params.id} not found after cancellation.`,
          });
        }
        if (latest.value.status.state !== 'TASK_STATE_CANCELED') {
          return yield* new TaskNotCancelableError({
            message: `Task not cancelable: ${params.id}`,
          });
        }
        // The task is canceled: stop any execution that still runs for it.
        const running = Option.getOrElse(
          MutableHashMap.get(executions, executionKey(taskId, context)),
          () => []
        );
        yield* Fiber.interruptAll(running);
        return latest.value;
      });

    const requirePush: Effect.Effect<
      PushNotificationStore['Service'],
      ServerError
    > = Option.match(pushStore, {
      onNone: () => Effect.fail(new PushNotificationNotSupportedError({})),
      onSome: Effect.succeed,
    });

    const createTaskPushNotificationConfig = (
      params: TaskPushNotificationConfig,
      context: ServerCallContext
    ) =>
      Effect.gen(function* () {
        const store = yield* requirePush;
        const taskId = yield* requireValidTaskId(params.taskId);
        yield* requireTask(taskId, context);
        return yield* store.save(taskId, context, params).pipe(pushStoreError);
      });

    const getTaskPushNotificationConfig = (
      params: GetTaskPushNotificationConfigRequest,
      context: ServerCallContext
    ) =>
      Effect.gen(function* () {
        const store = yield* requirePush;
        const taskId = yield* requireValidTaskId(params.taskId);
        yield* requireTask(taskId, context);
        const configs = yield* store.load(taskId, context).pipe(pushStoreError);
        if (configs.length === 0) {
          return yield* new TaskNotFoundError({
            message: `Push notification config not found for task ${taskId}.`,
          });
        }
        const config = configs.find((candidate) => candidate.id === params.id);
        if (config === undefined) {
          return yield* new TaskNotFoundError({
            message: `Push notification config with id '${params.id}' not found for task ${taskId}.`,
          });
        }
        return config;
      });

    const listTaskPushNotificationConfigs = (
      params: ListTaskPushNotificationConfigsRequest,
      context: ServerCallContext
    ) =>
      Effect.gen(function* () {
        const store = yield* requirePush;
        const taskId = yield* requireValidTaskId(params.taskId);
        yield* requireTask(taskId, context);
        const configs = yield* store.load(taskId, context).pipe(pushStoreError);
        return { configs, nextPageToken: '' };
      });

    const deleteTaskPushNotificationConfig = (
      params: DeleteTaskPushNotificationConfigRequest,
      context: ServerCallContext
    ) =>
      Effect.gen(function* () {
        const store = yield* requirePush;
        const taskId = yield* requireValidTaskId(params.taskId);
        yield* requireTask(taskId, context);
        yield* store.delete(taskId, context, params.id).pipe(pushStoreError);
      });

    const resubscribe = (
      params: SubscribeToTaskRequest,
      context: ServerCallContext
    ): Stream.Stream<StreamResponse, ServerError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (agentCard.capabilities.streaming !== true) {
            return yield* new UnsupportedOperationError({
              message: 'Streaming (and thus resubscription) is not supported.',
            });
          }
          const taskId = yield* requireValidTaskId(params.id);
          const bus = yield* busManager.getByTaskId(taskId, context);
          const events = Option.isSome(bus)
            ? Option.some(yield* bus.value.subscribe)
            : Option.none<Stream.Stream<AgentExecutionEvent>>();
          const task = yield* requireTask(taskId, context);
          if (isTerminal(task.status.state)) {
            return yield* new UnsupportedOperationError({
              message: `Task ${taskId} is in a terminal state (${task.status.state}) and cannot be subscribed to.`,
            });
          }
          const live = Option.match(events, {
            onNone: () => Stream.empty,
            onSome: (stream) =>
              queueEvents(stream).pipe(
                Stream.filter(
                  (event) =>
                    ('statusUpdate' in event &&
                      event.statusUpdate.taskId === taskId) ||
                    ('artifactUpdate' in event &&
                      event.artifactUpdate.taskId === taskId) ||
                    ('task' in event && event.task.id === taskId)
                )
              ),
          });
          return Stream.concat(Stream.succeed<StreamResponse>({ task }), live);
        })
      );

    const getAuthenticatedExtendedAgentCard = (
      _params: GetExtendedAgentCardRequest,
      context: ServerCallContext
    ) =>
      Effect.gen(function* () {
        if (agentCard.capabilities.extendedAgentCard !== true) {
          return yield* new UnsupportedOperationError({
            message: 'Agent does not support authenticated extended card.',
          });
        }
        const provider = options.extendedAgentCard;
        if (provider === undefined) {
          return yield* new ExtendedAgentCardNotConfiguredError({});
        }
        const card =
          typeof provider === 'function'
            ? yield* provider(context)
            : context.user.isAuthenticated
              ? provider
              : agentCard;
        return yield* sign(card);
      });

    return A2ARequestHandler.of({
      getAgentCard,
      getAuthenticatedExtendedAgentCard,
      sendMessage,
      sendMessageStream,
      getTask,
      listTasks,
      cancelTask,
      createTaskPushNotificationConfig,
      getTaskPushNotificationConfig,
      listTaskPushNotificationConfigs,
      deleteTaskPushNotificationConfig,
      resubscribe,
    });
  });

/**
 * The push sender of the handler: the provided `PushNotificationSender`, or
 * the default sender on the provided `HttpClient`. Without either, push
 * notifications are stored but not sent, and a warning says so.
 */
const makePushSender = (
  pushStore: Option.Option<PushNotificationStore['Service']>
) =>
  Effect.gen(function* () {
    if (Option.isNone(pushStore)) {
      return Option.none<PushNotificationSender['Service']>();
    }
    const provided = yield* Effect.serviceOption(PushNotificationSender);
    if (Option.isSome(provided)) return provided;
    const client = yield* Effect.serviceOption(HttpClient.HttpClient);
    if (Option.isNone(client)) {
      yield* Effect.logWarning(
        'Push notifications are enabled, but neither a PushNotificationSender nor an HttpClient is provided; notifications will not be sent.'
      );
      return Option.none<PushNotificationSender['Service']>();
    }
    const sender = yield* DefaultPushNotificationSender.make().pipe(
      Effect.provideService(PushNotificationStore, pushStore.value),
      Effect.provideService(HttpClient.HttpClient, client.value)
    );
    return Option.some(sender);
  });

/**
 * The default request handler. It requires a `TaskStore`, an
 * `AgentExecutor` and `Crypto` (for ids); it uses an
 * `ExecutionEventBusManager`, a `PushNotificationStore` and a
 * `PushNotificationSender` when they are provided, and in-memory defaults
 * otherwise. The default sender needs an `HttpClient`.
 *
 * @since 0.1.0
 */
export const DefaultRequestHandler = {
  make: makeDefaultRequestHandler,
  layer: (
    options: DefaultRequestHandlerOptions
  ): Layer.Layer<
    A2ARequestHandler,
    never,
    TaskStore | AgentExecutor | Crypto.Crypto
  > => Layer.effect(A2ARequestHandler, makeDefaultRequestHandler(options)),
};
