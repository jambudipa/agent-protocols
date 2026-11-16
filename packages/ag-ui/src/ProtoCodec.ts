/**
 * The seam between the transports and the protobuf binding.
 *
 * The server and the client speak protobuf only through this service, so
 * neither loads `@bufbuild/protobuf` unless the application provides
 * `AgUiProto.layer` from `@jambudipa/ag-ui/proto`. Without it the server
 * always answers with SSE, and the client cannot ask for protobuf.
 *
 * @since 0.1.0
 */
import type { Effect, Stream } from 'effect';
import { Context } from 'effect';
import type { AgUiDecodeError, AgUiEncodeError } from './Errors.js';
import type { AgUiEvent } from './Events.js';

/**
 * The media type of a protobuf event stream: each event is a 4-byte
 * big-endian length followed by the bytes of one `ag_ui.Event`.
 *
 * @since 0.1.0
 */
export const PROTO_MEDIA_TYPE = 'application/vnd.ag-ui.event+proto';

/**
 * Encodes events to length-prefixed protobuf frames and decodes a byte
 * stream of such frames back into events.
 *
 * @since 0.1.0
 */
export class AgUiProtoCodec extends Context.Service<
  AgUiProtoCodec,
  {
    /** Encodes one event as one length-prefixed frame. */
    readonly encodeFrame: (
      event: AgUiEvent
    ) => Effect.Effect<Uint8Array, AgUiEncodeError>;
    /** Splits a byte stream into frames and decodes each into an event. */
    readonly decodeFrames: <E, R>(
      body: Stream.Stream<Uint8Array, E, R>
    ) => Stream.Stream<AgUiEvent, E | AgUiDecodeError, R>;
  }
>()('@jambudipa/ag-ui/ProtoCodec/AgUiProtoCodec') {}
