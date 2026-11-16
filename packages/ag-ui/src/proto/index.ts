/**
 * `@jambudipa/ag-ui/proto`: the protobuf binding of AG-UI 1.0, the media
 * type `application/vnd.ag-ui.event+proto`.
 *
 * Provide `AgUiProto.layer` to let the server answer a request that prefers
 * protobuf, and to let the client ask for it:
 *
 * ```ts
 * import { AgUiProto } from '@jambudipa/ag-ui/proto'
 *
 * AgUiRoute.layer(agent).pipe(Layer.provide(AgUiProto.layer))
 * ```
 *
 * This entry point loads `@bufbuild/protobuf`, an optional peer dependency.
 *
 * @since 0.1.0
 */
import { Layer } from 'effect';
import { AgUiProtoCodec } from '../ProtoCodec.js';
import { decodeFrames, encodeFrame } from './Framing.js';

export { MAX_FRAME_SIZE, decodeFrames, encodeFrame, frame } from './Framing.js';
export { decodeEventBytes, encodeEvent } from './Proto.js';
export { AgUiProtoCodec, PROTO_MEDIA_TYPE } from '../ProtoCodec.js';

/**
 * The protobuf codec as a layer.
 *
 * @since 0.1.0
 */
export const AgUiProto = {
  layer: Layer.succeed(
    AgUiProtoCodec,
    AgUiProtoCodec.of({ encodeFrame, decodeFrames })
  ),
};
