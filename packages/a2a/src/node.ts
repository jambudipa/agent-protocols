/**
 * A ready A2A server for Node.js: the HTTP bindings on a Node HTTP server.
 *
 * ```ts
 * import { NodeRuntime } from '@effect/platform-node'
 * import { Layer } from 'effect'
 * import { InMemoryTaskStore } from '@jambudipa/a2a/server'
 * import * as A2ANode from '@jambudipa/a2a/node'
 *
 * A2ANode.layerAgent({ agentCard, port: 41241 }).pipe(
 *   Layer.provide([InMemoryTaskStore.layer, MyExecutor.layer]),
 *   Layer.launch,
 *   NodeRuntime.runMain
 * )
 * ```
 *
 * @since 0.1.0
 */
import { NodeCrypto, NodeHttpServer } from '@effect/platform-node';
import { Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { createServer } from 'node:http';
import {
  A2AHttpRoutes,
  type A2AHttpRoutesOptions,
} from './server/HttpRoutes.js';
import {
  DefaultRequestHandler,
  type DefaultRequestHandlerOptions,
} from './server/RequestHandler.js';

/**
 * The options of the Node server.
 *
 * @since 0.1.0
 */
export interface Options extends A2AHttpRoutesOptions {
  /** The port to listen on. The default is 41241, as in the reference samples. */
  readonly port?: number;
  /** The host to listen on. The default is all interfaces. */
  readonly host?: string;
  /** Logs every request. The default is `false`. */
  readonly logRequests?: boolean;
}

/**
 * The default port.
 *
 * @since 0.1.0
 */
export const defaultPort = 41241;

/**
 * Serves the HTTP bindings of the provided `A2ARequestHandler` on a Node
 * HTTP server. The server starts when the layer is built and stops when its
 * scope closes. It provides `Crypto` for the routes.
 *
 * @since 0.1.0
 */
export const layer = (options: Options = {}) =>
  HttpRouter.serve(A2AHttpRoutes.layer(options), {
    disableLogger: options.logRequests !== true,
  }).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, {
        port: options.port ?? defaultPort,
        ...(options.host === undefined ? {} : { host: options.host }),
      })
    ),
    Layer.provide(NodeCrypto.layer)
  );

/**
 * Serves an agent: the default request handler with the given card and the
 * provided task store and executor, on a Node HTTP server. Push
 * notifications, when the card enables them, go out through the fetch
 * `HttpClient`.
 *
 * @since 0.1.0
 */
export const layerAgent = (options: Options & DefaultRequestHandlerOptions) =>
  layer(options).pipe(
    Layer.provide(DefaultRequestHandler.layer(options)),
    Layer.provide(Layer.mergeAll(NodeCrypto.layer, FetchHttpClient.layer))
  );
