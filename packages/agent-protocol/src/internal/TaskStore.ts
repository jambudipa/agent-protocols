/**
 * The in-memory task store of the server. It keeps tasks in creation order,
 * with the step handler, the steps and the artifacts of each task.
 *
 * The reference SDK keeps its tasks in memory only, and so does this store.
 * It is internal on purpose: the package offers no pluggable store.
 */
import { Array as Arr, Chunk, Effect, HashMap, Option, Ref } from "effect"
import { NotFound } from "../Errors.js"
import type { StepHandler } from "../Handler.js"
import type { Artifact, Step, StepId, Task, TaskId } from "../Schemas.js"

/** One task, its step handler, and its steps in execution order. */
export interface TaskEntry {
  readonly task: Task
  readonly stepHandler: StepHandler
  readonly steps: Chunk.Chunk<Step>
}

interface State {
  readonly order: Chunk.Chunk<TaskId>
  readonly entries: HashMap.HashMap<TaskId, TaskEntry>
}

/** The operations of the store. */
export interface TaskStore {
  readonly add: (task: Task, stepHandler: StepHandler) => Effect.Effect<void>
  readonly tasks: Effect.Effect<ReadonlyArray<Task>>
  readonly require: (taskId: TaskId) => Effect.Effect<TaskEntry, NotFound>
  readonly requireStep: (taskId: TaskId, stepId: StepId) => Effect.Effect<Step, NotFound>
  readonly requireArtifact: (taskId: TaskId, artifactId: Artifact["artifact_id"]) => Effect.Effect<Artifact, NotFound>
  readonly appendStep: (step: Step) => Effect.Effect<void>
  readonly addArtifact: (taskId: TaskId, artifact: Artifact) => Effect.Effect<void>
}

const taskNotFound = (taskId: TaskId) => new NotFound({ message: `Unable to find task with id ${taskId}` })

const withArtifacts = (entry: TaskEntry, artifacts: ReadonlyArray<Artifact>): TaskEntry =>
  artifacts.length === 0
    ? entry
    : { ...entry, task: { ...entry.task, artifacts: [...entry.task.artifacts, ...artifacts] } }

/** Creates an empty store. */
export const makeTaskStore: Effect.Effect<TaskStore> = Effect.gen(function*() {
  const state = yield* Ref.make<State>({ order: Chunk.empty(), entries: HashMap.empty() })

  const update = (taskId: TaskId, f: (entry: TaskEntry) => TaskEntry) =>
    Ref.update(state, (current) => ({
      ...current,
      entries: HashMap.modify(current.entries, taskId, f)
    }))

  const require = (taskId: TaskId) =>
    Ref.get(state).pipe(
      Effect.map((current) => HashMap.get(current.entries, taskId)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(taskNotFound(taskId)),
        onSome: Effect.succeed
      }))
    )

  return {
    add: (task, stepHandler) =>
      Ref.update(state, (current) => ({
        order: Chunk.append(current.order, task.task_id),
        entries: HashMap.set(current.entries, task.task_id, { task, stepHandler, steps: Chunk.empty() })
      })),
    tasks: Ref.get(state).pipe(
      Effect.map((current) =>
        Arr.getSomes(
          Chunk.map(current.order, (taskId) => Option.map(HashMap.get(current.entries, taskId), (entry) => entry.task))
        )
      )
    ),
    require,
    requireStep: (taskId, stepId) =>
      require(taskId).pipe(
        Effect.flatMap((entry) =>
          Option.match(Chunk.findFirst(entry.steps, (step) => step.step_id === stepId), {
            onNone: () =>
              Effect.fail(new NotFound({ message: `Unable to find step with id ${stepId} in task ${taskId}` })),
            onSome: Effect.succeed
          })
        )
      ),
    requireArtifact: (taskId, artifactId) =>
      require(taskId).pipe(
        Effect.flatMap((entry) =>
          Option.match(
            Option.fromUndefinedOr(entry.task.artifacts.find((artifact) => artifact.artifact_id === artifactId)),
            {
              onNone: () =>
                Effect.fail(
                  new NotFound({ message: `Unable to find artifact with id ${artifactId} in task ${taskId}` })
                ),
              onSome: Effect.succeed
            }
          )
        )
      ),
    appendStep: (step) =>
      update(step.task_id, (entry) => withArtifacts({ ...entry, steps: Chunk.append(entry.steps, step) }, step.artifacts)),
    addArtifact: (taskId, artifact) => update(taskId, (entry) => withArtifacts(entry, [artifact]))
  }
})
