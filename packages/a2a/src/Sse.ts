/**
 * Server-Sent Events helpers shared by the JSON-RPC and HTTP+JSON bindings.
 *
 * @since 0.1.0
 */
import type { Schema } from 'effect';
import { Stream } from 'effect';
import { Sse } from 'effect/encoding';
import { stringifyJson } from './internal/json.js';

/**
 * The response headers of an SSE stream.
 *
 * @since 0.1.0
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/**
 * The largest SSE event that a client accepts, 4 MiB as in the reference SDK.
 *
 * @since 0.1.0
 */
export const DEFAULT_MAX_SSE_EVENT_SIZE_BYTES = 4 * 1024 * 1024;

/**
 * One parsed SSE event.
 *
 * @since 0.1.0
 */
export interface SseEvent {
  /** The `event:` name; `message` when the event names none. */
  readonly type: string;
  readonly data: string;
}

/**
 * Formats a data event.
 *
 * @since 0.1.0
 */
export const formatSSEEvent = (event: Schema.Json): string =>
  `data: ${stringifyJson(event)}\n\n`;

/**
 * Formats an `error` event, which a client tells apart from data events.
 *
 * @since 0.1.0
 */
export const formatSSEErrorEvent = (error: Schema.Json): string =>
  `event: error\ndata: ${stringifyJson(error)}\n\n`;

/**
 * Parses an SSE byte stream into events. The stream fails with
 * `Sse.SseError` when one event exceeds `maxEventSizeBytes`, which bounds the
 * memory that a hostile server can claim.
 *
 * @since 0.1.0
 */
export const parseSseStream = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>,
  maxEventSizeBytes: number = DEFAULT_MAX_SSE_EVENT_SIZE_BYTES
): Stream.Stream<SseEvent, E | Sse.SseError | Sse.Retry, R> =>
  body.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode({ maxEventSize: maxEventSizeBytes })),
    Stream.map((event) => ({ type: event.event, data: event.data }))
  );
