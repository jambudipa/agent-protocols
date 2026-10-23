/**
 * Reading v0.3 push notification bodies.
 *
 * @since 0.1.0
 */
import { Effect, Schema } from 'effect';
import { RequestMalformedError } from '../../errors/index.js';
import type { StreamResponse } from '../../Types.js';
import { toCoreStreamResponse } from './translate.js';
import { StreamEvent } from './Types.js';

const decodeEvent = Schema.decodeUnknownEffect(StreamEvent);

/**
 * The v1.0 stream event of a v0.3 push notification body: a task, a
 * message, a status update or an artifact update, told apart by `kind`.
 *
 * @since 0.1.0
 */
export const legacyPushNotificationToV1StreamResponse = (
  body: unknown
): Effect.Effect<StreamResponse, RequestMalformedError> =>
  decodeEvent(body).pipe(
    Effect.mapError(
      (error) =>
        new RequestMalformedError({
          message: `Unrecognized v0.3 push notification body: ${error.message}`,
        })
    ),
    Effect.flatMap(toCoreStreamResponse)
  );
