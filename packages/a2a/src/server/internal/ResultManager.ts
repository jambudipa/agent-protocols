/**
 * The result manager of one request: it applies each execution event to the
 * stored task and remembers the result of the request.
 *
 * It ports `ResultManager` of `@a2a-js/sdk` 1.3.0. Every load, merge and save
 * of a task runs under a lock of its (tenant, user, task id), so concurrent
 * requests on one task do not lose each other's writes.
 *
 * @internal
 */
import { Effect, Option, Ref } from 'effect';
import type {
  Artifact,
  Message,
  SendMessageResult,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from '../../Types.js';
import type { AgentExecutionEvent } from '../ExecutionEventBus.js';
import type { ServerCallContext } from '../ServerCallContext.js';
import type { TaskStore, TaskStoreError } from '../TaskStore.js';
import type { KeyedLock } from './KeyedLock.js';
import { isTerminal } from './utils.js';

/** @internal */
export interface ResultManager {
  readonly processEvent: (
    event: AgentExecutionEvent
  ) => Effect.Effect<void, TaskStoreError>;
  /** The final message, else the current task. */
  readonly finalResult: Effect.Effect<Option.Option<SendMessageResult>>;
  readonly currentTask: Effect.Effect<Option.Option<Task>>;
}

interface State {
  readonly currentTask: Option.Option<Task>;
  readonly finalMessage: Option.Option<Message>;
  readonly lastSeenTaskId: Option.Option<string>;
}

const mergeMetadata = (
  base: Task['metadata'],
  update: Task['metadata']
): Task['metadata'] =>
  base === undefined && update === undefined
    ? base
    : { ...(base ?? {}), ...(update ?? {}) };

/**
 * Merges artifact lists by `artifactId`: a persisted artifact is replaced by
 * an incoming one with the same id; other incoming artifacts are appended.
 */
const mergeArtifacts = (
  persisted: ReadonlyArray<Artifact> | undefined,
  incoming: ReadonlyArray<Artifact> | undefined
): ReadonlyArray<Artifact> => {
  if (persisted === undefined || persisted.length === 0) return incoming ?? [];
  if (incoming === undefined || incoming.length === 0) return persisted;
  const merged = persisted.map(
    (artifact) =>
      incoming.find((next) => next.artifactId === artifact.artifactId) ??
      artifact
  );
  const seen = persisted.map((artifact) => artifact.artifactId);
  return [
    ...merged,
    ...incoming.filter((artifact) => !seen.includes(artifact.artifactId)),
  ];
};

/** @internal */
export const makeResultManager = (
  taskStore: TaskStore['Service'],
  context: ServerCallContext,
  lock: KeyedLock,
  latestUserMessage: Option.Option<Message>
): Effect.Effect<ResultManager> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<State>({
      currentTask: Option.none(),
      finalMessage: Option.none(),
      lastSeenTaskId: Option.none(),
    });
    const setCurrent = (task: Option.Option<Task>) =>
      Ref.update(state, (current) => ({ ...current, currentTask: task }));
    const save = (task: Task) =>
      Effect.andThen(setCurrent(Option.some(task)), () =>
        taskStore.save(task, context)
      );
    const locked = (taskId: string) =>
      taskId === ''
        ? <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
        : lock.withLock(
            `${context.tenant}\u0000${context.user.userName}\u0000${taskId}`
          );

    const noteTaskId = (taskId: string) =>
      taskId === ''
        ? Effect.void
        : Effect.gen(function* () {
            const { lastSeenTaskId } = yield* Ref.get(state);
            if (
              Option.isSome(lastSeenTaskId) &&
              lastSeenTaskId.value !== taskId
            ) {
              yield* Effect.logWarning(
                `ResultManager: event for task ${taskId} arrived after processing events for ${lastSeenTaskId.value}. This indicates the executor switched tasks mid-stream, which is not expected in normal operation.`
              );
            }
            yield* Ref.update(state, (current) => ({
              ...current,
              lastSeenTaskId: Option.some(taskId),
            }));
          });

    const loadPersisted = (taskId: string, eventName: string) =>
      taskId === ''
        ? Effect.succeed(Option.none<Task>())
        : Effect.tap(taskStore.load(taskId, context), (loaded) =>
            Option.isNone(loaded)
              ? Effect.logWarning(
                  `ResultManager: Received ${eventName} for unknown task ${taskId}`
                )
              : Effect.void
          );

    const processTask = (event: Task) =>
      Effect.gen(function* () {
        yield* noteTaskId(event.id);
        const persisted =
          event.id === ''
            ? Option.none<Task>()
            : yield* taskStore.load(event.id, context);
        let merged: Task = event;
        if (Option.isSome(persisted) && persisted.value.id === event.id) {
          const previous = persisted.value;
          const history =
            (event.history === undefined || event.history.length === 0) &&
            previous.history !== undefined
              ? previous.history
              : event.history;
          const metadata = mergeMetadata(previous.metadata, event.metadata);
          merged = {
            ...event,
            ...(history === undefined ? {} : { history }),
            artifacts: mergeArtifacts(previous.artifacts, event.artifacts),
            ...(metadata === undefined ? {} : { metadata }),
          };
        }
        if (Option.isSome(latestUserMessage)) {
          const latest = latestUserMessage.value;
          const history = merged.history ?? [];
          if (!history.some((m) => m.messageId === latest.messageId)) {
            merged = { ...merged, history: [latest, ...history] };
          }
        }
        yield* save(merged);
      });

    const applyStatusUpdate = (event: TaskStatusUpdateEvent) =>
      Effect.gen(function* () {
        yield* noteTaskId(event.taskId);
        const loaded = yield* loadPersisted(event.taskId, 'status update');
        if (Option.isNone(loaded) || loaded.value.id !== event.taskId) {
          return yield* setCurrent(loaded);
        }
        const task = loaded.value;
        const persistedState = task.status.state;
        if (
          isTerminal(persistedState) &&
          event.status.state !== persistedState
        ) {
          yield* Effect.logWarning(
            `ResultManager: ignoring status update ${event.status.state} for terminal task ${task.id} (${persistedState})`
          );
          return yield* setCurrent(loaded);
        }
        const metadata =
          event.metadata === undefined
            ? task.metadata
            : mergeMetadata(task.metadata, event.metadata);
        const update = event.status.message;
        const history = task.history ?? [];
        const nextHistory =
          update !== undefined &&
          !history.some((m) => m.messageId === update.messageId)
            ? [...history, update]
            : task.history;
        yield* save({
          ...task,
          status: event.status,
          ...(metadata === undefined ? {} : { metadata }),
          ...(nextHistory === undefined ? {} : { history: nextHistory }),
        });
      });

    const applyArtifactUpdate = (event: TaskArtifactUpdateEvent) =>
      Effect.gen(function* () {
        const artifact = event.artifact;
        yield* noteTaskId(event.taskId);
        const loaded = yield* loadPersisted(event.taskId, 'artifact update');
        if (Option.isNone(loaded) || loaded.value.id !== event.taskId) {
          return yield* setCurrent(loaded);
        }
        const task = loaded.value;
        const artifacts = task.artifacts ?? [];
        const index = artifacts.findIndex(
          (existing) => existing.artifactId === artifact.artifactId
        );
        let nextArtifacts: ReadonlyArray<Artifact>;
        if (index === -1) {
          nextArtifacts = [...artifacts, artifact];
        } else if (event.append === true) {
          nextArtifacts = artifacts.map((existing, position) => {
            if (position !== index) return existing;
            const metadata =
              artifact.metadata === undefined
                ? existing.metadata
                : mergeMetadata(existing.metadata, artifact.metadata);
            return {
              ...existing,
              parts: [...existing.parts, ...artifact.parts],
              ...(artifact.description === undefined ||
              artifact.description === ''
                ? {}
                : { description: artifact.description }),
              ...(artifact.name === undefined || artifact.name === ''
                ? {}
                : { name: artifact.name }),
              ...(metadata === undefined ? {} : { metadata }),
            };
          });
        } else {
          nextArtifacts = artifacts.map((existing, position) =>
            position === index ? artifact : existing
          );
        }
        const metadata =
          event.metadata === undefined
            ? task.metadata
            : mergeMetadata(task.metadata, event.metadata);
        yield* save({
          ...task,
          artifacts: nextArtifacts,
          ...(metadata === undefined ? {} : { metadata }),
        });
      });

    const processEvent = (
      event: AgentExecutionEvent
    ): Effect.Effect<void, TaskStoreError> => {
      if ('message' in event) {
        return Ref.update(state, (current) => ({
          ...current,
          finalMessage: Option.some(event.message),
        }));
      }
      if ('task' in event) {
        return locked(event.task.id)(processTask(event.task));
      }
      if ('statusUpdate' in event) {
        return locked(event.statusUpdate.taskId)(
          applyStatusUpdate(event.statusUpdate)
        );
      }
      return locked(event.artifactUpdate.taskId)(
        applyArtifactUpdate(event.artifactUpdate)
      );
    };

    return {
      processEvent,
      finalResult: Effect.map(Ref.get(state), (current) =>
        Option.isSome(current.finalMessage)
          ? Option.some<SendMessageResult>(current.finalMessage.value)
          : current.currentTask
      ),
      currentTask: Effect.map(Ref.get(state), (current) => current.currentTask),
    };
  });
