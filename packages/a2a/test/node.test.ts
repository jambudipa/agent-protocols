/**
 * The Node server layer serves the agent card and the JSON-RPC binding.
 */
import { assert, it } from '@effect/vitest';
import { Effect, Layer, Random } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { InMemoryTaskStore } from '../src/server/index.js';
import * as A2ANode from '../src/node.js';
import { at, encodeJsonText } from './http.js';
import { EchoExecutor, echoCard } from './support.js';

it.live('serves an agent on a Node HTTP server', () =>
  Effect.gen(function* () {
    const port = 47_000 + (yield* Random.nextIntBetween(0, 1000));
    const url = `http://127.0.0.1:${port}`;
    yield* Layer.build(
      A2ANode.layerAgent({
        agentCard: echoCard(url),
        port,
        host: '127.0.0.1',
      }).pipe(Layer.provide([InMemoryTaskStore.layer, EchoExecutor]))
    );
    const http = yield* HttpClient.HttpClient;
    const card = yield* http.execute(
      HttpClientRequest.get(`${url}/.well-known/agent-card.json`)
    );
    assert.strictEqual(card.status, 200);
    const response = yield* http.execute(
      HttpClientRequest.post(`${url}/`).pipe(
        HttpClientRequest.setHeaders({ 'A2A-Version': '1.0' }),
        HttpClientRequest.bodyText(
          encodeJsonText({
            jsonrpc: '2.0',
            id: 1,
            method: 'SendMessage',
            params: {
              message: {
                messageId: 'n-1',
                role: 'ROLE_USER',
                parts: [{ text: 'node' }],
              },
            },
          }),
          'application/json'
        )
      )
    );
    const body = yield* response.json;
    assert.strictEqual(
      at(body, 'result', 'task', 'status', 'state'),
      'TASK_STATE_COMPLETED'
    );
  }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
);
