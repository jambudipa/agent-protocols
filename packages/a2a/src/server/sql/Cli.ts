/**
 * `a2a-db`: schema management for the SQL stores, with the commands,
 * options and messages of the `a2a-db` CLI of `@a2a-js/sdk` 1.3.0.
 *
 * - `a2a-db status` shows the migration state of each store.
 * - `a2a-db upgrade` applies every pending migration.
 * - `a2a-db downgrade [<to>]` reverts the last migration, or every one
 *   after `<to>` (`base` reverts all).
 * - `--sql --dialect <postgres|mysql|sqlite>` prints the SQL of an upgrade
 *   or a downgrade instead of connecting to a database.
 *
 * The driver of a `--url` (or `DATABASE_URL`) is loaded only when the
 * command connects: `@effect/sql-pg` for `postgres://` and `postgresql://`,
 * `@effect/sql-mysql2` for `mysql://` and `@effect/sql-sqlite-node` for
 * `sqlite:`.
 *
 * @since 0.1.0
 */
import {
  Config,
  Console,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { SqlClient, SqlError } from 'effect/sql';
import { SQL_DIALECTS, type SqlDialect } from './Dialect.js';
import {
  BASE,
  LATEST,
  MIGRATION_LOCK_TABLE,
  PUSH_NOTIFICATION_STORE_ID,
  STORE_IDS,
  type StoreMigrations,
  TASK_STORE_ID,
  type TableNames,
  allStoreMigrations,
  makeStoreMigrator,
  migrationNames,
  renderMigrationScript,
} from './Migrations.js';

/**
 * The version that `a2a-db --version` prints.
 *
 * @since 0.1.0
 */
export const A2A_DB_VERSION = '0.1.0';

/**
 * A command of `a2a-db` was rejected or failed. The message is what the
 * command prints on standard error.
 *
 * @since 0.1.0
 */
export class A2aDbError extends Schema.TaggedError<A2aDbError>()('A2aDbError', {
  message: Schema.String,
}) {}

const fail = (message: string) => Effect.fail(new A2aDbError({ message }));

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

type Scheme = 'postgres' | 'postgresql' | 'mysql' | 'sqlite';

const DRIVERS: { readonly [S in Scheme]: string } = {
  postgres: '@effect/sql-pg',
  postgresql: '@effect/sql-pg',
  mysql: '@effect/sql-mysql2',
  sqlite: '@effect/sql-sqlite-node',
};

const isScheme = (value: string): value is Scheme => value in DRIVERS;

const schemeOf = (url: string): Effect.Effect<Scheme, A2aDbError> => {
  const colon = url.indexOf(':');
  if (colon <= 0) {
    return fail(
      `Missing scheme in database URL "${url}". Expected something like postgresql://host/db, mysql://host/db, or sqlite:./a2a.db.`
    );
  }
  const scheme = url.slice(0, colon).toLowerCase();
  return isScheme(scheme)
    ? Effect.succeed(scheme)
    : fail(
        `Unsupported database URL scheme "${scheme}". Expected one of: ${Object.keys(DRIVERS).join(', ')}.`
      );
};

const filePath = (url: string): Effect.Effect<string, A2aDbError> => {
  const path = url.slice(url.indexOf(':') + 1).replace(/^\/\//, '');
  return path === ''
    ? fail(
        `No file in SQLite URL "${url}". Expected something like sqlite:./a2a.db.`
      )
    : Effect.succeed(path);
};

const loadDriver = <A>(
  scheme: Scheme,
  load: () => Promise<A>
): Effect.Effect<A, A2aDbError> =>
  Effect.tryPromise({
    try: load,
    catch: (error) =>
      new A2aDbError({
        message: `A ${scheme}: URL needs the "${DRIVERS[scheme]}" package, which could not be loaded.\n${String(error)}\nIf it is missing: npm install ${DRIVERS[scheme]}`,
      }),
  });

/**
 * A `SqlClient` for a database URL, through the driver of its scheme, with
 * one connection, as the reference CLI connects.
 *
 * @since 0.1.0
 */
export const connect = (
  url: string
): Layer.Layer<
  SqlClient.SqlClient,
  A2aDbError | SqlError.SqlError | Config.ConfigError
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const scheme = yield* schemeOf(url);
      switch (scheme) {
        case 'postgres':
        case 'postgresql': {
          const { PgClient } = yield* loadDriver(
            scheme,
            () => import('@effect/sql-pg')
          );
          return PgClient.layer<never>({
            url: Redacted.make(url),
            maxConnections: 1,
            connectTimeout: '10 seconds',
          });
        }
        case 'mysql': {
          const { MysqlClient } = yield* loadDriver(
            scheme,
            () => import('@effect/sql-mysql2')
          );
          return MysqlClient.layer({
            url: Redacted.make(url),
            maxConnections: 1,
          });
        }
        case 'sqlite': {
          const filename = yield* filePath(url);
          const { SqliteClient } = yield* loadDriver(
            scheme,
            () => import('@effect/sql-sqlite-node')
          );
          return SqliteClient.layer({ filename });
        }
      }
    })
  );

// ---------------------------------------------------------------------------
// Argument checks
// ---------------------------------------------------------------------------

const tableNameFlag = (storeId: string) => `${storeId}-table-name`;

const resolveDialect = (
  requested: Option.Option<string>
): Effect.Effect<SqlDialect, A2aDbError> =>
  Option.match(requested, {
    onNone: () =>
      fail(`--sql needs --dialect, one of: ${SQL_DIALECTS.join(', ')}.`),
    onSome: (name) => {
      const dialect = SQL_DIALECTS.find((candidate) => candidate === name);
      return dialect === undefined
        ? fail(
            `Unknown dialect "${name}". Expected one of: ${SQL_DIALECTS.join(', ')}.`
          )
        : Effect.succeed(dialect);
    },
  });

const checkRevision = (
  revision: string,
  stores: ReadonlyArray<StoreMigrations>,
  accepted: ReadonlyArray<string>
): Effect.Effect<void, A2aDbError> => {
  if (accepted.includes(revision)) return Effect.void;
  if (!stores.some((store) => migrationNames(store).includes(revision))) {
    const histories = stores
      .map((store) => `${store.id} (${migrationNames(store).join(', ')})`)
      .join(', ');
    return fail(
      `"${revision}" is not a migration. Expected ${accepted.map((name) => `"${name}"`).join(', ')} or one of: ${histories}.`
    );
  }
  return stores.length === 1
    ? Effect.void
    : fail(
        `"${revision}" is a migration name, which belongs to a single store's history, so it needs exactly one --store. Available: ${STORE_IDS.join(', ')}.`
      );
};

const checkStart = (
  direction: 'up' | 'down',
  from: string
): Effect.Effect<void, A2aDbError> => {
  if (direction === 'up') {
    return from === LATEST
      ? fail(
          `"${LATEST}" is where an upgrade ends, not where it starts. --from names the migration already applied, or "${BASE}" for an empty database.`
        )
      : Effect.void;
  }
  return from === BASE
    ? fail(
        `"${BASE}" is where a downgrade ends, not where it starts. --from names the migration already applied, or "${LATEST}" for a fully migrated database.`
      )
    : Effect.void;
};

const checkDestination = (
  target: string,
  stores: ReadonlyArray<StoreMigrations>
): Effect.Effect<void, A2aDbError> =>
  target === LATEST
    ? fail(
        `"${LATEST}" is where a downgrade starts, not where it stops. Pass "${BASE}" or a migration name.`
      )
    : checkRevision(target, stores, [BASE]);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * The options that every command takes.
 *
 * @since 0.1.0
 */
export interface CommonOptions {
  readonly url: Option.Option<string>;
  readonly store: ReadonlyArray<string>;
  readonly tasksTableName: Option.Option<string>;
  readonly pushNotificationConfigsTableName: Option.Option<string>;
  readonly sql: boolean;
  readonly dialect: Option.Option<string>;
  readonly from: Option.Option<string>;
}

type CommandName = 'status' | 'upgrade' | 'downgrade';

const selectStores = (
  options: CommonOptions
): Effect.Effect<ReadonlyArray<StoreMigrations>, A2aDbError> =>
  Effect.gen(function* () {
    for (const id of options.store) {
      if (!(STORE_IDS as ReadonlyArray<string>).includes(id)) {
        return yield* fail(
          `Unknown store "${id}". Expected one of: ${STORE_IDS.join(', ')}.`
        );
      }
    }
    const named: Array<readonly [string, Option.Option<string>]> = [
      [PUSH_NOTIFICATION_STORE_ID, options.pushNotificationConfigsTableName],
      [TASK_STORE_ID, options.tasksTableName],
    ];
    for (const [id, name] of named) {
      if (Option.isSome(name) && name.value === '') {
        return yield* fail(`Empty table name in --${tableNameFlag(id)}.`);
      }
    }
    const tableNames: TableNames = {
      ...Option.match(options.pushNotificationConfigsTableName, {
        onNone: () => ({}),
        onSome: (name) => ({ [PUSH_NOTIFICATION_STORE_ID]: name }),
      }),
      ...Option.match(options.tasksTableName, {
        onNone: () => ({}),
        onSome: (name) => ({ [TASK_STORE_ID]: name }),
      }),
    };
    const all = yield* allStoreMigrations(tableNames).pipe(
      Effect.mapError((error) => new A2aDbError({ message: error.message }))
    );
    return options.store.length === 0
      ? all
      : all.filter((store) => options.store.includes(store.id));
  });

const runOffline = (
  command: CommandName,
  options: CommonOptions,
  stores: ReadonlyArray<StoreMigrations>,
  target: Option.Option<string>
) =>
  Effect.gen(function* () {
    if (command === 'status') {
      return yield* fail(
        '--sql renders a migration; status only reports what the ledger holds.'
      );
    }
    const upgrading = command === 'upgrade';
    const direction = upgrading ? 'up' : 'down';
    const from = Option.getOrElse(options.from, () =>
      upgrading ? BASE : LATEST
    );
    yield* checkStart(direction, from);
    yield* checkRevision(from, stores, [upgrading ? BASE : LATEST]);
    if (Option.isSome(target)) yield* checkDestination(target.value, stores);
    const dialect = yield* resolveDialect(options.dialect);
    const script = yield* renderMigrationScript({
      dialect,
      stores,
      from,
      to: upgrading ? Option.some(LATEST) : target,
      direction,
    }).pipe(
      Effect.mapError((error) => new A2aDbError({ message: error.message }))
    );
    yield* Console.log(script);
  });

const runOnline = (
  command: CommandName,
  stores: ReadonlyArray<StoreMigrations>,
  target: Option.Option<string>
) =>
  Effect.gen(function* () {
    for (const store of stores) {
      const migrator = yield* makeStoreMigrator(store);
      switch (command) {
        case 'status': {
          yield* Console.log(store.id);
          for (const state of yield* migrator.status) {
            yield* Console.log(
              `  ${state.name}  ${Option.match(state.executedAt, {
                onNone: () => 'pending',
                onSome: (at) => `applied  ${at}`,
              })}`
            );
          }
          break;
        }
        case 'upgrade': {
          yield* migrator.migrateToLatest;
          yield* Console.log(`${store.id}: up to date`);
          break;
        }
        case 'downgrade': {
          if (Option.isSome(target)) {
            yield* migrator.revertTo(target.value);
            yield* Console.log(`${store.id}: now at ${target.value}`);
          } else {
            const reverted = yield* migrator.migrateDown;
            yield* Console.log(
              Option.match(reverted, {
                onNone: () => `${store.id}: nothing to revert`,
                onSome: (name) => `${store.id}: reverted ${name}`,
              })
            );
          }
          break;
        }
      }
    }
  });

/**
 * Runs one `a2a-db` command: it checks the options as the reference CLI
 * does, then prints SQL (`--sql`) or migrates the database at `--url`.
 *
 * @since 0.1.0
 */
export const runCommand = (
  command: CommandName,
  options: CommonOptions,
  target: Option.Option<string> = Option.none()
): Effect.Effect<void, A2aDbError> =>
  Effect.gen(function* () {
    const stores = yield* selectStores(options);
    if (options.sql) {
      return yield* runOffline(command, options, stores, target);
    }
    if (Option.isSome(options.dialect)) {
      return yield* fail(
        '--dialect only applies with --sql; a connected database names its own.'
      );
    }
    if (Option.isSome(options.from)) {
      return yield* fail(
        '--from only applies with --sql; a connected database has a ledger.'
      );
    }
    if (command === 'downgrade' && Option.isSome(target)) {
      yield* checkDestination(target.value, stores);
    }
    if (Option.isNone(options.url)) {
      return yield* fail(
        'No database URL. Pass --url <database-url> or set DATABASE_URL.'
      );
    }
    yield* runOnline(command, stores, target).pipe(
      Effect.provide(connect(options.url.value)),
      Effect.mapError((error) =>
        error._tag === 'A2aDbError'
          ? error
          : new A2aDbError({ message: error.message })
      )
    );
  }).pipe(Effect.tapError((error) => Console.error(error.message)));

const commonFlags = {
  url: Flag.String('url').pipe(
    Flag.withDescription(
      'Database URL (postgresql://, postgres://, mysql://, sqlite:). Defaults to the DATABASE_URL environment variable.'
    ),
    Flag.withFallbackConfig(Config.String('DATABASE_URL')),
    Flag.optional
  ),
  store: Flag.String('store').pipe(
    Flag.withDescription(
      `Target a specific store (repeatable). Default: all stores. Required when naming a migration. Available: ${STORE_IDS.join(', ')}.`
    ),
    Flag.atLeast(0)
  ),
  tasksTableName: Flag.String(tableNameFlag(TASK_STORE_ID)).pipe(
    Flag.withDescription('Override the table name of the tasks store.'),
    Flag.optional
  ),
  pushNotificationConfigsTableName: Flag.String(
    tableNameFlag(PUSH_NOTIFICATION_STORE_ID)
  ).pipe(
    Flag.withDescription(
      'Override the table name of the push-notification-configs store.'
    ),
    Flag.optional
  ),
  sql: Flag.Boolean('sql').pipe(
    Flag.withDescription(
      'Print SQL statements instead of connecting to a database.'
    ),
    Flag.withDefault(false)
  ),
  dialect: Flag.String('dialect').pipe(
    Flag.withDescription(
      `Target SQL dialect: ${SQL_DIALECTS.join(', ')}. Required with --sql.`
    ),
    Flag.optional
  ),
  from: Flag.String('from').pipe(
    Flag.withDescription(
      `Starting point ("${BASE}", "${LATEST}", or a migration name), with --sql. Defaults to "${BASE}" for upgrade, "${LATEST}" for downgrade.`
    ),
    Flag.optional
  ),
};

const status = Command.make('status', commonFlags, (options) =>
  runCommand('status', options)
).pipe(Command.withDescription('Show migration status for each store.'));

const upgrade = Command.make('upgrade', commonFlags, (options) =>
  runCommand('upgrade', options)
).pipe(
  Command.withDescription(
    'Apply pending migrations, always up to the latest migration. Safe to re-run.'
  )
);

const downgrade = Command.make(
  'downgrade',
  {
    ...commonFlags,
    to: Argument.String('to').pipe(
      Argument.withDescription(
        `A migration name to stop at (leaving it applied), or "${BASE}" to revert all.`
      ),
      Argument.optional
    ),
  },
  ({ to, ...options }) => runCommand('downgrade', options, to)
).pipe(
  Command.withDescription(
    'Revert migrations. Reverts the latest migration by default.'
  )
);

/**
 * The `a2a-db` command.
 *
 * @since 0.1.0
 */
export const command = Command.make('a2a-db').pipe(
  Command.withDescription(
    `Schema management for @jambudipa/a2a SQL stores. Online upgrade and downgrade also create ${MIGRATION_LOCK_TABLE}, which every store shares; downgrade deletes ledger rows but keeps the ledger and lock tables.`
  ),
  Command.withSubcommands([status, upgrade, downgrade])
);

/**
 * Runs `a2a-db` with the given arguments (without the program name).
 *
 * @since 0.1.0
 */
export const run = Command.runWith(command, { version: A2A_DB_VERSION });

/**
 * Runs `a2a-db` with the arguments of the process.
 *
 * @since 0.1.0
 */
export const main = Command.run(command, { version: A2A_DB_VERSION });
