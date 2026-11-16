/**
 * The length-prefixed framing of a protobuf event stream: each frame is a
 * 4-byte big-endian length, then that many bytes of one `ag_ui.Event`, as
 * `@ag-ui/encoder` writes and `@ag-ui/client` reads.
 *
 * @since 0.1.0
 */
import { Effect, Option, Stream } from 'effect';
import { AgUiDecodeError } from '../Errors.js';
import type { AgUiEncodeError } from '../Errors.js';
import type { AgUiEvent } from '../Events.js';
import { decodeEventBytes, encodeEvent } from './Proto.js';

/**
 * The largest frame that a reader accepts, 10 MiB as in the reference
 * client. A larger declared length fails at once, before its bytes arrive.
 *
 * @since 0.1.0
 */
export const MAX_FRAME_SIZE = 10 * 1024 * 1024;

/** Joins two byte arrays. */
const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
};

/** The big-endian length at the start of a buffer. */
const lengthOf = (buffer: Uint8Array): number =>
  new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, false);

/**
 * Prefixes the bytes of one event with their length.
 *
 * @since 0.1.0
 */
export const frame = (message: Uint8Array): Uint8Array => {
  const framed = new Uint8Array(4 + message.length);
  new DataView(framed.buffer).setUint32(0, message.length, false);
  framed.set(message, 4);
  return framed;
};

/**
 * Encodes one event as one length-prefixed frame.
 *
 * @since 0.1.0
 */
export const encodeFrame = (
  event: AgUiEvent
): Effect.Effect<Uint8Array, AgUiEncodeError> =>
  Effect.map(encodeEvent(event), frame);

/** Splits a buffer into its complete frames and the remainder. */
const splitFrames = (
  buffer: Uint8Array
): Effect.Effect<
  readonly [rest: Uint8Array, frames: ReadonlyArray<Uint8Array>],
  AgUiDecodeError
> =>
  Effect.gen(function* () {
    let rest = buffer;
    let frames: ReadonlyArray<Uint8Array> = [];
    while (rest.length >= 4) {
      const total = 4 + lengthOf(rest);
      if (total > MAX_FRAME_SIZE) {
        return yield* new AgUiDecodeError({
          message: `A protobuf frame exceeds the ${MAX_FRAME_SIZE} byte limit.`,
        });
      }
      if (rest.length < total) break;
      frames = [...frames, rest.slice(4, total)];
      rest = rest.slice(total);
    }
    return [rest, frames] as const;
  });

/**
 * Splits a byte stream into length-prefixed frames and decodes each into an
 * event. A stream that ends inside a frame fails rather than lose the
 * event.
 *
 * @since 0.1.0
 */
export const decodeFrames = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>
): Stream.Stream<AgUiEvent, E | AgUiDecodeError, R> =>
  body.pipe(
    Stream.map(Option.some),
    Stream.concat(Stream.succeed(Option.none<Uint8Array>())),
    Stream.mapAccumEffect(
      () => new Uint8Array(0),
      (buffer: Uint8Array, chunk: Option.Option<Uint8Array>) =>
        Option.match(chunk, {
          onSome: (bytes) => splitFrames(concat(buffer, bytes)),
          onNone: () =>
            buffer.length > 0
              ? Effect.fail(
                  new AgUiDecodeError({
                    message: `The binary stream ended mid-frame: ${buffer.length} trailing bytes could not be read as a complete message.`,
                  })
                )
              : Effect.succeed([buffer, []] as const),
        })
    ),
    Stream.mapEffect(decodeEventBytes)
  );
