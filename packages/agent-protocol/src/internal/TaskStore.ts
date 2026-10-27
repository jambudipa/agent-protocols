/**
 * The in-memory task store of the server. It keeps tasks in creation order,
 * with the step handler, the steps and the artifacts of each task.
 *
 * The reference SDK keeps its tasks in memory only, and so does this store.
 * It is internal on purpose: the package offers no pluggable store.
 */
import { Array as Arr, Chunk, Effect, HashMap, Option, Ref } from 'effect';
import { NotFound } from '../Errors.js';
import type { StepHandler } from '../Handler.js';
import type { Artifact, Step, StepId, Task, TaskId } from '../Schemas.js';

/** One task, its step handler, and its steps in execution order. */
export interface TaskEntry {
  /** The task as the API returns it; its `artifacts` grow as steps and uploads add them. */
  readonly task: Task;
  /** The step handler that the task handler returned when the task was created. */
  readonly stepHandler: StepHandler;
  /** The completed steps, oldest first. A failed step never appears here. */
  readonly steps: Chunk.Chunk<Step>;
}

/**
 * The contents of the store. A `HashMap` does not keep insertion order, so
 * `order` records it separately; every id in `order` has an entry.
 */
interface State {
  /** The task ids in creation order, which the task list follows. */
  readonly order: Chunk.Chunk<TaskId>;
  /** The entry of each task, keyed by its id. */
  readonly entries: HashMap.HashMap<TaskId, TaskEntry>;
}

/** The operations of the store. */
export interface TaskStore {
  /** Records a new task with no steps. The caller supplies a fresh, unique id. */
  readonly add: (task: Task, stepHandler: StepHandler) => Effect.Effect<void>;
  /** All tasks in creation order. */
  readonly tasks: Effect.Effect<ReadonlyArray<Task>>;
  /** The entry of a task; fails with `NotFound` when the task is absent. */
  readonly require: (taskId: TaskId) => Effect.Effect<TaskEntry, NotFound>;
  /** One step of a task; fails with `NotFound` when the task or the step is absent. */
  readonly requireStep: (
    taskId: TaskId,
    stepId: StepId
  ) => Effect.Effect<Step, NotFound>;
  /** One artifact of a task; fails with `NotFound` when the task or the artifact is absent. */
  readonly requireArtifact: (
    taskId: TaskId,
    artifactId: Artifact['artifact_id']
  ) => Effect.Effect<Artifact, NotFound>;
  /**
   * Appends a completed step to its task and adds the step's artifacts to the
   * task. The task must exist: for an unknown `task_id` the call does nothing.
   */
  readonly appendStep: (step: Step) => Effect.Effect<void>;
  /**
   * Adds an uploaded artifact to a task. Like `appendStep`, it does nothing for
   * an unknown task, so the caller checks the task first.
   */
  readonly addArtifact: (
    taskId: TaskId,
    artifact: Artifact
  ) => Effect.Effect<void>;
}

/** The `NotFound` failure for a missing task, shared by every lookup that starts from a task id. */
const taskNotFound = (taskId: TaskId) =>
  new NotFound({ message: `Unable to find task with id ${taskId}` });

/**
 * Appends `artifacts` to the task of `entry`. It returns `entry` itself when
 * there is nothing to add, so a step without artifacts copies nothing.
 */
const withArtifacts = (
  entry: TaskEntry,
  artifacts: ReadonlyArray<Artifact>
): TaskEntry =>
  artifacts.length === 0
    ? entry
    : {
        ...entry,
        task: {
          ...entry.task,
          artifacts: [...entry.task.artifacts, ...artifacts],
        },
      };

/** Creates an empty store. */
export const makeTaskStore: Effect.Effect<TaskStore> = Effect.gen(function* () {
  const state = yield* Ref.make<State>({
    order: Chunk.empty(),
    entries: HashMap.empty(),
  });

  const update = (taskId: TaskId, f: (entry: TaskEntry) => TaskEntry) =>
    Ref.update(state, (current) => ({
      ...current,
      entries: HashMap.modify(current.entries, taskId, f),
    }));

  const require = (taskId: TaskId) =>
    Ref.get(state).pipe(
      Effect.map((current) => HashMap.get(current.entries, taskId)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(taskNotFound(taskId)),
          onSome: Effect.succeed,
        })
      )
    );

  return {
    add: (task, stepHandler) =>
      Ref.update(state, (current) => ({
        order: Chunk.append(current.order, task.task_id),
        entries: HashMap.set(current.entries, task.task_id, {
          task,
          stepHandler,
          steps: Chunk.empty(),
        }),
      })),
    tasks: Ref.get(state).pipe(
      Effect.map((current) =>
        Arr.getSomes(
          Chunk.map(current.order, (taskId) =>
            Option.map(
              HashMap.get(current.entries, taskId),
              (entry) => entry.task
            )
          )
        )
      )
    ),
    require,
    requireStep: (taskId, stepId) =>
      require(taskId).pipe(
        Effect.flatMap((entry) =>
          Option.match(
            Chunk.findFirst(entry.steps, (step) => step.step_id === stepId),
            {
              onNone: () =>
                Effect.fail(
                  new NotFound({
                    message: `Unable to find step with id ${stepId} in task ${taskId}`,
                  })
                ),
              onSome: Effect.succeed,
            }
          )
        )
      ),
    requireArtifact: (taskId, artifactId) =>
      require(taskId).pipe(
        Effect.flatMap((entry) =>
          Option.match(
            Option.fromUndefinedOr(
              entry.task.artifacts.find(
                (artifact) => artifact.artifact_id === artifactId
              )
            ),
            {
              onNone: () =>
                Effect.fail(
                  new NotFound({
                    message: `Unable to find artifact with id ${artifactId} in task ${taskId}`,
                  })
                ),
              onSome: Effect.succeed,
            }
          )
        )
      ),
    appendStep: (step) =>
      update(step.task_id, (entry) =>
        withArtifacts(
          { ...entry, steps: Chunk.append(entry.steps, step) },
          step.artifacts
        )
      ),
    addArtifact: (taskId, artifact) =>
      update(taskId, (entry) => withArtifacts(entry, [artifact])),
  };
});
