/**
 * Test support: an AG-UI server on an ephemeral port, the URL to reach it,
 * and raw routes that answer with fixed bytes, for the cases that a
 * conforming server never produces.
 */
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import { AgUiProto } from '../src/proto/index.js';
import { type Agent, AgUiRoute } from '../src/server/index.js';

/** The path that the test servers serve the agent on. */
export const AGENT_PATH = '/agent';

/** The base URL of the test server. */
export const serverUrl = Effect.map(HttpServer.HttpServer, (server) =>
  server.address._tag === 'UnixPathAddress'
    ? ''
    : `http://127.0.0.1:${server.address.port}`
);

/**
 * Serves `agent` at `AGENT_PATH`, with protobuf when `proto` is set, and
 * provides the `HttpClient` with the server URL prepended.
 */
export const testServer = <E, R>(
  agent: Agent<E, R>,
  options: { readonly proto?: boolean } = {}
) => {
  const route = AgUiRoute.layer(agent, { path: AGENT_PATH });
  return HttpRouter.serve(
    options.proto === true ? Layer.provide(route, AgUiProto.layer) : route,
    { disableLogger: true }
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
};

/** A route that answers every POST with fixed bytes. */
export const rawServer = (body: Uint8Array | string, contentType: string) =>
  HttpRouter.serve(
    HttpRouter.use((router) =>
      router.add('POST', AGENT_PATH, () =>
        Effect.succeed(
          typeof body === 'string'
            ? HttpServerResponse.text(body, { contentType })
            : HttpServerResponse.uint8Array(body, { contentType })
        )
      )
    ),
    { disableLogger: true }
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
