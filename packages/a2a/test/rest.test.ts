/**
 * The HTTP+JSON binding and the Agent Card route, over a real server.
 */
import { assert, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpClientRequest } from 'effect/http';
import {
  at,
  firstEvent,
  json,
  MISSING,
  nextId,
  rest,
  send,
  sse,
  userMessage,
  v1,
} from './http.js';
import { testServer } from './support.js';

const sendMessage = (text: string, prefix = '') =>
  rest('POST', `${prefix}/message:send`, {
    body: { message: userMessage(nextId(), text) },
  });

const status = (body: unknown) => ({
  code: at(body, 'error', 'code'),
  status: at(body, 'error', 'status'),
  reason: at(body, 'error', 'details', 0, 'reason'),
});

layer(testServer(), { excludeTestServices: true })(
  'HTTP+JSON binding',
  (it) => {
    it.effect('sends a message as application/a2a+json', () =>
      Effect.gen(function* () {
        const response = yield* sendMessage('rest');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          response.headers['content-type'],
          'application/a2a+json'
        );
        assert.strictEqual(
          at(json(response), 'task', 'status', 'state'),
          'TASK_STATE_COMPLETED'
        );
      })
    );

    it.effect(
      'treats a request without A2A-Version as 0.3 and answers 400',
      () =>
        Effect.gen(function* () {
          const response = yield* rest('GET', '/tasks/x', { headers: {} });
          assert.strictEqual(response.status, 400);
          assert.deepStrictEqual(status(json(response)), {
            code: 400,
            status: 'FAILED_PRECONDITION',
            reason: 'VERSION_NOT_SUPPORTED',
          });
        })
    );

    it.effect('answers an unknown task with 404 NOT_FOUND', () =>
      Effect.gen(function* () {
        const response = yield* rest('GET', '/tasks/x');
        assert.strictEqual(response.status, 404);
        assert.deepStrictEqual(status(json(response)), {
          code: 404,
          status: 'NOT_FOUND',
          reason: 'TASK_NOT_FOUND',
        });
      })
    );

    it.effect('answers malformed JSON and a missing message with 400', () =>
      Effect.gen(function* () {
        const malformed = yield* send(
          HttpClientRequest.post('/message:send').pipe(
            HttpClientRequest.setHeaders(v1),
            HttpClientRequest.bodyText('{', 'application/json')
          )
        );
        assert.strictEqual(malformed.status, 400);
        assert.strictEqual(
          at(json(malformed), 'error', 'status'),
          'INVALID_ARGUMENT'
        );
        const missing = yield* rest('POST', '/message:send', { body: {} });
        assert.strictEqual(missing.status, 400);
        const wrongType = yield* send(
          HttpClientRequest.post('/message:send').pipe(
            HttpClientRequest.setHeaders(v1),
            HttpClientRequest.bodyText('{}', 'text/plain')
          )
        );
        assert.strictEqual(wrongType.status, 400);
        assert.strictEqual(
          at(json(wrongType), 'error', 'details', 0, 'reason'),
          'CONTENT_TYPE_NOT_SUPPORTED'
        );
      })
    );

    it.effect('rejects cancelling a completed task with 400', () =>
      Effect.gen(function* () {
        const task = at(json(yield* sendMessage('done')), 'task');
        const response = yield* rest(
          'POST',
          `/tasks/${at(task, 'id') as string}:cancel`
        );
        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(status(json(response)), {
          code: 400,
          status: 'FAILED_PRECONDITION',
          reason: 'TASK_NOT_CANCELABLE',
        });
      })
    );

    it.effect('gets a task with historyLength and validates the query', () =>
      Effect.gen(function* () {
        const task = at(json(yield* sendMessage('history')), 'task');
        const id = at(task, 'id') as string;
        const trimmed = json(
          yield* rest('GET', `/tasks/${id}?historyLength=1`)
        );
        assert.strictEqual(
          (at(trimmed, 'history') as ReadonlyArray<unknown>).length,
          1
        );
        const bad = yield* rest('GET', `/tasks/${id}?historyLength=-1`);
        assert.strictEqual(bad.status, 400);
      })
    );

    it.effect('lists tasks from query parameters', () =>
      Effect.gen(function* () {
        const contextId = nextId('ctx');
        for (const text of ['a', 'b']) {
          yield* rest('POST', '/message:send', {
            body: { message: userMessage(nextId(), text, { contextId }) },
          });
        }
        const page = json(
          yield* rest(
            'GET',
            `/tasks?contextId=${contextId}&status=TASK_STATE_COMPLETED&pageSize=1&includeArtifacts=true`
          )
        );
        assert.strictEqual(at(page, 'totalSize'), 2);
        assert.strictEqual(at(page, 'pageSize'), 1);
        assert.ok(Array.isArray(at(page, 'tasks', 0, 'artifacts')));
        const withoutArtifacts = json(
          yield* rest('GET', `/tasks?contextId=${contextId}`)
        );
        assert.strictEqual(
          at(withoutArtifacts, 'tasks', 0, 'artifacts'),
          MISSING
        );
        const badSize = yield* rest('GET', '/tasks?pageSize=101');
        assert.strictEqual(badSize.status, 400);
        const badStatus = yield* rest('GET', '/tasks?status=NOPE');
        assert.strictEqual(badStatus.status, 400);
      })
    );

    it.effect('streams with POST /message:stream', () =>
      Effect.gen(function* () {
        const response = yield* rest('POST', '/message:stream', {
          body: { message: userMessage(nextId(), 'stream') },
        });
        assert.ok(
          response.headers['content-type']?.startsWith('text/event-stream')
        );
        assert.deepStrictEqual(
          sse(response.text).map(
            (event) => Object.keys(event.data as object)[0]
          ),
          ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
        );
      })
    );

    it.effect('ends a broken stream with an error event', () =>
      Effect.gen(function* () {
        const response = yield* rest('POST', '/message:stream', {
          body: { message: userMessage(nextId(), 'bad-order') },
        });
        assert.strictEqual(response.status, 200);
        const last = sse(response.text).at(-1);
        assert.strictEqual(last?.event, 'error');
        assert.strictEqual(
          at(last?.data, 'error', 'status'),
          'FAILED_PRECONDITION'
        );
      })
    );

    it.effect('subscribes with GET and POST', () =>
      Effect.gen(function* () {
        const task = at(json(yield* sendMessage('input')), 'task');
        const id = at(task, 'id') as string;
        for (const method of ['GET', 'POST'] as const) {
          const event = yield* firstEvent(
            HttpClientRequest.make(method)(`/tasks/${id}:subscribe`).pipe(
              HttpClientRequest.setHeaders(v1)
            )
          );
          assert.strictEqual(at(event?.data, 'task', 'id'), id);
        }
      })
    );

    it.effect('creates, gets, lists and deletes push configs', () =>
      Effect.gen(function* () {
        const task = at(json(yield* sendMessage('push')), 'task');
        const id = at(task, 'id') as string;
        const created = yield* rest(
          'POST',
          `/tasks/${id}/pushNotificationConfigs`,
          { body: { url: 'http://127.0.0.1:1/hook', token: 'secret' } }
        );
        assert.strictEqual(created.status, 201);
        const configId = at(json(created), 'id') as string;
        assert.ok(configId.length > 0);
        const fetched = json(
          yield* rest('GET', `/tasks/${id}/pushNotificationConfigs/${configId}`)
        );
        assert.strictEqual(at(fetched, 'token'), 'secret');
        const listed = json(
          yield* rest('GET', `/tasks/${id}/pushNotificationConfigs`)
        );
        assert.strictEqual(at(listed, 'configs', 0, 'id'), configId);
        const deleted = yield* rest(
          'DELETE',
          `/tasks/${id}/pushNotificationConfigs/${configId}`
        );
        assert.strictEqual(deleted.status, 204);
        assert.strictEqual(deleted.text, '');
        const gone = yield* rest(
          'GET',
          `/tasks/${id}/pushNotificationConfigs/${configId}`
        );
        assert.strictEqual(gone.status, 404);
      })
    );

    it.effect('scopes tasks by the path tenant', () =>
      Effect.gen(function* () {
        const task = at(json(yield* sendMessage('tenant', '/acme')), 'task');
        const id = at(task, 'id') as string;
        assert.strictEqual(
          (yield* rest('GET', `/acme/tasks/${id}`)).status,
          200
        );
        assert.strictEqual((yield* rest('GET', `/tasks/${id}`)).status, 404);
        assert.strictEqual(
          (yield* rest('GET', `/other/tasks/${id}`)).status,
          404
        );
      })
    );

    it.effect('answers the extended card route', () =>
      Effect.gen(function* () {
        const response = yield* rest('GET', '/extendedAgentCard');
        assert.strictEqual(response.status, 400);
        assert.strictEqual(
          at(json(response), 'error', 'details', 0, 'reason'),
          'EXTENDED_AGENT_CARD_NOT_CONFIGURED'
        );
      })
    );
  }
);

layer(testServer(), { excludeTestServices: true })('Agent Card route', (it) => {
  it.effect('serves the card with a weak ETag and a one hour max-age', () =>
    Effect.gen(function* () {
      const card = (headers: Record<string, string>) =>
        rest('GET', '/.well-known/agent-card.json', { headers });
      const response = yield* card({});
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json');
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=3600'
      );
      const etag = response.headers['etag'] ?? '';
      assert.match(etag, /^W\/"[0-9a-f]{16}"$/);
      assert.strictEqual(at(json(response), 'name'), 'Echo Agent');
      // fetch adds `Cache-Control: no-cache` to a conditional request that
      // names none, and a no-cache request is never fresh, as in Express.
      const cached = yield* card({
        'If-None-Match': etag,
        'Cache-Control': 'max-age=0',
      });
      assert.strictEqual(cached.status, 304);
      assert.strictEqual(cached.text, '');
      assert.strictEqual(cached.headers['etag'], etag);
      const stale = yield* card({
        'If-None-Match': 'W/"0000000000000000"',
        'Cache-Control': 'max-age=0',
      });
      assert.strictEqual(stale.status, 200);
      const noCache = yield* card({
        'If-None-Match': etag,
        'Cache-Control': 'no-cache',
      });
      assert.strictEqual(noCache.status, 200);
    })
  );
});
