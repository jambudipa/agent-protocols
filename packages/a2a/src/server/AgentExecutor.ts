/**
 * The agent executor: the agent logic behind an A2A server.
 *
 * @since 0.1.0
 */
import { Context, Schema } from 'effect';
import type { Effect } from 'effect';
import type { ExecutionEventBus } from './ExecutionEventBus.js';
import type { RequestContext } from './RequestContext.js';

/**
 * The agent logic failed. The request handler records the failure as a
 * `TASK_STATE_FAILED` task whose status message carries `message`.
 *
 * @since 0.1.0
 */
export class AgentExecutionError extends Schema.TaggedError<AgentExecutionError>()(
  'AgentExecutionError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * Runs the agent for a message and cancels a running task.
 *
 * `execute` publishes events to the bus: first a task or a message, then,
 * for a task, status and artifact updates. The handler persists each event,
 * streams it and sends it to the push webhooks. A failure, or a defect,
 * before any event becomes a failed task.
 *
 * `cancelTask` asks a running execution to stop; it should publish a
 * `TASK_STATE_CANCELED` status update. Once the task is canceled, the
 * handler interrupts the fiber of `execute`.
 *
 * @since 0.1.0
 */
export class AgentExecutor extends Context.Service<
  AgentExecutor,
  {
    readonly execute: (
      context: RequestContext,
      eventBus: ExecutionEventBus
    ) => Effect.Effect<void, AgentExecutionError>;
    readonly cancelTask: (
      taskId: string,
      eventBus: ExecutionEventBus
    ) => Effect.Effect<void, AgentExecutionError>;
  }
>()('@jambudipa/a2a/server/AgentExecutor') {}
