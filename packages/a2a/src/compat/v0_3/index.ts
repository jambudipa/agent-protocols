/**
 * The A2A v0.3 compatibility layer: the v0.3 data model, its translation to
 * and from v1.0, the v0.3 Agent Card and the method name maps.
 *
 * A v1.0 server serves v0.3 clients with `legacyCompat` of
 * `@jambudipa/a2a/compat/v0_3/server`; a v1.0 client calls v0.3 agents with
 * the transports of `@jambudipa/a2a/compat/v0_3/client`. Both work over the
 * v1.0 request handler and client. This entry point loads no gRPC or
 * protobuf code.
 *
 * @since 0.1.0
 */
export * from './AgentCard.js';
export * from './Constants.js';
export * from './Errors.js';
export * from './PushNotification.js';
export * as Proto from './proto.js';
export * as ProtoTypes from './ProtoTypes.js';
export * as Translate from './translate.js';
export * as V03 from './Types.js';
