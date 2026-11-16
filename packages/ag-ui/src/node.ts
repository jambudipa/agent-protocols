/**
 * A ready AG-UI server for Node.js: the AG-UI route on a Node HTTP server.
 *
 * ```ts
 * import { NodeRuntime } from '@effect/platform-node'
 * import { Layer } from 'effect'
 * import * as AgUiNode from '@jambudipa/ag-ui/node'
 *
 * Layer.launch(AgUiNode.layer(agent, { port: 8000, path: '/agent' })).pipe(
 *   NodeRuntime.runMain
 * )
 * ```
 *
 * Add `Layer.provide(AgUiProto.layer)` from `@jambudipa/ag-ui/proto` to serve
 * protobuf as well as SSE.
 *
 * @since 0.1.0
 */
import { NodeHttpServer } from '@effect/platform-node';
import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { createServer } from 'node:http';
import {
  type Agent,
  AgUiRoute,
  type AgUiRouteOptions,
} from './server/AgUiRoute.js';

/**
 * The options of the Node server.
 *
 * @since 0.1.0
 */
export interface Options extends AgUiRouteOptions {
  /** The port to listen on. The default is 8000. */
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
export const defaultPort = 8000;

/**
 * Serves an agent on a Node HTTP server. The server starts when the layer
 * is built and stops when its scope closes.
 *
 * @since 0.1.0
 */
export const layer = <E, R>(agent: Agent<E, R>, options: Options = {}) =>
  HttpRouter.serve(AgUiRoute.layer(agent, options), {
    disableLogger: options.logRequests !== true,
  }).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, {
        port: options.port ?? defaultPort,
        ...(options.host === undefined ? {} : { host: options.host }),
      })
    )
  );
