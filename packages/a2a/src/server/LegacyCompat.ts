/**
 * The hooks through which the v0.3 compatibility layer joins the HTTP
 * bindings. `@jambudipa/a2a/compat/v0_3/server` exports the implementation;
 * this module only names its shape, so `@jambudipa/a2a/server` loads no
 * compatibility code.
 *
 * @since 0.1.0
 */
import type { Effect, Schema } from 'effect';
import type { HttpRouter } from 'effect/http';
import type { AgentCard } from '../Types.js';
import type { HttpBindingOptions } from './internal/http.js';
import type { JsonRpcDispatcher } from './JsonRpc.js';
import type { A2ARequestHandler } from './RequestHandler.js';

/**
 * The legacy protocol support of the HTTP bindings.
 *
 * @since 0.1.0
 */
export interface LegacyCompat {
  /** The dispatcher of v0.3 JSON-RPC methods (`message/send`, ...). */
  readonly jsonRpcDispatcher: (
    handler: A2ARequestHandler['Service']
  ) => JsonRpcDispatcher;
  /** The v0.3 HTTP+JSON routes (`/v1/...`) under `prefix`. */
  readonly restRoutes: (
    handler: A2ARequestHandler['Service'],
    options: HttpBindingOptions & { readonly prefix: string }
  ) => ReadonlyArray<HttpRouter.Route<never, never>>;
  /**
   * The Agent Card response for a request of a legacy version: the v0.3
   * card, or an error body when the card cannot be expressed in v0.3.
   */
  readonly agentCard: (card: AgentCard) => Effect.Effect<LegacyCardResponse>;
}

/**
 * The body of a legacy Agent Card response.
 *
 * @since 0.1.0
 */
export interface LegacyCardResponse {
  /** The HTTP status: 200 for a card, an error status otherwise. */
  readonly status: number;
  /** The `Content-Type` of the response. */
  readonly contentType: string;
  /** The JSON body; the route stringifies it and hashes it for the ETag. */
  readonly body: Schema.Json;
}
