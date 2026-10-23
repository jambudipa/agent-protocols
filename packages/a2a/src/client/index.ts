/**
 * The A2A client: the client factory, the client, the JSON-RPC and
 * HTTP+JSON transports, the Agent Card resolver, call interceptors and
 * authentication with retry.
 *
 * This entry point loads no gRPC, protobuf, `jose` or SQL code. The gRPC
 * transport is `@jambudipa/a2a/client/grpc`.
 *
 * @since 0.1.0
 */
export * from './AgentCardResolver.js';
export * from './Authentication.js';
export * from './Client.js';
export * from './ClientFactory.js';
export * from './Interceptor.js';
export * from './JsonRpcTransport.js';
export * from './RestTransport.js';
export * from './ServiceParameters.js';
export * from './TenantTransport.js';
export {
  type CallOptions,
  type Transport,
  type TransportFactory,
  pickMatchingInterface,
} from './Transport.js';
