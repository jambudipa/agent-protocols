/**
 * The SQL stores on in-memory SQLite: the migrations, and task and push
 * config results that equal those of the in-memory stores for the same
 * calls.
 */
import { NodeCrypto } from '@effect/platform-node';
import { SqliteClient } from '@effect/sql-sqlite-node';
import { assert, layer } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
  ServerCallContext,
  type ListTasksParams,
} from '../src/server/index.js';
import { applyHistoryLength } from '../src/server/internal/utils.js';
import {
  BASE,
  allStoreMigrations,
  makeStoreMigrator,
  migrateToLatest,
  SqlPushNotificationStore,
  SqlTaskStore,
} from '../src/server/sql/index.js';
import type { Task, TaskState } from '../src/index.js';

const sqlite = Layer.fresh(SqliteClient.layer({ filename: ':memory:' }));

const tableNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly name: string;
  }>`select name from sqlite_master where type in ('table', 'index') order by name`;
  return rows.map((row) => row.name);
});

const states: ReadonlyArray<TaskState> = [
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_INPUT_REQUIRED',
];

/** Eight tasks over two contexts, with distinct and shared timestamps. */
const tasks: ReadonlyArray<Task> = Array.from({ length: 8 }, (_, index) => ({
  id: `task-${index}`,
  ...(index === 7 ? {} : { contextId: index % 2 === 0 ? 'ctx-a' : 'ctx-b' }),
  status: {
    state: states[index % states.length] ?? 'TASK_STATE_WORKING',
    timestamp: `2026-10-0${1 + Math.floor(index / 2)}T10:00:00.000Z`,
    ...(index === 3
      ? {
          message: {
            messageId: 'status-3',
            role: 'ROLE_AGENT' as const,
            parts: [{ text: 'status' }],
          },
        }
      : {}),
  },
  ...(index % 3 === 0
    ? {
        artifacts: [
          {
            artifactId: `art-${index}`,
            name: 'out',
            parts: [{ data: { n: index } }, { raw: new Uint8Array([1, 2]) }],
          },
        ],
      }
    : {}),
  ...(index % 2 === 0
    ? {
        history: [
          {
            messageId: `m-${index}`,
            role: 'ROLE_USER' as const,
            parts: [{ text: `hi ${index}` }],
          },
        ],
      }
    : {}),
  ...(index === 5 ? { metadata: { k: 'v', nested: { a: [1, true] } } } : {}),
}));

layer(Layer.mergeAll(sqlite, NodeCrypto.layer), { excludeTestServices: true })(
  'SQL migrations',
  (it) => {
    it.effect('applies, reports and reverts the reference schema', () =>
      Effect.gen(function* () {
        const stores = yield* allStoreMigrations();
        const migrators = yield* Effect.forEach(stores, makeStoreMigrator);
        for (const migrator of migrators) {
          const before = yield* migrator.status;
          assert.isTrue(
            before.every((state) => Option.isNone(state.executedAt))
          );
        }
        yield* migrateToLatest();
        yield* migrateToLatest();
        for (const migrator of migrators) {
          const after = yield* migrator.status;
          assert.isTrue(
            after.every((state) => Option.isSome(state.executedAt))
          );
        }
        assert.deepStrictEqual(
          (yield* tableNames).filter((name) => !name.startsWith('sqlite_')),
          [
            'a2a_migrations_lock',
            'a2a_push_notification_configs_migrations',
            'a2a_tasks_migrations',
            'push_notification_configs',
            'tasks',
            'tasks_scope_context_updated_idx',
            'tasks_scope_updated_idx',
          ]
        );
        const [push, task] = migrators;
        assert.deepStrictEqual(
          yield* task!.migrateDown,
          Option.some('0001_create_tasks')
        );
        assert.deepStrictEqual(yield* task!.migrateDown, Option.none());
        assert.deepStrictEqual(yield* push!.revertTo(BASE), [
          '0001_create_push_notification_configs',
        ]);
        assert.isFalse((yield* tableNames).includes('tasks'));
        assert.isFalse(
          (yield* tableNames).includes('push_notification_configs')
        );
        const failed = yield* Effect.flip(task!.revertTo('0001_create_tasks'));
        assert.include(failed.message, 'is not applied to the tasks store');
      })
    );
  }
);

const migrated = Layer.effectDiscard(migrateToLatest()).pipe(
  Layer.provideMerge(sqlite),
  Layer.provideMerge(NodeCrypto.layer)
);

layer(migrated, { excludeTestServices: true })('SQL stores', (it) => {
  const contexts = Effect.all({
    anonymous: ServerCallContext.make(),
    tenant: ServerCallContext.make({ tenant: 't1' }),
    alice: ServerCallContext.make({
      user: { isAuthenticated: true, userName: 'alice' },
    }),
  });

  it.effect('saves, loads and lists tasks as the in-memory store does', () =>
    Effect.gen(function* () {
      const sqlStore = yield* SqlTaskStore.make();
      const memory = yield* InMemoryTaskStore.make;
      const { anonymous, tenant, alice } = yield* contexts;
      for (const store of [sqlStore, memory]) {
        for (const task of tasks) yield* store.save(task, anonymous);
        yield* store.save(tasks[0]!, tenant);
        yield* store.save(
          { ...tasks[1]!, status: { state: 'TASK_STATE_FAILED' } },
          alice
        );
        // An update replaces every column, including cleared ones.
        yield* store.save(
          { id: 'task-6', contextId: 'ctx-a', status: tasks[6]!.status },
          anonymous
        );
      }
      for (const context of [anonymous, tenant, alice]) {
        for (const id of [...tasks.map((task) => task.id), 'missing']) {
          assert.deepStrictEqual(
            yield* sqlStore.load(id, context),
            yield* memory.load(id, context),
            `load ${id}`
          );
        }
      }
      const variants: ReadonlyArray<Omit<ListTasksParams, 'pageSize'>> = [
        {},
        { includeArtifacts: true },
        { contextId: 'ctx-a' },
        { status: 'TASK_STATE_COMPLETED', includeArtifacts: true },
        { statusTimestampAfter: '2026-10-02T10:00:00.000Z' },
        { historyLength: 0 },
        { status: 'TASK_STATE_UNSPECIFIED', contextId: 'ctx-b' },
      ];
      for (const variant of variants) {
        for (const pageSize of [3, 50]) {
          for (const context of [anonymous, alice]) {
            let sqlToken = '';
            let memoryToken = '';
            do {
              const params = { ...variant, pageSize };
              const fromSql = yield* sqlStore.list(
                { ...params, pageToken: sqlToken },
                context
              );
              const fromMemory = yield* memory.list(
                { ...params, pageToken: memoryToken },
                context
              );
              const trim = (task: Task) =>
                applyHistoryLength(task, variant.historyLength);
              assert.deepStrictEqual(
                { ...fromSql, tasks: fromSql.tasks.map(trim) },
                { ...fromMemory, tasks: fromMemory.tasks.map(trim) },
                `list ${Object.entries(params).join(';')} after "${sqlToken}"`
              );
              sqlToken = fromSql.nextPageToken;
              memoryToken = fromMemory.nextPageToken;
            } while (sqlToken !== '');
          }
        }
      }
      const malformed = yield* Effect.flip(
        sqlStore.list({ pageSize: 2, pageToken: 'bm8gYmFy' }, anonymous)
      );
      assert.strictEqual(malformed._tag, 'RequestMalformedError');
    })
  );

  it.effect('saves, loads and deletes push configs as in memory', () =>
    Effect.gen(function* () {
      const sqlStore = yield* SqlPushNotificationStore.make();
      const memory = yield* InMemoryPushNotificationStore.make;
      const { anonymous, tenant } = yield* contexts;
      const v1 = yield* ServerCallContext.make({ requestedVersion: '1.0' });
      const sorted = <A extends { readonly config: { readonly id?: string } }>(
        entries: ReadonlyArray<A>
      ) =>
        [...entries].sort((a, b) =>
          (a.config.id ?? '').localeCompare(b.config.id ?? '')
        );
      for (const store of [sqlStore, memory]) {
        // The request handler always passes the task id of the path.
        yield* store.save('task-1', v1, {
          id: 'cfg-1',
          taskId: 'task-1',
          url: 'https://hooks.example/one',
          token: 'secret',
        });
        yield* store.save('task-1', anonymous, {
          id: 'cfg-2',
          taskId: 'task-1',
          url: 'https://hooks.example/two',
          authentication: { scheme: 'Bearer', credentials: 'abc' },
        });
        yield* store.save('task-1', v1, {
          id: 'cfg-1',
          taskId: 'task-1',
          url: 'https://hooks.example/one-replaced',
        });
        yield* store.save('task-2', tenant, {
          id: 'cfg-3',
          taskId: 'task-2',
          tenant: 't1',
          url: 'https://hooks.example/three',
        });
        yield* store.delete('task-1', anonymous, 'cfg-2');
        yield* store.delete('task-1', anonymous, 'missing');
      }
      for (const [taskId, context] of [
        ['task-1', v1],
        ['task-1', anonymous],
        ['task-2', tenant],
        ['task-2', anonymous],
      ] as const) {
        assert.deepStrictEqual(
          sorted(yield* sqlStore.loadWithMetadata(taskId, context)),
          sorted(yield* memory.loadWithMetadata(taskId, context)),
          `${taskId} ${context.tenant}`
        );
      }
      const generated = yield* sqlStore.save('task-9', anonymous, {
        taskId: 'task-9',
        url: 'https://hooks.example/new',
      });
      assert.match(generated.id ?? '', /^[0-9a-f-]{36}$/);
      assert.deepStrictEqual(
        (yield* sqlStore.load('task-9', anonymous)).map((config) => config.id),
        [generated.id]
      );
    })
  );
});
