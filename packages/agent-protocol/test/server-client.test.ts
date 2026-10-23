import { assert, layer } from '@effect/vitest';
import { Effect, Option, Ref, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  AgentProtocolClient,
  Step,
  StepFailed,
  StepResult,
  Task,
  TaskId,
  TaskListResponse,
  TaskStepsListResponse,
} from '../src/index.js';
import type { TaskHandler } from '../src/index.js';
import { testServer } from './support.js';

/**
 * Counts the steps of each task, marks the third step as the last one, and
 * echoes whether the step had a body. A step with input "fail" fails.
 */
const countingHandler: TaskHandler = Effect.fnUntraced(function* (task) {
  const count = yield* Ref.make(0);
  return (input) =>
    Option.exists(
      Option.flatMap(input, (body) => body.input),
      (text) => text === 'fail'
    )
      ? Effect.fail(
          new StepFailed({ message: `step of ${task.task_id} failed` })
        )
      : Ref.updateAndGet(count, (n) => n + 1).pipe(
          Effect.map(
            (n) =>
              new StepResult({
                name: Option.some(`step ${n}`),
                output: Option.some(
                  Option.isSome(input) ? 'with body' : 'without body'
                ),
                is_last: n === 3,
              })
          )
        );
});

const MessageBody = Schema.Struct({ message: Schema.String }).annotate({
  identifier: 'MessageBody',
});

const emptyTask = { input: Option.none(), additional_input: Option.none() };

const stepWith = (text: string) => ({
  input: Option.some(text),
  additional_input: Option.none(),
});

/** Sends a raw request and returns the status and the body text. */
const send = Effect.fnUntraced(function* (
  request: HttpClientRequest.HttpClientRequest
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(request);
  return { status: response.status, body: yield* response.text };
});

const decodeJson = <
  S extends Schema.Top & { readonly DecodingServices: never },
>(
  schema: S
) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.toCodecJson(schema)));

layer(testServer(countingHandler), { excludeTestServices: true })(
  'server and client',
  (it) => {
    it.effect('runs steps until is_last and lists the three steps', () =>
      Effect.gen(function* () {
        const client = yield* AgentProtocolClient;
        const task = yield* client.createAgentTask({
          payload: {
            input: Option.some('write a poem'),
            additional_input: Option.some({ debug: false }),
          },
        });
        assert.deepStrictEqual(task.input, Option.some('write a poem'));
        assert.deepStrictEqual(
          task.additional_input,
          Option.some({ debug: false })
        );
        assert.deepStrictEqual(task.artifacts, []);

        type ExecuteError = Effect.Error<
          ReturnType<typeof client.executeAgentTaskStep>
        >;
        const runUntilLast = (
          done: ReadonlyArray<Step>
        ): Effect.Effect<ReadonlyArray<Step>, ExecuteError> =>
          client
            .executeAgentTaskStep({
              params: { task_id: task.task_id },
              payload: stepWith(`input ${done.length + 1}`),
            })
            .pipe(
              Effect.flatMap((step) =>
                step.is_last || done.length > 5
                  ? Effect.succeed([...done, step])
                  : runUntilLast([...done, step])
              )
            );
        const steps = yield* runUntilLast([]);
        for (const step of steps) {
          assert.strictEqual(step.task_id, task.task_id);
          assert.strictEqual(step.status, 'completed');
        }
        assert.strictEqual(steps.length, 3);
        assert.deepStrictEqual(
          steps.map((step) => step.name),
          [1, 2, 3].map((n) => Option.some(`step ${n}`))
        );

        const listed = yield* client.listAgentTaskSteps({
          params: { task_id: task.task_id },
          query: {},
        });
        assert.deepStrictEqual(listed.steps, steps);
        assert.deepStrictEqual(listed.pagination, {
          total_items: 3,
          total_pages: 1,
          current_page: 1,
          page_size: 10,
        });

        const fetched = yield* client.getAgentTaskStep({
          params: { task_id: task.task_id, step_id: steps[1]!.step_id },
        });
        assert.deepStrictEqual(fetched, steps[1]);
        assert.deepStrictEqual(
          yield* client.getAgentTask({ params: { task_id: task.task_id } }),
          task
        );
      })
    );

    it.effect('decodes each wire response against the spec schemas', () =>
      Effect.gen(function* () {
        const created = yield* send(
          HttpClientRequest.post('/ap/v1/agent/tasks').pipe(
            HttpClientRequest.bodyText('{"input":"hi"}', 'application/json')
          )
        );
        assert.strictEqual(created.status, 200);
        const task = yield* decodeJson(Task)(created.body);

        const executed = yield* send(
          HttpClientRequest.post(
            `/ap/v1/agent/tasks/${task.task_id}/steps`
          ).pipe(
            HttpClientRequest.bodyText('{"input":"go"}', 'application/json')
          )
        );
        assert.strictEqual(executed.status, 200);
        const step = yield* decodeJson(Step)(executed.body);
        assert.deepStrictEqual(step.input, Option.some('go'));

        const steps = yield* send(
          HttpClientRequest.get(`/ap/v1/agent/tasks/${task.task_id}/steps`)
        );
        assert.strictEqual(
          (yield* decodeJson(TaskStepsListResponse)(steps.body)).steps.length,
          1
        );

        const tasks = yield* send(HttpClientRequest.get('/ap/v1/agent/tasks'));
        assert.isTrue(
          (yield* decodeJson(TaskListResponse)(tasks.body)).pagination
            .total_items >= 1
        );
      })
    );

    it.effect(
      'passes Option.none() to the step handler for a step without a body',
      () =>
        Effect.gen(function* () {
          const client = yield* AgentProtocolClient;
          const task = yield* client.createAgentTask({ payload: emptyTask });
          const response = yield* send(
            HttpClientRequest.post(`/ap/v1/agent/tasks/${task.task_id}/steps`)
          );
          assert.strictEqual(response.status, 200);
          const step = yield* decodeJson(Step)(response.body);
          assert.deepStrictEqual(step.output, Option.some('without body'));
          assert.deepStrictEqual(step.input, Option.none());
        })
    );

    it.effect('creates a task from a request without a body', () =>
      Effect.gen(function* () {
        const response = yield* send(
          HttpClientRequest.post('/ap/v1/agent/tasks')
        );
        assert.strictEqual(response.status, 200);
        const task = yield* decodeJson(Task)(response.body);
        assert.deepStrictEqual(task.input, Option.none());
      })
    );

    it.effect('answers 404 with a message body for unknown ids', () =>
      Effect.gen(function* () {
        const client = yield* AgentProtocolClient;
        const task = yield* client.createAgentTask({ payload: emptyTask });
        const paths = [
          '/ap/v1/agent/tasks/unknown',
          '/ap/v1/agent/tasks/unknown/steps',
          '/ap/v1/agent/tasks/unknown/artifacts',
          `/ap/v1/agent/tasks/${task.task_id}/steps/unknown`,
          `/ap/v1/agent/tasks/${task.task_id}/artifacts/unknown`,
        ];
        for (const path of paths) {
          const response = yield* send(HttpClientRequest.get(path));
          assert.strictEqual(response.status, 404, path);
          const body = yield* decodeJson(MessageBody)(response.body);
          assert.isTrue(body.message.length > 0, path);
          assert.notInclude(response.body, '_tag', path);
        }
        const error = yield* client
          .getAgentTask({ params: { task_id: TaskId.make('unknown') } })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, 'NotFound');
      })
    );

    it.effect('rejects bad paging with 422 and a JSON object body', () =>
      Effect.gen(function* () {
        for (const query of [
          'current_page=0',
          'page_size=0',
          'current_page=abc',
          'page_size=1.5',
        ]) {
          const response = yield* send(
            HttpClientRequest.get(`/ap/v1/agent/tasks?${query}`)
          );
          assert.strictEqual(response.status, 422, query);
          const body = yield* decodeJson(MessageBody)(response.body);
          assert.isTrue(body.message.length > 0, query);
        }
      })
    );

    it.effect('accepts properties that the spec does not name', () =>
      Effect.gen(function* () {
        const response = yield* send(
          HttpClientRequest.post('/ap/v1/agent/tasks').pipe(
            HttpClientRequest.bodyText(
              '{"input":"hi","extra":true}',
              'application/json'
            )
          )
        );
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(
          (yield* decodeJson(Task)(response.body)).input,
          Option.some('hi')
        );
      })
    );

    it.effect('rejects a malformed body with 422', () =>
      Effect.gen(function* () {
        const response = yield* send(
          HttpClientRequest.post('/ap/v1/agent/tasks').pipe(
            HttpClientRequest.bodyText('{"input":42}', 'application/json')
          )
        );
        assert.strictEqual(response.status, 422);
        yield* decodeJson(MessageBody)(response.body);
      })
    );

    it.effect(
      'answers 500 and stores no step when the step handler fails',
      () =>
        Effect.gen(function* () {
          const client = yield* AgentProtocolClient;
          const task = yield* client.createAgentTask({ payload: emptyTask });
          yield* client.executeAgentTaskStep({
            params: { task_id: task.task_id },
            payload: stepWith('ok'),
          });

          const error = yield* client
            .executeAgentTaskStep({
              params: { task_id: task.task_id },
              payload: stepWith('fail'),
            })
            .pipe(Effect.flip);
          assert.strictEqual(error._tag, 'InternalServerError');

          assert.deepStrictEqual(
            yield* client.getAgentTask({ params: { task_id: task.task_id } }),
            task
          );
          const listed = yield* client.listAgentTaskSteps({
            params: { task_id: task.task_id },
            query: {},
          });
          assert.strictEqual(listed.steps.length, 1);
          assert.deepStrictEqual(listed.steps[0]!.input, Option.some('ok'));
        })
    );
  }
);

layer(testServer(countingHandler), { excludeTestServices: true })(
  'paging',
  (it) => {
    it.effect('pages tasks with the default page size of 10', () =>
      Effect.gen(function* () {
        const client = yield* AgentProtocolClient;
        yield* Effect.forEach(
          Array.from({ length: 12 }),
          () => client.createAgentTask({ payload: emptyTask }),
          {
            discard: true,
          }
        );

        const first = yield* client.listAgentTasks({ query: {} });
        assert.strictEqual(first.tasks.length, 10);
        assert.deepStrictEqual(first.pagination, {
          total_items: 12,
          total_pages: 2,
          current_page: 1,
          page_size: 10,
        });

        const second = yield* client.listAgentTasks({
          query: { current_page: 2 },
        });
        assert.strictEqual(second.tasks.length, 2);
        assert.deepStrictEqual(second.pagination, {
          total_items: 12,
          total_pages: 2,
          current_page: 2,
          page_size: 10,
        });

        const all = yield* client.listAgentTasks({ query: { page_size: 25 } });
        assert.strictEqual(all.tasks.length, 12);
        assert.deepStrictEqual(all.tasks.slice(0, 10), first.tasks);
      })
    );
  }
);
