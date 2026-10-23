/**
 * What an agent executor learns about the message it handles.
 *
 * @since 0.1.0
 */
import type { Option } from 'effect';
import type { Message, SendMessageRequest, Task } from '../Types.js';
import type { ServerCallContext } from './ServerCallContext.js';

/**
 * The context of one execution. The request handler resolves the task and
 * context ids before the executor runs: `userMessage.taskId` and
 * `userMessage.contextId` are always set.
 *
 * @since 0.1.0
 */
export interface RequestContext {
  /** The request, with the resolved ids set on its message. */
  readonly request: SendMessageRequest;
  /** The message of the request. */
  readonly userMessage: Message;
  readonly taskId: string;
  readonly contextId: string;
  /** The existing task that the message continues, if any. */
  readonly task: Option.Option<Task>;
  /** The tasks that the message references, when it references any. */
  readonly referenceTasks: Option.Option<ReadonlyArray<Task>>;
  /** The call context of the request. */
  readonly context: ServerCallContext;
}
