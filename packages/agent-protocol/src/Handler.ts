/**
 * The agent side of the protocol: the handlers that an agent supplies.
 *
 * The shape keeps parity with npm `agent-protocol` 1.0.5. A task handler runs
 * once for each new task and returns the step handler for that task. The step
 * handler runs once for each executed step.
 *
 * @since 0.1.0
 */
import { Effect, Option, Schema } from 'effect';
import type { StepFailed, TaskFailed } from './Errors.js';
import { Artifact, StepOutput } from './Schemas.js';
import type { StepRequestBody, Task } from './Schemas.js';

/**
 * What a step handler returns. Construct it with `new StepResult({ ... })` and
 * give only the fields you need: `name`, `output` and `additional_output`
 * default to `Option.none()`, `artifacts` to none, and `is_last` to `false`.
 *
 * An artifact in `artifacts` is metadata. As in the reference SDK, the agent
 * writes the file itself, at `<workspace>/<task_id>/<relative_path>/<file_name>`,
 * so that the download operation can serve it.
 *
 * @since 0.1.0
 */
export class StepResult extends Schema.Class<StepResult>('StepResult')({
  name: Schema.Option(Schema.String).pipe(
    Schema.withConstructorDefault(Effect.succeed(Option.none()))
  ),
  output: Schema.Option(Schema.String).pipe(
    Schema.withConstructorDefault(Effect.succeed(Option.none()))
  ),
  additional_output: Schema.Option(StepOutput).pipe(
    Schema.withConstructorDefault(Effect.succeed(Option.none()))
  ),
  artifacts: Schema.Array(Artifact).pipe(
    Schema.withConstructorDefault(Effect.succeed([]))
  ),
  is_last: Schema.Boolean.pipe(
    Schema.withConstructorDefault(Effect.succeed(false))
  ),
}) {}

/**
 * Executes one step of a task. It receives the request body of the step, or
 * `Option.none()` when the request has no body.
 *
 * @since 0.1.0
 */
export type StepHandler = (
  input: Option.Option<StepRequestBody>
) => Effect.Effect<StepResult, StepFailed>;

/**
 * Starts a task and returns the step handler for it.
 *
 * @since 0.1.0
 */
export type TaskHandler = (
  task: Task
) => Effect.Effect<StepHandler, TaskFailed>;
