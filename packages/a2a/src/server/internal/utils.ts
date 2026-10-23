/**
 * Task state sets, page tokens and history trimming of the request handler
 * and the stores.
 *
 * @internal
 */
import { Effect, Result } from 'effect';
import { Base64 } from 'effect/encoding';
import { RequestMalformedError } from '../../errors/index.js';
import type {
  Message,
  SendMessageResult,
  Task,
  TaskState,
} from '../../Types.js';

/**
 * The terminal states: no further update may change a task in one.
 *
 * @internal
 */
export const TERMINAL_STATES: ReadonlyArray<TaskState> = [
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
];

/**
 * The interrupted states, in which the executor waits for the caller.
 *
 * @internal
 */
export const INTERRUPTED_STATES: ReadonlyArray<TaskState> = [
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED',
];

/** @internal */
export const isTerminal = (state: TaskState): boolean =>
  TERMINAL_STATES.includes(state);

/** @internal */
export const isTask = (result: SendMessageResult): result is Task =>
  'status' in result;

/** @internal */
export const isMessage = (result: SendMessageResult): result is Message =>
  'messageId' in result;

/**
 * Applies the `historyLength` of a request: absent keeps the whole history,
 * zero or less drops it, and N keeps the N most recent messages.
 *
 * @internal
 */
export const applyHistoryLength = (
  task: Task,
  historyLength: number | undefined
): Task =>
  historyLength === undefined
    ? task
    : {
        ...task,
        history:
          historyLength <= 0 ? [] : (task.history ?? []).slice(-historyLength),
      };

/**
 * Encodes the cursor of a task list page: the status timestamp and the id of
 * the last task of the page.
 *
 * @internal
 */
export const encodePageToken = (timestamp: string, id: string): string =>
  Base64.encode(`${timestamp}|${id}`);

/**
 * Decodes a page token made by {@link encodePageToken}.
 *
 * @internal
 */
export const decodePageToken = (
  pageToken: string
): Effect.Effect<
  { readonly timestamp: string; readonly id: string },
  RequestMalformedError
> => {
  const decoded = Base64.decodeString(pageToken);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new RequestMalformedError({
        message: 'Token is not a valid base64-encoded cursor.',
      })
    );
  }
  const [timestamp = '', ...idParts] = decoded.success.split('|');
  return idParts.length === 0
    ? Effect.fail(
        new RequestMalformedError({ message: 'Invalid page token format.' })
      )
    : Effect.succeed({ timestamp, id: idParts.join('|') });
};
