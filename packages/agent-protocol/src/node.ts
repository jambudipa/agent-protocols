/**
 * A ready Agent Protocol server for Node.js, the Effect form of
 * `Agent.handleTask(taskHandler, { port, workspace }).start()` from npm
 * `agent-protocol` 1.0.5.
 *
 * ```ts
 * import { NodeRuntime } from "@effect/platform-node"
 * import { Layer } from "effect"
 * import * as AgentProtocolNode from "@agent-protocols/agent-protocol/node"
 *
 * Layer.launch(AgentProtocolNode.layer(taskHandler, { port: 8000 })).pipe(NodeRuntime.runMain)
 * ```
 *
 * @since 0.1.0
 */
import { NodeHttpServer } from '@effect/platform-node';
import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { createServer } from 'node:http';
import * as AgentProtocolServer from './AgentProtocolServer.js';
import type { TaskHandler } from './Handler.js';

/**
 * Options of the Node server.
 *
 * @since 0.1.0
 */
export interface Options extends AgentProtocolServer.Options {
  /** The port to listen on. The default is 8000, as in the reference SDK. */
  readonly port?: number;
}

/**
 * The default port.
 *
 * @since 0.1.0
 */
export const defaultPort = 8000;

/**
 * Serves the Agent Protocol with the given task handler on a Node HTTP server.
 * The server starts when the layer is built and stops when its scope closes.
 *
 * @since 0.1.0
 */
export const layer = (taskHandler: TaskHandler, options: Options = {}) =>
  HttpRouter.serve(AgentProtocolServer.layer(taskHandler, options)).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, { port: options.port ?? defaultPort })
    )
  );
