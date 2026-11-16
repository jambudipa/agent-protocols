/**
 * The failures of an AG-UI stream. Each cause has its own tag, so a caller
 * can tell bytes that do not decode from events that break the protocol
 * rules and from an HTTP exchange that went wrong.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';

/**
 * The wire did not decode: broken SSE framing, text that is not JSON, an
 * event that its schema rejects, or a protobuf frame that does not read.
 *
 * @since 0.1.0
 */
export class AgUiDecodeError extends Schema.TaggedError<AgUiDecodeError>()(
  'AgUiDecodeError',
  { message: Schema.String }
) {}

/**
 * The events decoded but break an ordering rule of the protocol, such as
 * content for a message that was never started. The message names the rule,
 * in the words of the reference client.
 *
 * @since 0.1.0
 */
export class AgUiVerifyError extends Schema.TaggedError<AgUiVerifyError>()(
  'AgUiVerifyError',
  {
    message: Schema.String,
    /** The `type` of the event that broke the rule. */
    eventType: Schema.String,
  }
) {}

/**
 * The agent answered with a status other than 2xx, before any event.
 *
 * @since 0.1.0
 */
export class AgUiHttpError extends Schema.TaggedError<AgUiHttpError>()(
  'AgUiHttpError',
  {
    message: Schema.String,
    /** The HTTP status code. */
    status: Schema.Number,
    /** The response body, as text. */
    body: Schema.String,
  }
) {}

/**
 * The request did not reach the agent, or the response broke off: a network
 * failure rather than an answer.
 *
 * @since 0.1.0
 */
export class AgUiTransportError extends Schema.TaggedError<AgUiTransportError>()(
  'AgUiTransportError',
  { message: Schema.String }
) {}

/**
 * Every failure of `AgUiClient.run`.
 *
 * @since 0.1.0
 */
export type AgUiClientError =
  | AgUiDecodeError
  | AgUiVerifyError
  | AgUiHttpError
  | AgUiTransportError;
