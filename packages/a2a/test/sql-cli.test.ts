/**
 * `a2a-db`: the offline SQL equals the output of the reference CLI of
 * `@a2a-js/sdk` 1.3.0, the checks print the reference messages, and the
 * online commands migrate a SQLite file.
 */
import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { Console, Effect, Exit, FileSystem, Path } from 'effect';
import { run } from '../src/server/sql/Cli.js';

/**
 * The output of the reference `a2a-db upgrade --sql --dialect <d>`, rendered
 * with kysely 0.29.7; the timestamps are replaced with `TS`.
 */
const REFERENCE_UPGRADE = {
  postgres: `-- @a2a-js/sdk schema for postgres: base -> latest.
-- Rendered offline: nothing read the database, so this assumes it is at "base".
-- Each store's ledger is kept in step, so \`a2a-db status\` keeps matching the schema.
-- Not wrapped in a transaction. Check the ledger if it stops partway.

-- store: push-notification-configs

create table if not exists "a2a_push_notification_configs_migrations" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);

create table "push_notification_configs" ("tenant" varchar(255) collate "C" not null, "owner" varchar(255) collate "C" not null, "task_id" varchar(36) collate "C" not null, "config_id" varchar(36) collate "C" not null, "config_data" text, "protocol_version" varchar(255), constraint "push_notification_configs_pkey" primary key ("tenant", "owner", "task_id", "config_id"));

insert into "a2a_push_notification_configs_migrations" ("name", "timestamp") values ('0001_create_push_notification_configs', 'TS');

-- store: tasks

create table if not exists "a2a_tasks_migrations" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);

create table "tasks" ("tenant" varchar(255) collate "C" not null, "owner" varchar(255) collate "C" not null, "id" varchar(36) collate "C" not null, "context_id" varchar(36) collate "C" not null, "status_last_updated" bigint not null, "status_state" varchar(255) collate "C", "status" text, "artifacts" text, "history" text, "metadata" text, "protocol_version" varchar(255), constraint "tasks_pkey" primary key ("tenant", "owner", "id"));

create index "tasks_scope_updated_idx" on "tasks" ("tenant", "owner", "status_last_updated", "id");

create index "tasks_scope_context_updated_idx" on "tasks" ("tenant", "owner", "context_id", "status_last_updated", "id");

insert into "a2a_tasks_migrations" ("name", "timestamp") values ('0001_create_tasks', 'TS');`,
  mysql: `-- @a2a-js/sdk schema for mysql: base -> latest.
-- Rendered offline: nothing read the database, so this assumes it is at "base".
-- Each store's ledger is kept in step, so \`a2a-db status\` keeps matching the schema.
-- Not wrapped in a transaction. Check the ledger if it stops partway.

-- store: push-notification-configs

create table if not exists \`a2a_push_notification_configs_migrations\` (\`name\` varchar(255) not null primary key, \`timestamp\` varchar(255) not null);

create table \`push_notification_configs\` (\`tenant\` varchar(255) collate utf8mb4_0900_bin not null, \`owner\` varchar(255) collate utf8mb4_0900_bin not null, \`task_id\` varchar(36) collate utf8mb4_0900_bin not null, \`config_id\` varchar(36) collate utf8mb4_0900_bin not null, \`config_data\` text, \`protocol_version\` varchar(255), constraint \`push_notification_configs_pkey\` primary key (\`tenant\`, \`owner\`, \`task_id\`, \`config_id\`));

insert into \`a2a_push_notification_configs_migrations\` (\`name\`, \`timestamp\`) values ('0001_create_push_notification_configs', 'TS');

-- store: tasks

create table if not exists \`a2a_tasks_migrations\` (\`name\` varchar(255) not null primary key, \`timestamp\` varchar(255) not null);

create table \`tasks\` (\`tenant\` varchar(255) collate utf8mb4_0900_bin not null, \`owner\` varchar(255) collate utf8mb4_0900_bin not null, \`id\` varchar(36) collate utf8mb4_0900_bin not null, \`context_id\` varchar(36) collate utf8mb4_0900_bin not null, \`status_last_updated\` bigint not null, \`status_state\` varchar(255) collate utf8mb4_0900_bin, \`status\` longtext, \`artifacts\` longtext, \`history\` longtext, \`metadata\` longtext, \`protocol_version\` varchar(255), constraint \`tasks_pkey\` primary key (\`tenant\`, \`owner\`, \`id\`));

create index \`tasks_scope_updated_idx\` on \`tasks\` (\`tenant\`, \`owner\`, \`status_last_updated\`, \`id\`);

create index \`tasks_scope_context_updated_idx\` on \`tasks\` (\`tenant\`, \`owner\`, \`context_id\`, \`status_last_updated\`, \`id\`);

insert into \`a2a_tasks_migrations\` (\`name\`, \`timestamp\`) values ('0001_create_tasks', 'TS');`,
  sqlite: `-- @a2a-js/sdk schema for sqlite: base -> latest.
-- Rendered offline: nothing read the database, so this assumes it is at "base".
-- Each store's ledger is kept in step, so \`a2a-db status\` keeps matching the schema.
-- Not wrapped in a transaction. Check the ledger if it stops partway.

-- store: push-notification-configs

create table if not exists "a2a_push_notification_configs_migrations" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);

create table "push_notification_configs" ("tenant" varchar(255) collate binary not null, "owner" varchar(255) collate binary not null, "task_id" varchar(36) collate binary not null, "config_id" varchar(36) collate binary not null, "config_data" text, "protocol_version" varchar(255), constraint "push_notification_configs_pkey" primary key ("tenant", "owner", "task_id", "config_id"));

insert into "a2a_push_notification_configs_migrations" ("name", "timestamp") values ('0001_create_push_notification_configs', 'TS');

-- store: tasks

create table if not exists "a2a_tasks_migrations" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);

create table "tasks" ("tenant" varchar(255) collate binary not null, "owner" varchar(255) collate binary not null, "id" varchar(36) collate binary not null, "context_id" varchar(36) collate binary not null, "status_last_updated" bigint not null, "status_state" varchar(255) collate binary, "status" text, "artifacts" text, "history" text, "metadata" text, "protocol_version" varchar(255), constraint "tasks_pkey" primary key ("tenant", "owner", "id"));

create index "tasks_scope_updated_idx" on "tasks" ("tenant", "owner", "status_last_updated", "id");

create index "tasks_scope_context_updated_idx" on "tasks" ("tenant", "owner", "context_id", "status_last_updated", "id");

insert into "a2a_tasks_migrations" ("name", "timestamp") values ('0001_create_tasks', 'TS');`,
} as const;

/** The reference `a2a-db downgrade --sql --dialect postgres`. */
const REFERENCE_DOWNGRADE_POSTGRES = `-- @a2a-js/sdk schema for postgres: latest -> the previous migration.
-- Rendered offline: nothing read the database, so this assumes it is at "latest".
-- Each store's ledger is kept in step, so \`a2a-db status\` keeps matching the schema.
-- Not wrapped in a transaction. Check the ledger if it stops partway.

-- store: push-notification-configs

drop table if exists "push_notification_configs";

delete from "a2a_push_notification_configs_migrations" where "name" = '0001_create_push_notification_configs';

-- store: tasks

drop table if exists "tasks";

delete from "a2a_tasks_migrations" where "name" = '0001_create_tasks';`;

/** The reference `a2a-db downgrade base --sql --dialect mysql`. */
const REFERENCE_DOWNGRADE_BASE_MYSQL = `-- @a2a-js/sdk schema for mysql: latest -> base.
-- Rendered offline: nothing read the database, so this assumes it is at "latest".
-- Each store's ledger is kept in step, so \`a2a-db status\` keeps matching the schema.
-- Not wrapped in a transaction. Check the ledger if it stops partway.

-- store: push-notification-configs

drop table if exists \`push_notification_configs\`;

delete from \`a2a_push_notification_configs_migrations\` where \`name\` = '0001_create_push_notification_configs';

-- store: tasks

drop table if exists \`tasks\`;

delete from \`a2a_tasks_migrations\` where \`name\` = '0001_create_tasks';`;

/** The reference `--tasks-table-name agent_tasks` statements for SQLite. */
const REFERENCE_RENAMED_SQLITE = [
  'create table if not exists "a2a_agent_tasks_migrations" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);',
  'create table "agent_tasks" ("tenant" varchar(255) collate binary not null, "owner" varchar(255) collate binary not null, "id" varchar(36) collate binary not null, "context_id" varchar(36) collate binary not null, "status_last_updated" bigint not null, "status_state" varchar(255) collate binary, "status" text, "artifacts" text, "history" text, "metadata" text, "protocol_version" varchar(255), constraint "agent_tasks_pkey" primary key ("tenant", "owner", "id"));',
  'create index "agent_tasks_scope_updated_idx" on "agent_tasks" ("tenant", "owner", "status_last_updated", "id");',
  'create index "agent_tasks_scope_context_updated_idx" on "agent_tasks" ("tenant", "owner", "context_id", "status_last_updated", "id");',
  'insert into "a2a_agent_tasks_migrations" ("name", "timestamp") values (\'0001_create_tasks\', \'TS\');',
];

const normalize = (text: string) =>
  text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TS')
    .replaceAll('@a2a-js/sdk', '@jambudipa/a2a')
    .trim();

/** Runs `a2a-db` and captures what it prints. */
const a2aDb = (...args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let out = '';
    let err = '';
    const ignore = () => {};
    const capture: Console.Console = {
      assert: ignore,
      clear: ignore,
      count: ignore,
      countReset: ignore,
      debug: ignore,
      dir: ignore,
      dirxml: ignore,
      error: (...values) => {
        err += `${values.map(String).join(' ')}\n`;
      },
      group: ignore,
      groupCollapsed: ignore,
      groupEnd: ignore,
      info: (...values) => {
        out += `${values.map(String).join(' ')}\n`;
      },
      log: (...values) => {
        out += `${values.map(String).join(' ')}\n`;
      },
      table: ignore,
      time: ignore,
      timeEnd: ignore,
      timeLog: ignore,
      trace: ignore,
      warn: (...values) => {
        err += `${values.map(String).join(' ')}\n`;
      },
    };
    const exit = yield* Effect.exit(
      run(args).pipe(Effect.provideService(Console.Console, capture))
    );
    return { out: out.trim(), err: err.trim(), ok: Exit.isSuccess(exit) };
  }).pipe(Effect.provide(NodeServices.layer));

describe('a2a-db', () => {
  for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
    it.effect(`prints the reference upgrade SQL for ${dialect}`, () =>
      Effect.gen(function* () {
        const result = yield* a2aDb('upgrade', '--sql', '--dialect', dialect);
        assert.isTrue(result.ok);
        assert.strictEqual(
          normalize(result.out),
          normalize(REFERENCE_UPGRADE[dialect])
        );
      })
    );
  }

  it.effect('prints the reference downgrade SQL', () =>
    Effect.gen(function* () {
      const previous = yield* a2aDb(
        'downgrade',
        '--sql',
        '--dialect',
        'postgres'
      );
      assert.strictEqual(
        normalize(previous.out),
        normalize(REFERENCE_DOWNGRADE_POSTGRES)
      );
      const base = yield* a2aDb(
        'downgrade',
        'base',
        '--sql',
        '--dialect',
        'mysql'
      );
      assert.strictEqual(
        normalize(base.out),
        normalize(REFERENCE_DOWNGRADE_BASE_MYSQL)
      );
      const renamed = yield* a2aDb(
        'upgrade',
        '--sql',
        '--dialect',
        'sqlite',
        '--store',
        'tasks',
        '--tasks-table-name',
        'agent_tasks'
      );
      assert.deepStrictEqual(
        normalize(renamed.out)
          .split('\n')
          .filter((line) => !line.startsWith('--') && line !== ''),
        REFERENCE_RENAMED_SQLITE
      );
    })
  );

  it.effect('rejects bad options with the reference messages', () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
        [
          ['upgrade', '--sql'],
          '--sql needs --dialect, one of: postgres, mysql, sqlite.',
        ],
        [
          ['status', '--sql', '--dialect', 'sqlite'],
          '--sql renders a migration; status only reports what the ledger holds.',
        ],
        [
          ['downgrade', '--sql', '--dialect', 'sqlite', '--from', 'base'],
          '"base" is where a downgrade ends, not where it starts. --from names the migration already applied, or "latest" for a fully migrated database.',
        ],
        [
          [
            'upgrade',
            '--sql',
            '--dialect',
            'sqlite',
            '--from',
            '0001_create_tasks',
          ],
          '"0001_create_tasks" is a migration name, which belongs to a single store\'s history, so it needs exactly one --store. Available: push-notification-configs, tasks.',
        ],
        [
          ['downgrade', 'latest', '--sql', '--dialect', 'sqlite'],
          '"latest" is where a downgrade starts, not where it stops. Pass "base" or a migration name.',
        ],
        [
          ['upgrade', '--sql', '--dialect', 'oracle'],
          'Unknown dialect "oracle". Expected one of: postgres, mysql, sqlite.',
        ],
        [
          ['upgrade', '--store', 'nope'],
          'Unknown store "nope". Expected one of: push-notification-configs, tasks.',
        ],
        [
          ['upgrade', '--dialect', 'sqlite', '--url', 'sqlite:x.db'],
          '--dialect only applies with --sql; a connected database names its own.',
        ],
        [
          ['status', '--url', 'oracle://db'],
          'Unsupported database URL scheme "oracle". Expected one of: postgres, postgresql, mysql, sqlite.',
        ],
        [
          ['status', '--url', 'sqlite:'],
          'No file in SQLite URL "sqlite:". Expected something like sqlite:./a2a.db.',
        ],
      ];
      for (const [args, message] of cases) {
        const result = yield* a2aDb(...args);
        assert.isFalse(result.ok, args.join(' '));
        assert.strictEqual(result.err, message, args.join(' '));
      }
      const nothing = yield* a2aDb(
        'upgrade',
        '--sql',
        '--dialect',
        'sqlite',
        '--store',
        'tasks',
        '--from',
        '0001_create_tasks'
      );
      assert.strictEqual(
        normalize(nothing.out),
        normalize(`-- @a2a-js/sdk schema for sqlite: 0001_create_tasks -> latest.
-- Rendered offline: nothing read the database, so this assumes it is at "0001_create_tasks".
-- Nothing to do: every selected store is already at latest.`)
      );
    })
  );

  it.effect('migrates a SQLite database online', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: 'a2a-db-',
        });
        const url = `sqlite:${path.join(directory, 'a2a.db')}`;
        const pending = yield* a2aDb('status', '--url', url);
        assert.strictEqual(
          pending.out,
          [
            'push-notification-configs',
            '  0001_create_push_notification_configs  pending',
            'tasks',
            '  0001_create_tasks  pending',
          ].join('\n')
        );
        const upgraded = yield* a2aDb('upgrade', '--url', url);
        assert.strictEqual(
          upgraded.out,
          'push-notification-configs: up to date\ntasks: up to date'
        );
        const applied = yield* a2aDb('status', '--url', url);
        assert.match(
          applied.out,
          /^tasks\n {2}0001_create_tasks {2}applied {2}\d{4}-\d{2}-\d{2}T[\d:.]+Z$/m
        );
        const reverted = yield* a2aDb(
          'downgrade',
          '--url',
          url,
          '--store',
          'tasks'
        );
        assert.strictEqual(reverted.out, 'tasks: reverted 0001_create_tasks');
        const again = yield* a2aDb(
          'downgrade',
          '--url',
          url,
          '--store',
          'tasks'
        );
        assert.strictEqual(again.out, 'tasks: nothing to revert');
        const notApplied = yield* a2aDb(
          'downgrade',
          '0001_create_tasks',
          '--url',
          url,
          '--store',
          'tasks'
        );
        assert.isFalse(notApplied.ok);
        assert.include(notApplied.err, 'is not applied to the tasks store');
        const base = yield* a2aDb('downgrade', 'base', '--url', url);
        assert.strictEqual(
          base.out,
          'push-notification-configs: now at base\ntasks: now at base'
        );
      }).pipe(Effect.provide(NodeServices.layer))
    )
  );
});
