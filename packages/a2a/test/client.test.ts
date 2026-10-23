/**
 * Client behaviour: transport selection, interceptors, polling, the
 * streaming fallback, the tenant decorator and authentication retry.
 */
import { assert, layer } from '@effect/vitest';
import { Effect, Option, Stream } from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import {
  ClientFactory,
  type CallInterceptor,
  withAuthentication,
} from '../src/client/index.js';
import type { AgentCard, Message } from '../src/index.js';
import { echoCard, serverUrl, testServer } from './support.js';

let counter = 0;
const message = (text: string): Message => ({
  messageId: `client-${++counter}`,
  role: 'ROLE_USER',
  parts: [{ text }],
});

const fetchClient = Effect.provide(FetchHttpClient.layer);

layer(testServer(), { excludeTestServices: true })('client', (it) => {
  it.effect('prefers the card order, then preferredTransports', () =>
    Effect.gen(function* () {
      const url = yield* serverUrl;
      const byCard = yield* fetchClient(
        Effect.flatMap(ClientFactory.make(), (factory) =>
          factory.createFromUrl(url)
        )
      );
      assert.strictEqual(byCard.transport.protocolName, 'JSONRPC');
      assert.strictEqual(byCard.protocolVersion, '1.0');
      const unknown = yield* Effect.flip(
        fetchClient(ClientFactory.make({ preferredTransports: ['GRPC'] }))
      );
      assert.strictEqual(unknown._tag, 'A2ATransportError');
    })
  );

  it.effect('runs interceptors before and after, and answers early', () =>
    Effect.gen(function* () {
      const url = yield* serverUrl;
      const seen: Array<string> = [];
      const recorder: CallInterceptor = {
        before: (args) =>
          Effect.sync(() => {
            seen.splice(seen.length, 0, `before:${args.input.method}`);
            return { input: args.input, options: args.options };
          }),
        after: (args) =>
          Effect.sync(() => {
            seen.splice(seen.length, 0, `after:${args.result.method}`);
            return { result: args.result };
          }),
      };
      const cache: CallInterceptor = {
        before: (args) =>
          Effect.succeed(
            args.input.method === 'getTask'
              ? {
                  input: args.input,
                  options: args.options,
                  earlyReturn: {
                    method: 'getTask',
                    value: {
                      id: 'cached',
                      status: { state: 'TASK_STATE_COMPLETED' },
                    },
                  },
                }
              : { input: args.input, options: args.options }
          ),
        after: (args) => Effect.succeed({ result: args.result }),
      };
      const client = yield* fetchClient(
        Effect.flatMap(
          ClientFactory.make({
            clientConfig: { interceptors: [recorder, cache] },
          }),
          (factory) => factory.createFromUrl(url)
        )
      );
      yield* client.sendMessage({ message: message('hello') });
      const cached = yield* client.getTask({ id: 'anything' });
      assert.strictEqual(cached.id, 'cached');
      assert.deepStrictEqual(seen, [
        'before:sendMessage',
        'after:sendMessage',
        'before:getTask',
        'after:getTask',
      ]);
    })
  );

  it.effect('polls when configured, and falls back from streaming', () =>
    Effect.gen(function* () {
      const url = yield* serverUrl;
      const polling = yield* fetchClient(
        Effect.flatMap(
          ClientFactory.make({ clientConfig: { polling: true } }),
          (factory) => factory.createFromUrl(url)
        )
      );
      const result = yield* polling.sendMessage({ message: message('wait') });
      assert.ok(
        'status' in result && result.status.state === 'TASK_STATE_SUBMITTED'
      );

      const card: AgentCard = {
        ...echoCard(url),
        capabilities: { streaming: false },
      };
      const plain = yield* fetchClient(
        Effect.flatMap(ClientFactory.make(), (factory) =>
          factory.createFromAgentCard(card)
        )
      );
      const events = yield* Stream.runCollect(
        plain.sendMessageStream({ message: message('hi') })
      );
      assert.strictEqual(events.length, 1);
      assert.ok(events[0] !== undefined && 'task' in events[0]);
    })
  );

  it.effect('sends the tenant of the interface', () =>
    Effect.gen(function* () {
      const url = yield* serverUrl;
      const card: AgentCard = {
        ...echoCard(url),
        supportedInterfaces: [
          {
            url: `${url}/`,
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
            tenant: 'acme',
          },
        ],
      };
      const tenantClient = yield* fetchClient(
        Effect.flatMap(ClientFactory.make(), (factory) =>
          factory.createFromAgentCard(card)
        )
      );
      const sent = yield* tenantClient.sendMessage({
        message: message('tenant'),
      });
      assert.ok('status' in sent);
      yield* tenantClient.getTask({ id: sent.id });
      const plain = yield* fetchClient(
        Effect.flatMap(
          ClientFactory.make({ preferredTransports: ['HTTP+JSON'] }),
          (factory) => factory.createFromUrl(url)
        )
      );
      const missing = yield* Effect.flip(plain.getTask({ id: sent.id }));
      assert.strictEqual(missing._tag, 'TaskNotFoundError');
    })
  );
});

layer(testServer(), { excludeTestServices: true })('authentication', (it) => {
  it.effect('retries once with the headers that the handler asks for', () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const stub = HttpClient.make((request) =>
        Effect.sync(() => {
          const authorization = request.headers['authorization'] ?? '';
          seen.splice(seen.length, 0, authorization);
          return HttpClientResponse.fromWeb(
            request,
            new Response('{}', {
              status: authorization === 'Bearer fresh' ? 200 : 401,
            })
          );
        })
      );
      const retried: Array<string> = [];
      const client = withAuthentication({
        headers: Effect.succeed({ Authorization: 'Bearer stale' }),
        shouldRetryWithHeaders: (_request, response) =>
          Effect.succeed(
            response.status === 401
              ? Option.some({ Authorization: 'Bearer fresh' })
              : Option.none()
          ),
        onSuccessfulRetry: (headers) =>
          Effect.sync(() => {
            retried.splice(retried.length, 0, headers['Authorization'] ?? '');
          }),
      })(stub);
      const response = yield* client.execute(
        HttpClientRequest.get('http://agent.test/x')
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(seen, ['Bearer stale', 'Bearer fresh']);
      assert.deepStrictEqual(retried, ['Bearer fresh']);
    })
  );
});
