/**
 * All HTTP bindings of an A2A server in one layer: the Agent Card route, the
 * JSON-RPC route and the HTTP+JSON routes.
 *
 * @since 0.1.0
 */
import type { Crypto } from 'effect';
import { Layer } from 'effect';
import type { HttpRouter } from 'effect/http';
import {
  AgentCardRoute,
  type AgentCardRouteOptions,
} from './AgentCardRoute.js';
import type { HttpBindingOptions } from './internal/http.js';
import { JsonRpcRoute } from './JsonRpc.js';
import type { LegacyCompat } from './LegacyCompat.js';
import type { A2ARequestHandler } from './RequestHandler.js';
import { RestRoutes } from './Rest.js';

/**
 * The options of {@link A2AHttpRoutes}. Set a binding to `false` to leave
 * it out.
 *
 * @since 0.1.0
 */
export interface A2AHttpRoutesOptions extends HttpBindingOptions {
  /** The JSON-RPC path. The default is `/`. */
  readonly jsonRpcPath?: HttpRouter.PathInput | false;
  /** The prefix of the HTTP+JSON routes. The default is none. */
  readonly restPrefix?: string | false;
  /** The Agent Card route. */
  readonly agentCard?: Omit<AgentCardRouteOptions, 'legacyCompat'> | false;
  /** Serves protocol 0.3 too, on every binding. */
  readonly legacyCompat?: LegacyCompat;
}

/**
 * The HTTP bindings of an A2A server on the `HttpRouter`.
 *
 * ```ts
 * HttpRouter.serve(A2AHttpRoutes.layer()).pipe(
 *   Layer.provide(DefaultRequestHandler.layer({ agentCard })),
 *   Layer.provide([InMemoryTaskStore.layer, MyExecutor.layer]),
 *   Layer.provide(NodeHttpServer.layer(createServer, { port: 41241 }))
 * )
 * ```
 *
 * @since 0.1.0
 */
export const A2AHttpRoutes = {
  layer: (
    options: A2AHttpRoutesOptions = {}
  ): Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | A2ARequestHandler | Crypto.Crypto
  > => {
    const shared = {
      ...(options.userBuilder === undefined
        ? {}
        : { userBuilder: options.userBuilder }),
      ...(options.legacyCompat === undefined
        ? {}
        : { legacyCompat: options.legacyCompat }),
    };
    const layers = [
      ...(options.agentCard === false
        ? []
        : [AgentCardRoute.layer({ ...options.agentCard, ...shared })]),
      ...(options.jsonRpcPath === false
        ? []
        : [
            JsonRpcRoute.layer({
              ...shared,
              path: options.jsonRpcPath ?? '/',
            }),
          ]),
      ...(options.restPrefix === false
        ? []
        : [RestRoutes.layer({ ...shared, prefix: options.restPrefix ?? '' })]),
    ];
    return Layer.mergeAll(Layer.empty, ...layers);
  },
};
