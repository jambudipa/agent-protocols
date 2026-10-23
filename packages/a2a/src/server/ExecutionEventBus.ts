/**
 * The execution event bus: the channel from an agent executor to the request
 * handler and to every subscriber of a task.
 *
 * @since 0.1.0
 */
import {
  Context,
  Effect,
  Layer,
  MutableHashMap,
  MutableHashSet,
  Option,
  PubSub,
  Stream,
} from 'effect';
import type { Scope } from 'effect';
import type {
  Message,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from '../Types.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type ServerCallContext,
} from './ServerCallContext.js';

/**
 * An event that an executor publishes: a message, a task, a status update or
 * an artifact update. It has the shape of a `StreamResponse`.
 *
 * @since 0.1.0
 */
export type AgentExecutionEvent = StreamResponse;

/**
 * Constructors of {@link AgentExecutionEvent}, named as in the reference SDK.
 *
 * @since 0.1.0
 */
export const AgentEvent = {
  message: (data: Message): AgentExecutionEvent => ({ message: data }),
  task: (data: Task): AgentExecutionEvent => ({ task: data }),
  statusUpdate: (data: TaskStatusUpdateEvent): AgentExecutionEvent => ({
    statusUpdate: data,
  }),
  artifactUpdate: (data: TaskArtifactUpdateEvent): AgentExecutionEvent => ({
    artifactUpdate: data,
  }),
};

/**
 * The last task and the last task state that a bus carried while a tracker
 * watched it.
 *
 * @since 0.1.0
 */
export interface BusSnapshot {
  readonly task: Option.Option<Task>;
  readonly state: Option.Option<TaskState>;
}

/**
 * The event bus of one task.
 *
 * @since 0.1.0
 */
export interface ExecutionEventBus {
  /** Publishes an event to every current subscriber. */
  readonly publish: (event: AgentExecutionEvent) => Effect.Effect<void>;
  /** Ends the event stream of every current subscriber. */
  readonly finished: Effect.Effect<void>;
  /**
   * Subscribes to the bus. The subscription starts when this effect runs,
   * so no later event is missed, and ends with the scope. The stream ends
   * at the next `finished`.
   */
  readonly subscribe: Effect.Effect<
    Stream.Stream<AgentExecutionEvent>,
    never,
    Scope.Scope
  >;
  /**
   * Starts a tracker of the last task and the last state that the bus
   * carries, until the scope ends. The returned effect reads the snapshot.
   */
  readonly track: Effect.Effect<Effect.Effect<BusSnapshot>, never, Scope.Scope>;
}

interface Tracker {
  task: Option.Option<Task>;
  state: Option.Option<TaskState>;
}

const stateOf = (event: AgentExecutionEvent): Option.Option<TaskState> =>
  'task' in event
    ? Option.some(event.task.status.state)
    : 'statusUpdate' in event
      ? Option.some(event.statusUpdate.status.state)
      : Option.none();

/**
 * Builds a bus.
 *
 * @since 0.1.0
 */
export const makeExecutionEventBus: Effect.Effect<ExecutionEventBus> =
  Effect.gen(function* () {
    const pubsub =
      yield* PubSub.unbounded<Option.Option<AgentExecutionEvent>>();
    const trackers = MutableHashSet.empty<Tracker>();
    const publish = (event: AgentExecutionEvent) =>
      Effect.suspend(() => {
        const state = stateOf(event);
        for (const tracker of trackers) {
          if ('task' in event) tracker.task = Option.some(event.task);
          if (Option.isSome(state)) tracker.state = state;
        }
        return PubSub.publish(pubsub, Option.some(event));
      }).pipe(Effect.asVoid);
    return {
      publish,
      finished: PubSub.publish(pubsub, Option.none()).pipe(Effect.asVoid),
      subscribe: Effect.map(PubSub.subscribe(pubsub), (subscription) =>
        Stream.fromSubscription(subscription).pipe(
          Stream.takeWhile(Option.isSome),
          Stream.map((event) => event.value)
        )
      ),
      track: Effect.acquireRelease(
        Effect.sync(() => {
          const tracker: Tracker = {
            task: Option.none(),
            state: Option.none(),
          };
          MutableHashSet.add(trackers, tracker);
          return tracker;
        }),
        (tracker) => Effect.sync(() => MutableHashSet.remove(trackers, tracker))
      ).pipe(
        Effect.map((tracker) =>
          Effect.sync((): BusSnapshot => ({
            task: tracker.task,
            state: tracker.state,
          }))
        )
      ),
    };
  });

/**
 * Keeps one bus for each running task, scoped by tenant and owner.
 *
 * @since 0.1.0
 */
export class ExecutionEventBusManager extends Context.Service<
  ExecutionEventBusManager,
  {
    readonly createOrGetByTaskId: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<ExecutionEventBus>;
    readonly getByTaskId: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<Option.Option<ExecutionEventBus>>;
    /** Removes the bus of a task. Call it when the execution ends. */
    readonly cleanupByTaskId: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<void>;
  }
>()('@jambudipa/a2a/server/ExecutionEventBusManager') {}

const makeInMemoryExecutionEventBusManager = Effect.gen(function* () {
  const ownerResolver = yield* CurrentOwnerResolver;
  const buses = MutableHashMap.empty<string, ExecutionEventBus>();
  const busKey = (taskId: string, context: ServerCallContext) => {
    const { tenant, owner } = callerScope(context, ownerResolver);
    return `${tenant}\u0000${owner}\u0000${taskId}`;
  };
  return ExecutionEventBusManager.of({
    createOrGetByTaskId: (taskId, context) =>
      Effect.suspend(() => {
        const key = busKey(taskId, context);
        const existing = MutableHashMap.get(buses, key);
        return Option.isSome(existing)
          ? Effect.succeed(existing.value)
          : Effect.tap(makeExecutionEventBus, (bus) =>
              Effect.sync(() => MutableHashMap.set(buses, key, bus))
            );
      }),
    getByTaskId: (taskId, context) =>
      Effect.sync(() => MutableHashMap.get(buses, busKey(taskId, context))),
    cleanupByTaskId: (taskId, context) =>
      Effect.sync(() => {
        MutableHashMap.remove(buses, busKey(taskId, context));
      }),
  });
});

/**
 * The bus manager of the reference SDK, in memory.
 *
 * @since 0.1.0
 */
export const InMemoryExecutionEventBusManager = {
  make: makeInMemoryExecutionEventBusManager,
  layer: Layer.effect(
    ExecutionEventBusManager,
    makeInMemoryExecutionEventBusManager
  ),
};
