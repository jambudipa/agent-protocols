/**
 * The client side of the A2A v0.3 compatibility layer: v0.3 JSON-RPC and
 * HTTP+JSON transports, and v0.3 card parsing, for the v1.0 client.
 *
 * ```ts
 * const factory = yield* LegacyCompatClient.clientFactory()
 * const client = yield* factory.createFromUrl('http://localhost:41241')
 * ```
 *
 * The client factory picks the v0.3 transport for an interface that declares
 * protocol version 0.3, and the v1.0 transport otherwise. This entry point
 * loads no gRPC or protobuf code.
 *
 * @since 0.1.0
 */
import { Effect, Option } from 'effect';
import type { HttpClient } from 'effect/http';
import {
  type AgentCardResolver,
  DefaultAgentCardResolver,
  type LegacyCardParser,
} from '../../../client/AgentCardResolver.js';
import {
  ClientFactory,
  type ClientFactoryOptions,
} from '../../../client/ClientFactory.js';
import { JsonRpcTransportFactory } from '../../../client/JsonRpcTransport.js';
import { RestTransportFactory } from '../../../client/RestTransport.js';
import type { TransportFactory } from '../../../client/Transport.js';
import { A2ATransportError } from '../../../errors/index.js';
import { isLegacyVersion } from '../../../internal/version.js';
import { isLegacyAgentCard, parseLegacyAgentCard } from '../AgentCard.js';
import { legacyJsonRpcTransport } from './JsonRpcTransport.js';
import { legacyRestTransport } from './RestTransport.js';

export { isLegacyAgentCard, parseLegacyAgentCard } from '../AgentCard.js';
export * from './JsonRpcTransport.js';
export * from './RestTransport.js';

/**
 * The card parser of the resolver: a v0.3 card becomes a v1.0 card; any
 * other card is left to the v1.0 decoder.
 *
 * @since 0.1.0
 */
export const legacyCardParser: LegacyCardParser = (card) =>
  isLegacyAgentCard(card)
    ? Option.some(
        parseLegacyAgentCard(card).pipe(
          Effect.mapError(
            (error) =>
              new A2ATransportError({
                message: error.message,
                protocol: 'HTTP',
              })
          )
        )
      )
    : Option.none();

/**
 * Factories and a resolver that also speak protocol 0.3.
 *
 * @since 0.1.0
 */
export const LegacyCompatClient = {
  /** A JSON-RPC factory that picks the v0.3 transport for a 0.3 interface. */
  jsonRpcTransportFactory: (): Effect.Effect<
    TransportFactory,
    never,
    HttpClient.HttpClient
  > =>
    JsonRpcTransportFactory.make({
      legacy: legacyJsonRpcTransport,
      isLegacyVersion,
    }),
  /** An HTTP+JSON factory that picks the v0.3 transport for a 0.3 interface. */
  restTransportFactory: (): Effect.Effect<
    TransportFactory,
    never,
    HttpClient.HttpClient
  > =>
    RestTransportFactory.make({
      legacy: legacyRestTransport,
      isLegacyVersion,
    }),
  /** A card resolver that accepts v0.3 cards. */
  cardResolver: (
    path?: string
  ): Effect.Effect<AgentCardResolver, never, HttpClient.HttpClient> =>
    DefaultAgentCardResolver.make(
      path === undefined
        ? { legacy: legacyCardParser }
        : { legacy: legacyCardParser, path }
    ),
  /**
   * A client factory with the factories and the resolver above; the given
   * options add transports and override the rest.
   */
  clientFactory: (
    options: ClientFactoryOptions = {}
  ): Effect.Effect<ClientFactory, A2ATransportError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const jsonRpc = yield* LegacyCompatClient.jsonRpcTransportFactory();
      const rest = yield* LegacyCompatClient.restTransportFactory();
      const cardResolver =
        options.cardResolver ?? (yield* LegacyCompatClient.cardResolver());
      const names = (options.transports ?? []).map((factory) =>
        factory.protocolName.toUpperCase()
      );
      return yield* ClientFactory.make({
        ...options,
        cardResolver,
        transports: [
          ...[jsonRpc, rest].filter(
            (factory) => !names.includes(factory.protocolName.toUpperCase())
          ),
          ...(options.transports ?? []),
        ],
      });
    }),
};
