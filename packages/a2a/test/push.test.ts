/**
 * Push notifications: a local webhook receives the task events of a task
 * with a push config.
 */
import { NodeHttpServer } from '@effect/platform-node';
import { assert, layer } from '@effect/vitest';
import { Context, Effect, Layer, Queue, Schema } from 'effect';
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { createServer } from 'node:http';
import { StreamResponse } from '../src/index.js';
import { at, json, nextId, rest, userMessage } from './http.js';
import { testServer } from './support.js';

/** One webhook delivery. */
interface Delivery {
  readonly authorization: string;
  readonly token: string;
  readonly contentType: string;
  readonly body: string;
}

/** A webhook server on its own ephemeral port that queues every POST. */
class Webhook extends Context.Service<
  Webhook,
  { readonly url: string; readonly deliveries: Queue.Queue<Delivery> }
>()('@jambudipa/a2a/test/Webhook') {
  static readonly layer = Layer.effect(
    Webhook,
    Effect.gen(function* () {
      const deliveries = yield* Queue.unbounded<Delivery>();
      const routes = HttpRouter.add(
        'POST',
        '/hook',
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          yield* Queue.offer(deliveries, {
            authorization: request.headers['authorization'] ?? '',
            token: request.headers['x-a2a-notification-token'] ?? '',
            contentType: request.headers['content-type'] ?? '',
            body: yield* Effect.orDie(request.text),
          });
          return HttpServerResponse.empty({ status: 200 });
        })
      );
      const context = yield* Layer.build(
        HttpRouter.serve(routes, {
          disableLogger: true,
          disableListenLog: true,
        }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 }))
        )
      );
      const server = Context.get(context, HttpServer.HttpServer);
      const port =
        server.address._tag === 'UnixPathAddress' ? 0 : server.address.port;
      return Webhook.of({ url: `http://127.0.0.1:${port}/hook`, deliveries });
    })
  );
}

/** Webhook delivery waits on background fibers; a loaded run needs time. */
const PUSH_TIMEOUT = 30_000;

const decodeEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(StreamResponse)
);

layer(Layer.merge(testServer(), Webhook.layer), { excludeTestServices: true })(
  'push notifications',
  (it) => {
    it.effect(
      'POSTs each event to the webhook with the Authorization header',
      () =>
        Effect.gen(function* () {
          const webhook = yield* Webhook;
          const response = yield* rest('POST', '/message:send', {
            body: {
              message: userMessage(nextId(), 'push me'),
              configuration: {
                taskPushNotificationConfig: {
                  url: webhook.url,
                  authentication: {
                    scheme: 'Bearer',
                    credentials: 'webhook-secret',
                  },
                },
              },
            },
          });
          const taskId = at(json(response), 'task', 'id');
          const deliveries = yield* Effect.forEach([1, 2, 3, 4], () =>
            Queue.take(webhook.deliveries)
          );
          for (const delivery of deliveries) {
            assert.strictEqual(delivery.authorization, 'Bearer webhook-secret');
            assert.strictEqual(delivery.contentType, 'application/a2a+json');
          }
          const events = deliveries.map((delivery) =>
            decodeEvent(delivery.body)
          );
          assert.deepStrictEqual(
            events.map((event) => Object.keys(event)[0]),
            ['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
          );
          const last = events.at(-1);
          assert.ok(last !== undefined && 'statusUpdate' in last);
          assert.strictEqual(last.statusUpdate.taskId, taskId);
          assert.strictEqual(
            last.statusUpdate.status.state,
            'TASK_STATE_COMPLETED'
          );
        }),
      PUSH_TIMEOUT
    );

    it.effect(
      'sends a config token in X-A2A-Notification-Token',
      () =>
        Effect.gen(function* () {
          const webhook = yield* Webhook;
          const task = at(
            json(
              yield* rest('POST', '/message:send', {
                body: {
                  message: userMessage(nextId(), 'input'),
                },
              })
            ),
            'task'
          );
          const id = at(task, 'id') as string;
          const created = yield* rest(
            'POST',
            `/tasks/${id}/pushNotificationConfigs`,
            {
              body: { url: webhook.url, token: 'opaque-token' },
            }
          );
          assert.strictEqual(created.status, 201);
          yield* rest('POST', `/tasks/${id}:cancel`);
          const delivery = yield* Queue.take(webhook.deliveries);
          assert.strictEqual(delivery.token, 'opaque-token');
          assert.strictEqual(delivery.authorization, '');
          const event = decodeEvent(delivery.body);
          assert.ok('statusUpdate' in event);
          assert.strictEqual(
            event.statusUpdate.status.state,
            'TASK_STATE_CANCELED'
          );
        }),
      PUSH_TIMEOUT
    );
  }
);
