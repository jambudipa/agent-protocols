/**
 * The v0.3 compatibility layer: translators, the v0.3 card, the legacy
 * JSON-RPC and HTTP+JSON bindings of our server, and its version gate.
 */
import { assert, describe, it, layer } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  Proto,
  Translate,
  V03,
  isLegacyAgentCard,
  legacyPushNotificationToV1StreamResponse,
  parseLegacyAgentCard,
  toCompatAgentCard,
  toCoreAgentCard,
} from '../src/compat/v0_3/index.js';
import { legacyCompat } from '../src/compat/v0_3/server/index.js';
import type { Part } from '../src/index.js';
import { at, json, sse } from './http.js';
import { legacyCard } from './compat-support.js';
import { echoCard, testServer } from './support.js';

describe('translators', () => {
  it.effect('round-trips parts, wrapping non-object data', () =>
    Effect.gen(function* () {
      const parts: ReadonlyArray<Part> = [
        { text: 'hello', metadata: { a: 1 } },
        {
          raw: new TextEncoder().encode('bytes'),
          mediaType: 'text/plain',
          filename: 'a.txt',
        },
        { url: 'https://example.com/a', mediaType: 'image/png' },
        { data: { key: 'value' } },
        { data: [1, 2, 3] },
      ];
      const compat = parts.map(Translate.toCompatPart);
      assert.deepStrictEqual(compat[1], {
        kind: 'file',
        file: { bytes: 'Ynl0ZXM=', mimeType: 'text/plain', name: 'a.txt' },
      });
      assert.deepStrictEqual(compat[4], {
        kind: 'data',
        data: { value: [1, 2, 3] },
        metadata: { data_part_compat: true },
      });
      const back = yield* Effect.forEach(compat, Translate.toCorePart);
      assert.deepStrictEqual(back, parts);
    })
  );

  it.effect('maps states, roles and the final flag', () =>
    Effect.gen(function* () {
      const update = Translate.toCompatTaskStatusUpdateEvent({
        taskId: 't',
        contextId: 'c',
        status: { state: 'TASK_STATE_CANCELED' },
      });
      assert.strictEqual(update.status.state, 'canceled');
      assert.isTrue(update.final);
      const message = yield* Translate.toCoreMessage({
        messageId: 'm',
        role: 'user',
        parts: [{ kind: 'text', text: 'hi' }],
      });
      assert.strictEqual(message.role, 'ROLE_USER');
    })
  );

  it.effect('treats a configuration without blocking as non-blocking', () =>
    Effect.gen(function* () {
      const request = yield* Translate.toCoreSendMessageRequest({
        message: { messageId: 'm', role: 'user', parts: [] },
        configuration: { acceptedOutputModes: ['text/plain'] },
      });
      assert.isTrue(request.configuration?.returnImmediately);
      const blocking = yield* Translate.toCoreSendMessageRequest({
        message: { messageId: 'm', role: 'user', parts: [] },
      });
      assert.isUndefined(blocking.configuration);
    })
  );

  it.effect('round-trips a task through the v0.3 protobuf JSON', () =>
    Effect.gen(function* () {
      const task = Translate.toCompatTask({
        id: 't1',
        contextId: 'c1',
        status: {
          state: 'TASK_STATE_WORKING',
          timestamp: '2026-10-23T10:00:00.000Z',
        },
        history: [
          { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'hi' }] },
        ],
      });
      const proto = Proto.toProtoTask(task);
      assert.strictEqual(proto.status?.state, 'TASK_STATE_WORKING');
      assert.strictEqual(proto.history?.[0]?.content?.[0]?.text, 'hi');
      const back = yield* Proto.fromProtoTask(proto);
      assert.deepStrictEqual(back, { ...task, artifacts: [] });
    })
  );

  it.effect('reads a v0.3 push notification body', () =>
    Effect.gen(function* () {
      const event = yield* legacyPushNotificationToV1StreamResponse({
        kind: 'status-update',
        taskId: 't',
        contextId: 'c',
        final: false,
        status: { state: 'working' },
      });
      assert.deepStrictEqual(event, {
        statusUpdate: {
          taskId: 't',
          contextId: 'c',
          status: { state: 'TASK_STATE_WORKING' },
        },
      });
    })
  );
});

describe('agent card', () => {
  it.effect('serves the v0.3 card and reads it back', () =>
    Effect.gen(function* () {
      const card = legacyCard('http://agent');
      const compat = yield* toCompatAgentCard(card, {
        embedV1Interfaces: true,
      });
      assert.strictEqual(compat.url, 'http://agent/');
      assert.strictEqual(compat.preferredTransport, 'JSONRPC');
      assert.strictEqual(compat.protocolVersion, '0.3');
      assert.deepStrictEqual(compat.additionalInterfaces, [
        { url: 'http://agent/', transport: 'HTTP+JSON' },
      ]);
      assert.isTrue(compat.supportsAuthenticatedExtendedCard);
      assert.isFalse(
        isLegacyAgentCard(Schema.encodeSync(V03.AgentCard)(compat))
      );
      const plain = yield* toCompatAgentCard(card);
      assert.isTrue(isLegacyAgentCard(plain));
      const parsed = yield* parseLegacyAgentCard(plain);
      assert.deepStrictEqual(
        parsed.supportedInterfaces.map((i) => [
          i.protocolBinding,
          i.protocolVersion,
        ]),
        [
          ['JSONRPC', '0.3'],
          ['HTTP+JSON', '0.3'],
        ]
      );
      assert.isTrue(parsed.capabilities.extendedAgentCard);
      const core = yield* toCoreAgentCard(plain);
      assert.strictEqual(core.name, card.name);
    })
  );

  it.effect('rejects a card without a v0.3 interface', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(toCompatAgentCard(echoCard('http://a')));
      assert.strictEqual(error._tag, 'VersionNotSupportedError');
    })
  );
});

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.post(path).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyJsonUnsafe(body)
      )
    );
    return {
      status: response.status,
      headers: response.headers,
      text: yield* response.text,
    };
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.get(path).pipe(HttpClientRequest.setHeaders(headers))
    );
    return {
      status: response.status,
      headers: response.headers,
      text: yield* response.text,
    };
  });

const rpc = (method: string, params: unknown, id = 1) =>
  post('/', { jsonrpc: '2.0', id, method, params });

const userMessage = (text: string, id: string) => ({
  kind: 'message',
  messageId: id,
  role: 'user',
  parts: [{ kind: 'text', text }],
});

layer(
  testServer({
    card: legacyCard,
    routes: { legacyCompat },
  }),
  { excludeTestServices: true }
)('server with legacy compat', (it) => {
  it.effect('answers message/send without an A2A-Version header', () =>
    Effect.gen(function* () {
      const response = yield* rpc('message/send', {
        message: userMessage('hi', 'l1'),
        configuration: { blocking: true },
      });
      assert.strictEqual(response.status, 200);
      const body = json(response);
      assert.strictEqual(at(body, 'result', 'kind'), 'task');
      assert.strictEqual(at(body, 'result', 'status', 'state'), 'completed');
      assert.strictEqual(
        at(body, 'result', 'artifacts', 0, 'parts', 0, 'text'),
        'echo: hi'
      );
    })
  );

  it.effect('streams message/stream as v0.3 events', () =>
    Effect.gen(function* () {
      const response = yield* rpc('message/stream', {
        message: userMessage('hi', 'l2'),
      });
      const events = sse(response.text);
      assert.deepStrictEqual(
        events.map((event) => at(event.data, 'result', 'kind')),
        ['task', 'status-update', 'artifact-update', 'status-update']
      );
      assert.strictEqual(at(events[3]?.data, 'result', 'final'), true);
    })
  );

  it.effect('answers v0.3 error codes', () =>
    Effect.gen(function* () {
      const unknown = json(yield* rpc('tasks/list', { id: 'x' }));
      assert.strictEqual(at(unknown, 'error', 'code'), -32601);
      assert.strictEqual(
        at(unknown, 'error', 'message'),
        'Method not found: tasks/list'
      );
      const invalid = json(yield* post('/', { jsonrpc: '1.0', id: 2 }));
      assert.strictEqual(at(invalid, 'error', 'code'), -32600);
      const missing = json(yield* rpc('tasks/get', { id: 'nope' }));
      assert.strictEqual(at(missing, 'error', 'code'), -32001);
      assert.strictEqual(at(missing, 'error', 'data'), '<missing>');
    })
  );

  it.effect('keeps v1.0 requests on the v1.0 dispatcher', () =>
    Effect.gen(function* () {
      const response = yield* post(
        '/',
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'SendMessage',
          params: {
            message: {
              messageId: 'v1',
              role: 'ROLE_USER',
              parts: [{ text: 'x' }],
            },
          },
        },
        { 'A2A-Version': '1.0' }
      );
      assert.strictEqual(
        at(json(response), 'result', 'task', 'status', 'state'),
        'TASK_STATE_COMPLETED'
      );
    })
  );

  it.effect('serves the v0.3 card to a v0.3 request', () =>
    Effect.gen(function* () {
      const legacy = yield* get('/.well-known/agent-card.json');
      assert.strictEqual(legacy.status, 200);
      assert.strictEqual(at(json(legacy), 'protocolVersion'), '0.3');
      assert.strictEqual(legacy.headers['vary'], 'A2A-Version');
      const current = yield* get('/.well-known/agent-card.json', {
        'A2A-Version': '1.0',
      });
      assert.strictEqual(at(json(current), 'url'), '<missing>');
    })
  );

  it.effect('serves the v0.3 HTTP+JSON routes', () =>
    Effect.gen(function* () {
      const sent = yield* post('/v1/message:send', {
        message: {
          messageId: 'r1',
          role: 'ROLE_USER',
          content: [{ text: 'rest' }],
        },
        configuration: { blocking: true },
      });
      assert.strictEqual(sent.status, 201);
      const task = at(json(sent), 'task');
      assert.strictEqual(at(task, 'status', 'state'), 'TASK_STATE_COMPLETED');
      const taskId = String(at(task, 'id'));
      const fetched = yield* get(`/v1/tasks/${taskId}`);
      assert.strictEqual(at(json(fetched), 'id'), taskId);
      const missing = yield* get('/v1/tasks/nope');
      assert.strictEqual(missing.status, 404);
      assert.deepStrictEqual(json(missing), {
        code: -32001,
        message: 'Task not found: nope',
      });
      const malformed = yield* post('/v1/message:send', {});
      assert.strictEqual(malformed.status, 400);
      assert.strictEqual(at(json(malformed), 'code'), -32602);
    })
  );
});
