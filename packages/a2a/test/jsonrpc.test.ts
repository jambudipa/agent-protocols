/**
 * The JSON-RPC binding against the I/O matrix of the plan, over a real
 * server.
 */
import { assert, layer } from '@effect/vitest';
import { Effect, Predicate } from 'effect';
import { HttpClientRequest } from 'effect/http';
import {
  type JsonObject,
  at,
  encodeJsonText,
  firstEvent,
  v1,
  json,
  nextId,
  rpc,
  rpcText,
  sse,
  userMessage,
} from './http.js';
import { TEST_EXTENSION, testServer } from './support.js';

const send = (text: string, extra: JsonObject = {}) =>
  rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: { message: userMessage(nextId(), text), ...extra },
  });

const errorOf = (body: unknown) => ({
  code: at(body, 'error', 'code'),
  reason: at(body, 'error', 'data', 0, 'reason'),
});

layer(testServer(), { excludeTestServices: true })('JSON-RPC binding', (it) => {
  it.effect('treats a request without A2A-Version as 0.3 and rejects it', () =>
    Effect.gen(function* () {
      const response = yield* rpc(
        { jsonrpc: '2.0', id: 7, method: 'GetTask', params: { id: 'x' } },
        {}
      );
      assert.strictEqual(response.status, 200);
      const body = json(response);
      assert.deepStrictEqual(errorOf(body), {
        code: -32009,
        reason: 'VERSION_NOT_SUPPORTED',
      });
      assert.strictEqual(at(body, 'id'), 7);
    })
  );

  it.effect('answers an unknown method with -32601 and HTTP 200', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'Nope',
        params: {},
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(at(json(response), 'error', 'code'), -32601);
    })
  );

  it.effect('answers an unknown method without params with -32601', () =>
    Effect.gen(function* () {
      const response = yield* rpc({ jsonrpc: '2.0', id: 1, method: 'Nope' });
      assert.strictEqual(at(json(response), 'error', 'code'), -32601);
    })
  );

  it.effect('answers SendMessage without message with -32602', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'SendMessage',
        params: {},
      });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(errorOf(json(response)), {
        code: -32602,
        reason: 'INVALID_PARAMS',
      });
    })
  );

  it.effect(
    'answers non-object params and an invalid envelope with -32602',
    () =>
      Effect.gen(function* () {
        const array = yield* rpc({
          jsonrpc: '2.0',
          id: 4,
          method: 'GetTask',
          params: [],
        });
        assert.strictEqual(at(json(array), 'error', 'code'), -32602);
        const envelope = yield* rpc({
          jsonrpc: '1.0',
          id: 5,
          method: 'GetTask',
          params: {},
        });
        assert.strictEqual(at(json(envelope), 'error', 'code'), -32602);
        assert.strictEqual(at(json(envelope), 'id'), 5);
      })
  );

  it.effect('answers malformed JSON with -32700 and a null id', () =>
    Effect.gen(function* () {
      const response = yield* rpcText('{');
      assert.strictEqual(response.status, 200);
      const body = json(response);
      assert.strictEqual(at(body, 'error', 'code'), -32700);
      assert.ok(Predicate.isNull(at(body, 'id')));
    })
  );

  it.effect('rejects a non-JSON content type with -32005', () =>
    Effect.gen(function* () {
      const response = yield* rpcText('{}', 'text/plain');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(at(json(response), 'error', 'code'), -32005);
    })
  );

  it.effect('accepts application/a2a+json', () =>
    Effect.gen(function* () {
      const response = yield* rpcText(
        '{"jsonrpc":"2.0","id":9,"method":"GetTask","params":{"id":"nope"}}',
        'application/a2a+json'
      );
      assert.strictEqual(at(json(response), 'error', 'code'), -32001);
    })
  );

  it.effect('answers an unknown task with -32001', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 6,
        method: 'GetTask',
        params: { id: 'x' },
      });
      assert.deepStrictEqual(errorOf(json(response)), {
        code: -32001,
        reason: 'TASK_NOT_FOUND',
      });
    })
  );

  it.effect('runs a blocking send to completion', () =>
    Effect.gen(function* () {
      const body = json(yield* send('hello'));
      const task = at(body, 'result', 'task');
      assert.strictEqual(at(task, 'status', 'state'), 'TASK_STATE_COMPLETED');
      assert.strictEqual(
        at(task, 'artifacts', 0, 'parts', 0, 'text'),
        'echo: hello'
      );
      assert.strictEqual(at(task, 'history', 0, 'role'), 'ROLE_USER');
    })
  );

  it.effect('returns a message result', () =>
    Effect.gen(function* () {
      const body = json(yield* send('message'));
      assert.strictEqual(
        at(body, 'result', 'message', 'parts', 0, 'text'),
        'hello back'
      );
    })
  );

  it.effect('returns at once with returnImmediately', () =>
    Effect.gen(function* () {
      const body = json(
        yield* send('wait', { configuration: { returnImmediately: true } })
      );
      assert.strictEqual(
        at(body, 'result', 'task', 'status', 'state'),
        'TASK_STATE_SUBMITTED'
      );
    })
  );

  it.effect(
    'stores a FAILED task when the executor fails before any event',
    () =>
      Effect.gen(function* () {
        const body = json(yield* send('fail'));
        const task = at(body, 'result', 'task');
        assert.strictEqual(at(task, 'status', 'state'), 'TASK_STATE_FAILED');
        assert.strictEqual(
          at(task, 'status', 'message', 'parts', 0, 'text'),
          'Agent execution error: boom'
        );
        const stored = json(
          yield* rpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'GetTask',
            params: { id: at(task, 'id') as string },
          })
        );
        assert.strictEqual(
          at(stored, 'result', 'status', 'state'),
          'TASK_STATE_FAILED'
        );
      })
  );

  it.effect('rejects cancelling a completed task with -32002', () =>
    Effect.gen(function* () {
      const task = at(json(yield* send('done')), 'result', 'task');
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'CancelTask',
        params: { id: at(task, 'id') as string },
      });
      assert.deepStrictEqual(errorOf(json(response)), {
        code: -32002,
        reason: 'TASK_NOT_CANCELABLE',
      });
    })
  );

  it.effect('cancels a running task', () =>
    Effect.gen(function* () {
      const task = at(
        json(
          yield* send('wait', { configuration: { returnImmediately: true } })
        ),
        'result',
        'task'
      );
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'CancelTask',
        params: { id: at(task, 'id') as string },
      });
      assert.strictEqual(
        at(json(response), 'result', 'status', 'state'),
        'TASK_STATE_CANCELED'
      );
    })
  );

  it.effect('continues a task in INPUT_REQUIRED', () =>
    Effect.gen(function* () {
      const first = at(json(yield* send('input')), 'result', 'task');
      assert.strictEqual(
        at(first, 'status', 'state'),
        'TASK_STATE_INPUT_REQUIRED'
      );
      const second = yield* rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'SendMessage',
        params: {
          message: userMessage(nextId(), 'more', {
            taskId: at(first, 'id') as string,
            contextId: at(first, 'contextId') as string,
          }),
        },
      });
      const task = at(json(second), 'result', 'task');
      assert.strictEqual(at(task, 'status', 'state'), 'TASK_STATE_COMPLETED');
      assert.strictEqual(at(task, 'id'), at(first, 'id'));
    })
  );

  it.effect('returns the AUTH_REQUIRED snapshot of a blocking send', () =>
    Effect.gen(function* () {
      const task = at(json(yield* send('auth')), 'result', 'task');
      assert.strictEqual(
        at(task, 'status', 'state'),
        'TASK_STATE_AUTH_REQUIRED'
      );
      yield* Effect.sleep('200 millis');
      const later = json(
        yield* rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'GetTask',
          params: { id: at(task, 'id') as string },
        })
      );
      assert.strictEqual(
        at(later, 'result', 'status', 'state'),
        'TASK_STATE_COMPLETED'
      );
    })
  );

  it.effect('applies historyLength', () =>
    Effect.gen(function* () {
      const body = json(
        yield* send('history', { configuration: { historyLength: 0 } })
      );
      assert.strictEqual(
        at(body, 'result', 'task', 'history'),
        at({}, 'history')
      );
    })
  );

  it.effect('streams a task as SSE in event order', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 11,
        method: 'SendStreamingMessage',
        params: { message: userMessage(nextId(), 'stream') },
      });
      assert.strictEqual(response.status, 200);
      assert.ok(
        response.headers['content-type']?.startsWith('text/event-stream')
      );
      const events = sse(response.text);
      assert.deepStrictEqual(
        events.map(
          (event) => Object.keys(at(event.data, 'result') as object)[0]
        ),
        ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
      );
      assert.ok(events.every((event) => at(event.data, 'id') === 11));
    })
  );

  it.effect('answers a stream that fails before its first event as JSON', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 12,
        method: 'SendStreamingMessage',
        params: { message: userMessage('', 'no id') },
      });
      assert.ok(
        response.headers['content-type']?.startsWith('application/json')
      );
      assert.strictEqual(at(json(response), 'error', 'code'), -32602);
    })
  );

  it.effect(
    'ends a broken stream with an error event and no status change',
    () =>
      Effect.gen(function* () {
        const response = yield* rpc({
          jsonrpc: '2.0',
          id: 13,
          method: 'SendStreamingMessage',
          params: { message: userMessage(nextId(), 'bad-order') },
        });
        assert.strictEqual(response.status, 200);
        const events = sse(response.text);
        const last = events.at(-1);
        assert.strictEqual(last?.event, 'error');
        assert.strictEqual(at(last?.data, 'error', 'code'), -32004);
        assert.strictEqual(events[0]?.event, 'message');
      })
  );

  it.effect('streams a FAILED status when the executor fails mid-stream', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 14,
        method: 'SendStreamingMessage',
        params: { message: userMessage(nextId(), 'fail-late') },
      });
      const states = sse(response.text).map((event) =>
        at(event.data, 'result', 'statusUpdate', 'status', 'state')
      );
      assert.strictEqual(states.at(-1), 'TASK_STATE_FAILED');
    })
  );

  it.effect('resubscribes to a task in INPUT_REQUIRED', () =>
    Effect.gen(function* () {
      const task = at(json(yield* send('input')), 'result', 'task');
      const event = yield* firstEvent(
        HttpClientRequest.post('/').pipe(
          HttpClientRequest.setHeaders(v1),
          HttpClientRequest.bodyText(
            encodeJsonText({
              jsonrpc: '2.0',
              id: 15,
              method: 'SubscribeToTask',
              params: { id: at(task, 'id') as string },
            }),
            'application/json'
          )
        )
      );
      assert.strictEqual(
        at(event?.data, 'result', 'task', 'id'),
        at(task, 'id')
      );
    })
  );

  it.effect('echoes activated extensions', () =>
    Effect.gen(function* () {
      const response = yield* rpc(
        {
          jsonrpc: '2.0',
          id: 16,
          method: 'SendMessage',
          params: { message: userMessage(nextId(), 'extension') },
        },
        { 'A2A-Version': '1.0', 'A2A-Extensions': TEST_EXTENSION }
      );
      assert.strictEqual(response.headers['a2a-extensions'], TEST_EXTENSION);
    })
  );

  it.effect('lists tasks with paging', () =>
    Effect.gen(function* () {
      const contextId = nextId('ctx');
      for (const text of ['a', 'b', 'c']) {
        yield* rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: { message: userMessage(nextId(), text, { contextId }) },
        });
      }
      const page = json(
        yield* rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'ListTasks',
          params: { contextId, pageSize: 2 },
        })
      );
      assert.strictEqual(at(page, 'result', 'totalSize'), 3);
      assert.strictEqual(at(page, 'result', 'pageSize'), 2);
      assert.strictEqual(
        (at(page, 'result', 'tasks') as ReadonlyArray<unknown>).length,
        2
      );
      const next = json(
        yield* rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'ListTasks',
          params: {
            contextId,
            pageSize: 2,
            pageToken: at(page, 'result', 'nextPageToken') as string,
          },
        })
      );
      assert.strictEqual(
        (at(next, 'result', 'tasks') as ReadonlyArray<unknown>).length,
        1
      );
      assert.strictEqual(at(next, 'result', 'nextPageToken'), '');
    })
  );

  it.effect('rejects an extended card that is not configured with -32007', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'GetExtendedAgentCard',
      });
      assert.strictEqual(at(json(response), 'error', 'code'), -32007);
    })
  );
});

layer(
  testServer({
    card: (baseUrl) => ({
      name: 'No push',
      description: 'Push notifications off.',
      version: '1.0.0',
      supportedInterfaces: [
        {
          url: `${baseUrl}/`,
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    }),
  }),
  { excludeTestServices: true }
)('JSON-RPC binding without push or streaming', (it) => {
  it.effect('rejects a push config with -32003', () =>
    Effect.gen(function* () {
      const task = at(json(yield* send('done')), 'result', 'task');
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'CreateTaskPushNotificationConfig',
        params: {
          taskId: at(task, 'id') as string,
          url: 'http://127.0.0.1:1/hook',
        },
      });
      assert.deepStrictEqual(errorOf(json(response)), {
        code: -32003,
        reason: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
      });
    })
  );

  it.effect('rejects a stream with -32004', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'SendStreamingMessage',
        params: { message: userMessage(nextId(), 'x') },
      });
      assert.strictEqual(at(json(response), 'error', 'code'), -32004);
    })
  );

  it.effect('rejects the extended card when the card does not offer it', () =>
    Effect.gen(function* () {
      const response = yield* rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'GetExtendedAgentCard',
      });
      assert.strictEqual(at(json(response), 'error', 'code'), -32004);
    })
  );
});
