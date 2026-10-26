/**
 * The task store: where the request handler keeps tasks, scoped by tenant
 * and owner.
 *
 * @since 0.1.0
 */
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  MutableHashMap,
  Option,
  Order,
  Schema,
  Struct,
} from 'effect';
import type { RequestMalformedError } from '../errors/index.js';
import type { ListTasksRequest, ListTasksResponse, Task } from '../Types.js';
import { decodePageToken, encodePageToken } from './internal/utils.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type ServerCallContext,
} from './ServerCallContext.js';

/**
 * A store failed to read or write.
 *
 * @since 0.1.0
 */
export class TaskStoreError extends Schema.TaggedError<TaskStoreError>()(
  'TaskStoreError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * The parameters of {@link TaskStore} `list`: a `ListTasks` request whose
 * page size the request handler has resolved.
 *
 * @since 0.1.0
 */
export interface ListTasksParams extends ListTasksRequest {
  readonly pageSize: number;
}

/**
 * Keeps tasks. Every method scopes its records by the tenant and the owner
 * of the call context, so one caller never sees another caller's tasks.
 *
 * @since 0.1.0
 */
export class TaskStore extends Context.Service<
  TaskStore,
  {
    /** Inserts or replaces a task. */
    readonly save: (
      task: Task,
      context: ServerCallContext
    ) => Effect.Effect<void, TaskStoreError>;
    /** Loads a task, or `Option.none()` when the caller has no such task. */
    readonly load: (
      taskId: string,
      context: ServerCallContext
    ) => Effect.Effect<Option.Option<Task>, TaskStoreError>;
    /**
     * Lists tasks, newest status first, then by id descending. Artifacts are
     * included only when `includeArtifacts` is set.
     */
    readonly list: (
      params: ListTasksParams,
      context: ServerCallContext
    ) => Effect.Effect<
      ListTasksResponse,
      TaskStoreError | RequestMalformedError
    >;
  }
>()('@jambudipa/a2a/server/TaskStore') {}

const statusTimestamp = (task: Task) => task.status.timestamp ?? '';

const epochMillis = (timestamp: string): Option.Option<number> =>
  Option.map(DateTime.make(timestamp), DateTime.toEpochMillis);

/**
 * Newest status time (by epoch milliseconds) first, then id descending, as the reference SDK
 * orders a task list.
 *
 * @since 0.1.0
 */
export const taskListOrder: Order.Order<Task> = Order.combine(
  Order.mapInput(Order.flip(Order.Number), (task: Task) =>
    Option.getOrElse(epochMillis(statusTimestamp(task)), () => 0)
  ),
  Order.mapInput(Order.flip(Order.String), (task: Task) => task.id)
);

/**
 * Filters, orders and pages a list of tasks for a `ListTasks` request. A
 * store that keeps all tasks of a caller in memory uses it as is.
 *
 * @since 0.1.0
 */
export const pageTasks = (
  all: ReadonlyArray<Task>,
  params: ListTasksParams
): Effect.Effect<ListTasksResponse, RequestMalformedError> =>
  Effect.gen(function* () {
    const after =
      params.statusTimestampAfter === undefined
        ? Option.none<number>()
        : epochMillis(params.statusTimestampAfter);
    const filtered = all.filter(
      (task) =>
        (params.contextId === undefined ||
          params.contextId === '' ||
          task.contextId === params.contextId) &&
        (params.status === undefined ||
          params.status === 'TASK_STATE_UNSPECIFIED' ||
          task.status.state === params.status) &&
        Option.match(after, {
          onNone: () => true,
          onSome: (threshold) =>
            Option.match(epochMillis(statusTimestamp(task)), {
              onNone: () => false,
              onSome: (millis) => millis > threshold,
            }),
        })
    );
    const sorted = Arr.sort(filtered, taskListOrder);
    let remaining: ReadonlyArray<Task> = sorted;
    if (params.pageToken !== undefined && params.pageToken !== '') {
      const cursor = yield* decodePageToken(params.pageToken);
      const index = sorted.findIndex(
        (task) =>
          statusTimestamp(task) === cursor.timestamp && task.id === cursor.id
      );
      remaining = index === -1 ? [] : sorted.slice(index + 1);
    }
    const page = remaining.slice(0, params.pageSize);
    const last = page.at(-1);
    const nextPageToken =
      last !== undefined && remaining.length > page.length
        ? encodePageToken(statusTimestamp(last), last.id)
        : '';
    return {
      tasks: page.map((task) =>
        params.includeArtifacts === true
          ? { ...task, artifacts: task.artifacts ?? [] }
          : Struct.omit(task, ['artifacts'])
      ),
      nextPageToken,
      pageSize: params.pageSize,
      totalSize: sorted.length,
    };
  });

const makeInMemoryTaskStore = Effect.gen(function* () {
  const ownerResolver = yield* CurrentOwnerResolver;
  const buckets = MutableHashMap.empty<
    string,
    MutableHashMap.MutableHashMap<string, Task>
  >();
  const bucketKey = (context: ServerCallContext) => {
    const { tenant, owner } = callerScope(context, ownerResolver);
    return `${tenant}\u0000${owner}`;
  };
  const bucket = (context: ServerCallContext) =>
    MutableHashMap.get(buckets, bucketKey(context));
  return TaskStore.of({
    save: (task, context) =>
      Effect.sync(() => {
        const key = bucketKey(context);
        const existing = MutableHashMap.get(buckets, key);
        if (Option.isSome(existing)) {
          MutableHashMap.set(existing.value, task.id, task);
        } else {
          MutableHashMap.set(
            buckets,
            key,
            MutableHashMap.make([task.id, task])
          );
        }
      }),
    load: (taskId, context) =>
      Effect.sync(() =>
        Option.flatMap(bucket(context), (tasks) =>
          MutableHashMap.get(tasks, taskId)
        )
      ),
    list: (params, context) =>
      pageTasks(
        Option.match(bucket(context), {
          onNone: () => [],
          onSome: (tasks) => Arr.fromIterable(MutableHashMap.values(tasks)),
        }),
        params
      ),
  });
});

/**
 * A task store in memory, with the semantics of the reference
 * `InMemoryTaskStore`. It reads the owner resolver from
 * {@link CurrentOwnerResolver}.
 *
 * @since 0.1.0
 */
export const InMemoryTaskStore = {
  /** Builds an empty in-memory store. */
  make: makeInMemoryTaskStore,
  /**
   * A layer of an empty in-memory store. Like any layer, it is built once
   * per layer graph; use `Layer.fresh` for a separate store.
   */
  layer: Layer.effect(TaskStore, makeInMemoryTaskStore),
};
