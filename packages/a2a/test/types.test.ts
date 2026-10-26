/**
 * The ProtoJSON schemas of the v1.0 data model.
 */
import { Task as RefTask } from '@a2a-js/sdk';
import { assert, it } from '@effect/vitest';
import { Effect, Exit, Schema } from 'effect';
import {
  AgentCard,
  ListTasksResponse,
  Message,
  Part,
  StreamResponse,
  Task,
  TaskStatus,
} from '../src/index.js';
import { pageTasks } from '../src/server/index.js';

const decode = <T, E>(schema: Schema.Codec<T, E>) =>
  Schema.decodeUnknownSync(schema);
const encode = <T, E>(schema: Schema.Codec<T, E>) => Schema.encodeSync(schema);
const fails = <T, E>(schema: Schema.Codec<T, E>, input: unknown) =>
  Exit.isFailure(Schema.decodeUnknownExit(schema)(input));

it('decodes missing REQUIRED fields to their defaults and encodes them', () => {
  const message = decode(Message)({});
  assert.deepStrictEqual(message, {
    messageId: '',
    role: 'ROLE_UNSPECIFIED',
    parts: [],
  });
  assert.deepStrictEqual(encode(Message)(message), {
    messageId: '',
    role: 'ROLE_UNSPECIFIED',
    parts: [],
  });
  const card = decode(AgentCard)({ name: 'n' });
  assert.deepStrictEqual(card.capabilities, {});
  assert.deepStrictEqual(card.skills, []);
});

it('decodes an enum number to its name and encodes the name', () => {
  assert.strictEqual(
    decode(TaskStatus)({ state: 3 }).state,
    'TASK_STATE_COMPLETED'
  );
  assert.strictEqual(decode(Message)({ role: 2 }).role, 'ROLE_AGENT');
  assert.ok(fails(TaskStatus, { state: 'COMPLETED' }));
  assert.ok(fails(TaskStatus, { state: 99 }));
});

it('drops unknown fields', () => {
  const task = decode(Task)({
    id: 't',
    status: { state: 'TASK_STATE_WORKING' },
    extra: 1,
  });
  assert.deepStrictEqual(encode(Task)(task), {
    id: 't',
    status: { state: 'TASK_STATE_WORKING' },
  });
});

it('reads a oneof by its member key', () => {
  const raw = decode(Part)({ raw: 'aGVsbG8=', mediaType: 'text/plain' });
  assert.ok('raw' in raw);
  assert.strictEqual(new TextDecoder().decode(raw.raw), 'hello');
  assert.deepStrictEqual(encode(Part)(raw), {
    raw: 'aGVsbG8=',
    mediaType: 'text/plain',
  });
  assert.ok('data' in decode(Part)({ data: { a: [1, true] } }));
  assert.ok(fails(Part, { mediaType: 'text/plain' }));
  const event = decode(StreamResponse)({
    statusUpdate: {
      taskId: 't',
      contextId: 'c',
      status: { state: 'TASK_STATE_WORKING' },
    },
  });
  assert.ok('statusUpdate' in event);
  assert.ok(fails(StreamResponse, {}));
});

it('accepts RFC 3339 timestamps only', () => {
  assert.ok(!fails(TaskStatus, { timestamp: '2026-10-23T10:00:00.123Z' }));
  assert.ok(!fails(TaskStatus, { timestamp: '2026-10-23T10:00:00+01:00' }));
  assert.ok(fails(TaskStatus, { timestamp: 'yesterday' }));
});

it('always encodes the four fields of ListTasksResponse', () => {
  assert.deepStrictEqual(
    encode(ListTasksResponse)(decode(ListTasksResponse)({})),
    {
      tasks: [],
      nextPageToken: '',
      pageSize: 0,
      totalSize: 0,
    }
  );
});

it.effect('round trips a task through the reference codec', () =>
  Effect.sync(() => {
    const wire = {
      id: 't-1',
      contextId: 'c-1',
      status: {
        state: 'TASK_STATE_INPUT_REQUIRED',
        timestamp: '2026-10-23T10:00:00.000Z',
        message: {
          messageId: 'm',
          role: 'ROLE_AGENT',
          parts: [{ text: 'more?' }],
        },
      },
      artifacts: [
        {
          artifactId: 'a',
          parts: [
            { url: 'https://example.com/f', filename: 'f.txt' },
            { raw: 'AQID' },
          ],
        },
      ],
      history: [
        { messageId: 'u', role: 'ROLE_USER', parts: [{ data: { q: 1 } }] },
      ],
      metadata: { k: 'v' },
    } as const;
    const ours = encode(Task)(decode(Task)(wire));
    assert.deepStrictEqual(ours, wire);
    assert.deepStrictEqual(RefTask.toJSON(RefTask.fromJSON(ours)), wire);
  })
);

it('normalises a timestamp with an offset to UTC Z form', () => {
  const status = decode(TaskStatus)({ timestamp: '2026-10-23T10:00:00+01:00' });
  assert.strictEqual(status.timestamp, '2026-10-23T09:00:00.000Z');
});

it('reads an int32 written as a JSON string and writes a number', () => {
  const response = decode(ListTasksResponse)({ pageSize: '10', totalSize: 3 });
  assert.strictEqual(response.pageSize, 10);
  assert.strictEqual(encode(ListTasksResponse)(response).pageSize, 10);
  assert.ok(fails(ListTasksResponse, { pageSize: '1.5' }));
});

it.effect('orders a task list by status time, not by timestamp text', () =>
  Effect.gen(function* () {
    const task = (id: string, timestamp: string): Task => ({
      id,
      status: { state: 'TASK_STATE_COMPLETED', timestamp },
    });
    // As text, "…00Z" sorts after "…00.500Z"; in time it is earlier.
    const page = yield* pageTasks(
      [
        task('whole', '2026-10-23T00:00:00Z'),
        task('half', '2026-10-23T00:00:00.500Z'),
      ],
      { pageSize: 10 }
    );
    assert.deepStrictEqual(
      page.tasks.map((entry) => entry.id),
      ['half', 'whole']
    );
  })
);
