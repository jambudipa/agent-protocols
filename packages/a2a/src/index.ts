/**
 * The common part of `@jambudipa/a2a`: the A2A v1.0 data model, constants,
 * extension helpers, SSE helpers and Agent Card signatures.
 *
 * Import `@jambudipa/a2a/server` for a server and `@jambudipa/a2a/client`
 * for a client. This entry point loads no gRPC, protobuf, `jose` or SQL code.
 *
 * @since 0.1.0
 */
export * from './Types.js';
export * from './Constants.js';
export * as Extensions from './Extensions.js';
export * from './Sse.js';
export * from './Signature.js';
