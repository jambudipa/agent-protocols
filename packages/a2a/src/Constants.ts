/**
 * Shared constants of the A2A protocol, with the names that `@a2a-js/sdk`
 * 1.3.0 exports.
 *
 * @since 0.1.0
 */

/**
 * The well-known path of the Agent Card, relative to the agent's base URL.
 *
 * @since 0.1.0
 */
export const AGENT_CARD_PATH = '.well-known/agent-card.json';

/**
 * The HTTP header (and gRPC metadata key) that lists the requested or the
 * activated extensions.
 *
 * @since 0.1.0
 */
export const HTTP_EXTENSION_HEADER = 'A2A-Extensions';

/**
 * The HTTP header (and gRPC metadata key) that carries the protocol version.
 *
 * @since 0.1.0
 */
export const A2A_VERSION_HEADER = 'A2A-Version';

/**
 * The protocol version that this package implements (Major.Minor).
 *
 * @since 0.1.0
 */
export const A2A_PROTOCOL_VERSION = '1.0';

/**
 * The legacy protocol version of the v0.3 compatibility layer. A request
 * without an `A2A-Version` header asks for this version.
 *
 * @since 0.1.0
 */
export const A2A_LEGACY_PROTOCOL_VERSION = '0.3';

/**
 * The known protocol versions.
 *
 * @since 0.1.0
 */
export const ProtocolVersion = {
  V0_3: A2A_LEGACY_PROTOCOL_VERSION,
  V1_0: A2A_PROTOCOL_VERSION,
} as const;

/**
 * @since 0.1.0
 */
export type ProtocolVersion =
  (typeof ProtocolVersion)[keyof typeof ProtocolVersion];

/**
 * The media type of HTTP+JSON responses and push notification bodies.
 *
 * @since 0.1.0
 */
export const A2A_CONTENT_TYPE = 'application/a2a+json';

/**
 * The media type of JSON-RPC requests and responses.
 *
 * @since 0.1.0
 */
export const JSON_CONTENT_TYPE = 'application/json';

/**
 * The protocol binding names of the specification.
 *
 * @since 0.1.0
 */
export const TransportProtocol = {
  JSONRPC: 'JSONRPC',
  HTTP_JSON: 'HTTP+JSON',
  GRPC: 'GRPC',
} as const;

/**
 * A protocol binding name. The specification keeps the set open.
 *
 * @since 0.1.0
 */
export type TransportProtocolName =
  (typeof TransportProtocol)[keyof typeof TransportProtocol] | (string & {});

/**
 * The default page size of `ListTasks`.
 *
 * @since 0.1.0
 */
export const DEFAULT_PAGE_SIZE = 50;
