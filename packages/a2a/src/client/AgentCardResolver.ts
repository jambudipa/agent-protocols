/**
 * The Agent Card resolver: fetches an agent's card from its well-known path.
 *
 * @since 0.1.0
 */
import { Effect, Option, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  AGENT_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
} from '../Constants.js';
import type { ClientError } from '../errors/index.js';
import { AgentCard } from '../Types.js';
import {
  decodeResponse,
  executeText,
  isOk,
  parseBody,
  transportError,
} from './internal/http.js';

/**
 * Turns a fetched card of another protocol version into a v1.0 card, or
 * `Option.none()` when the card is not of that version.
 *
 * @since 0.1.0
 */
export type LegacyCardParser = (
  card: Schema.Json
) => Option.Option<Effect.Effect<AgentCard, ClientError>>;

/**
 * Fetches and normalizes Agent Cards.
 *
 * @since 0.1.0
 */
export interface AgentCardResolver {
  /**
   * Fetches the card. The path is `path`, else the resolver's path, else
   * `/.well-known/agent-card.json`, resolved against `baseUrl`.
   */
  readonly resolve: (
    baseUrl: string,
    path?: string
  ) => Effect.Effect<AgentCard, ClientError>;
  /** Decodes a card in JSON form. */
  readonly normalizeAgentCard: (
    card: Schema.Json
  ) => Effect.Effect<AgentCard, ClientError>;
}

/**
 * The options of the default resolver.
 *
 * @since 0.1.0
 */
export interface AgentCardResolverOptions {
  /**
   * The card path to use when `resolve` gets none, relative to the base URL.
   * The default is `/.well-known/agent-card.json`.
   */
  readonly path?: string;
  /**
   * Accepts v0.3 cards. Use `parseLegacyAgentCard` of
   * `@jambudipa/a2a/compat/v0_3/client`.
   */
  readonly legacy?: LegacyCardParser;
}

/** Decodes a v1.0 card; a failure is an `HTTP` transport error. */
const decodeCard = decodeResponse(AgentCard, 'HTTP');

/**
 * The resolver of the reference SDK, on the `HttpClient` of the context. It
 * asks for protocol version 1.0.
 *
 * @since 0.1.0
 */
export const DefaultAgentCardResolver = {
  make: (
    options: AgentCardResolverOptions = {}
  ): Effect.Effect<AgentCardResolver, never, HttpClient.HttpClient> =>
    Effect.map(HttpClient.HttpClient, (httpClient) => {
      const normalizeAgentCard = (card: Schema.Json) =>
        Option.match(
          Option.flatMap(Option.fromUndefinedOr(options.legacy), (legacy) =>
            legacy(card)
          ),
          { onNone: () => decodeCard(card), onSome: (parsed) => parsed }
        );
      return {
        normalizeAgentCard,
        resolve: (baseUrl, path) =>
          Effect.gen(function* () {
            const url = yield* Effect.try({
              try: () =>
                new URL(path ?? options.path ?? AGENT_CARD_PATH, baseUrl),
              catch: (cause) =>
                transportError('HTTP', `Invalid Agent Card URL: ${baseUrl}`, {
                  cause,
                }),
            });
            const response = yield* executeText(
              httpClient,
              HttpClientRequest.get(url.toString()).pipe(
                HttpClientRequest.setHeader(
                  A2A_VERSION_HEADER,
                  A2A_PROTOCOL_VERSION
                )
              ),
              'HTTP'
            );
            if (!isOk(response.status)) {
              return yield* transportError(
                'HTTP',
                `Failed to fetch Agent Card from ${url.toString()}: ${response.status}`,
                { code: response.status }
              );
            }
            return yield* normalizeAgentCard(
              yield* parseBody(response.text, 'HTTP', 'Agent Card')
            );
          }),
      };
    }),
};
