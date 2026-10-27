/**
 * The schema migrations of the SQL stores, compatible with the `a2a-db`
 * migrations of `@a2a-js/sdk` 1.3.0: the same tables, indexes, migration
 * names, ledger tables (`a2a_<table>_migrations`) and lock table, so a
 * database migrated by either tool reads the same to both.
 *
 * Every statement is rendered as text, once, and the online migrator runs
 * the same text that `a2a-db --sql` prints.
 *
 * @since 0.1.0
 */
import { Array as Arr, DateTime, Effect, Option, Order, Schema } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import {
  KEY_COLLATION,
  PAYLOAD_TYPE,
  type SqlDialect,
  dialectOf,
  quoteIdentifier,
  stringLiteral,
} from './Dialect.js';

/**
 * The default name of the task table.
 *
 * @since 0.1.0
 */
export const TASK_TABLE = 'tasks';

/**
 * The default name of the push notification config table.
 *
 * @since 0.1.0
 */
export const PUSH_NOTIFICATION_TABLE = 'push_notification_configs';

/**
 * The table that serializes concurrent migrations; every store shares it.
 *
 * @since 0.1.0
 */
export const MIGRATION_LOCK_TABLE = 'a2a_migrations_lock';

/**
 * The store id of the task table.
 *
 * @since 0.1.0
 */
export const TASK_STORE_ID = 'tasks';

/**
 * The store id of the push notification config table.
 *
 * @since 0.1.0
 */
export const PUSH_NOTIFICATION_STORE_ID = 'push-notification-configs';

/**
 * The store ids, in the order in which the CLI migrates them.
 *
 * @since 0.1.0
 */
export const STORE_IDS = [PUSH_NOTIFICATION_STORE_ID, TASK_STORE_ID] as const;

/**
 * A store id.
 *
 * @since 0.1.0
 */
export type StoreId = (typeof STORE_IDS)[number];

/**
 * The revision before the first migration.
 *
 * @since 0.1.0
 */
export const BASE = 'base';

/**
 * The revision after the last migration.
 *
 * @since 0.1.0
 */
export const LATEST = 'latest';

/**
 * A migration could not be planned or applied.
 *
 * @since 0.1.0
 */
export class MigrationError extends Schema.TaggedError<MigrationError>()(
  'MigrationError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * One migration: the statements that apply it and those that revert it.
 *
 * @since 0.1.0
 */
export interface Migration {
  /**
   * The name in the ledger. Migrations run in the sort order of their names.
   */
  readonly name: string;
  /** The statements that apply the migration, without trailing semicolons. */
  readonly up: (dialect: SqlDialect) => ReadonlyArray<string>;
  /** The statements that revert the migration, without trailing semicolons. */
  readonly down: (dialect: SqlDialect) => ReadonlyArray<string>;
}

/**
 * The migration history of one store.
 *
 * @since 0.1.0
 */
export interface StoreMigrations {
  /** The id that `a2a-db --store` takes. */
  readonly id: StoreId;
  /** The store table, after any custom name. */
  readonly tableName: string;
  /** The ledger table: one row for each applied migration. */
  readonly ledgerTable: string;
  /** The migrations, in name order. */
  readonly migrations: ReadonlyArray<Migration>;
}

/**
 * 63, the PostgreSQL identifier limit, less the 26 characters of
 * `_scope_context_updated_idx`, the longest name that a migration derives
 * from the table name.
 */
const MAX_TABLE_NAME_LENGTH = 37;

/**
 * The ledger table of a store table: `a2a_<table>_migrations`.
 *
 * @since 0.1.0
 */
export const ledgerTableFor = (
  tableName: string
): Effect.Effect<string, MigrationError> =>
  tableName.length > MAX_TABLE_NAME_LENGTH
    ? Effect.fail(
        new MigrationError({
          message: `Table name "${tableName}" is too long: ${tableName.length} characters, against the ${MAX_TABLE_NAME_LENGTH} that leave room for the names a migration derives from it.`,
        })
      )
    : Effect.succeed(`a2a_${tableName}_migrations`);

/** The revert of a migration that creates a table. */
const dropTable = (dialect: SqlDialect, tableName: string) => [
  `drop table if exists ${quoteIdentifier(dialect, tableName)}`,
];

/**
 * The migrations of the push notification config store.
 *
 * @since 0.1.0
 */
export const pushNotificationStoreMigrations = (
  tableName: string = PUSH_NOTIFICATION_TABLE
): Effect.Effect<StoreMigrations, MigrationError> =>
  Effect.map(ledgerTableFor(tableName), (ledgerTable) => ({
    id: PUSH_NOTIFICATION_STORE_ID,
    tableName,
    ledgerTable,
    migrations: [
      {
        name: '0001_create_push_notification_configs',
        up: (dialect) => {
          const q = (name: string) => quoteIdentifier(dialect, name);
          const collation = KEY_COLLATION[dialect];
          return [
            `create table ${q(tableName)} (${q('tenant')} varchar(255) ${collation} not null, ${q('owner')} varchar(255) ${collation} not null, ${q('task_id')} varchar(36) ${collation} not null, ${q('config_id')} varchar(36) ${collation} not null, ${q('config_data')} text, ${q('protocol_version')} varchar(255), constraint ${q(`${tableName}_pkey`)} primary key (${q('tenant')}, ${q('owner')}, ${q('task_id')}, ${q('config_id')}))`,
          ];
        },
        down: (dialect) => dropTable(dialect, tableName),
      },
    ],
  }));

/**
 * The migrations of the task store.
 *
 * @since 0.1.0
 */
export const taskStoreMigrations = (
  tableName: string = TASK_TABLE
): Effect.Effect<StoreMigrations, MigrationError> =>
  Effect.map(ledgerTableFor(tableName), (ledgerTable) => ({
    id: TASK_STORE_ID,
    tableName,
    ledgerTable,
    migrations: [
      {
        name: '0001_create_tasks',
        up: (dialect) => {
          const q = (name: string) => quoteIdentifier(dialect, name);
          const collation = KEY_COLLATION[dialect];
          const payload = PAYLOAD_TYPE[dialect];
          return [
            `create table ${q(tableName)} (${q('tenant')} varchar(255) ${collation} not null, ${q('owner')} varchar(255) ${collation} not null, ${q('id')} varchar(36) ${collation} not null, ${q('context_id')} varchar(36) ${collation} not null, ${q('status_last_updated')} bigint not null, ${q('status_state')} varchar(255) ${collation}, ${q('status')} ${payload}, ${q('artifacts')} ${payload}, ${q('history')} ${payload}, ${q('metadata')} ${payload}, ${q('protocol_version')} varchar(255), constraint ${q(`${tableName}_pkey`)} primary key (${q('tenant')}, ${q('owner')}, ${q('id')}))`,
            `create index ${q(`${tableName}_scope_updated_idx`)} on ${q(tableName)} (${q('tenant')}, ${q('owner')}, ${q('status_last_updated')}, ${q('id')})`,
            `create index ${q(`${tableName}_scope_context_updated_idx`)} on ${q(tableName)} (${q('tenant')}, ${q('owner')}, ${q('context_id')}, ${q('status_last_updated')}, ${q('id')})`,
          ];
        },
        down: (dialect) => dropTable(dialect, tableName),
      },
    ],
  }));

/**
 * Custom table names, by store id.
 *
 * @since 0.1.0
 */
export type TableNames = { readonly [K in StoreId]?: string };

/**
 * The migrations of every store, in the order in which they run.
 *
 * @since 0.1.0
 */
export const allStoreMigrations = (
  tableNames: TableNames = {}
): Effect.Effect<ReadonlyArray<StoreMigrations>, MigrationError> =>
  Effect.all([
    pushNotificationStoreMigrations(tableNames[PUSH_NOTIFICATION_STORE_ID]),
    taskStoreMigrations(tableNames[TASK_STORE_ID]),
  ]);

/**
 * The names of the migrations of a store, in order.
 *
 * @since 0.1.0
 */
export const migrationNames = (store: StoreMigrations): ReadonlyArray<string> =>
  store.migrations.map((migration) => migration.name).sort();

// ---------------------------------------------------------------------------
// Ledger statements
// ---------------------------------------------------------------------------

/**
 * Creates the ledger of a store when it is absent. The columns are those of
 * Kysely's migration table, so each tool reads the other's ledger.
 */
const createLedger = (dialect: SqlDialect, store: StoreMigrations) => {
  const q = (name: string) => quoteIdentifier(dialect, name);
  return `create table if not exists ${q(store.ledgerTable)} (${q('name')} varchar(255) not null primary key, ${q('timestamp')} varchar(255) not null)`;
};

/**
 * Records an applied migration. The values are inlined as literals because
 * the offline script carries the same text.
 */
const insertLedgerRow = (
  dialect: SqlDialect,
  store: StoreMigrations,
  name: string,
  timestamp: string
) => {
  const q = (identifier: string) => quoteIdentifier(dialect, identifier);
  return `insert into ${q(store.ledgerTable)} (${q('name')}, ${q('timestamp')}) values (${stringLiteral(dialect, name)}, ${stringLiteral(dialect, timestamp)})`;
};

/** Removes the ledger row of a reverted migration. */
const deleteLedgerRow = (
  dialect: SqlDialect,
  store: StoreMigrations,
  name: string
) => {
  const q = (identifier: string) => quoteIdentifier(dialect, identifier);
  return `delete from ${q(store.ledgerTable)} where ${q('name')} = ${stringLiteral(dialect, name)}`;
};

/** The current time in the ISO form that a ledger row records. */
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

// ---------------------------------------------------------------------------
// Offline rendering
// ---------------------------------------------------------------------------

/**
 * The direction of a migration run.
 *
 * @since 0.1.0
 */
export type Direction = 'up' | 'down';

/**
 * The index of a revision among the sorted migration names: -1 for `base`,
 * the last index for `latest`. It fails for an unknown name.
 */
const positionOf = (
  names: ReadonlyArray<string>,
  point: string
): Effect.Effect<number, MigrationError> => {
  if (point === BASE) return Effect.succeed(-1);
  if (point === LATEST) return Effect.succeed(names.length - 1);
  const at = names.indexOf(point);
  return at === -1
    ? Effect.fail(
        new MigrationError({
          message: `"${point}" is not a migration. Expected "${BASE}", "${LATEST}", or one of: ${names.join(', ')}.`,
        })
      )
    : Effect.succeed(at);
};

/**
 * The migrations between two revisions, in run order, and the direction
 * that reaches `to`. No `to` means one migration down from `from`.
 */
const span = (
  store: StoreMigrations,
  from: string,
  to: Option.Option<string>
) =>
  Effect.gen(function* () {
    const names = migrationNames(store);
    const start = yield* positionOf(names, from);
    const end = Option.isNone(to)
      ? Math.max(start - 1, -1)
      : yield* positionOf(names, to.value);
    return end >= start
      ? { direction: 'up' as Direction, names: names.slice(start + 1, end + 1) }
      : {
          direction: 'down' as Direction,
          names: names.slice(end + 1, start + 1).reverse(),
        };
  });

/** The migration of a store with a given name. It fails when there is none. */
const migrationNamed = (store: StoreMigrations, name: string) =>
  Option.match(
    Arr.findFirst(store.migrations, (migration) => migration.name === name),
    {
      onNone: () =>
        Effect.fail(
          new MigrationError({ message: `"${name}" is not a migration.` })
        ),
      onSome: Effect.succeed,
    }
  );

/**
 * How a script header or an error names the destination of a downgrade
 * that has no target.
 */
const PREVIOUS = 'the previous migration';

/**
 * The statements of one store for a run, each ending in a semicolon. An
 * upgrade from `base` creates the ledger first. It fails when the span
 * moves against `expected`.
 */
const storeStatements = (
  dialect: SqlDialect,
  store: StoreMigrations,
  from: string,
  to: Option.Option<string>,
  expected: Direction
) =>
  Effect.gen(function* () {
    const { direction, names } = yield* span(store, from, to);
    if (names.length === 0) return [];
    if (direction !== expected) {
      return yield* new MigrationError({
        message: `"${from}" to "${Option.getOrElse(to, () => PREVIOUS)}" moves ${direction} the ${store.id} store, but this is ${expected === 'up' ? 'an upgrade' : 'a downgrade'}.`,
      });
    }
    const ledger =
      direction === 'up' && from === BASE ? [createLedger(dialect, store)] : [];
    const steps = yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const migration = yield* migrationNamed(store, name);
        return direction === 'up'
          ? [
              ...migration.up(dialect),
              insertLedgerRow(dialect, store, name, yield* nowIso),
            ]
          : [...migration.down(dialect), deleteLedgerRow(dialect, store, name)];
      })
    );
    const statements = [...ledger, ...steps.flat()];
    return statements.map((statement) => `${statement};`);
  });

/**
 * The options of {@link renderMigrationScript}.
 *
 * @since 0.1.0
 */
export interface RenderOptions {
  /** The dialect whose quoting and column types the script uses. */
  readonly dialect: SqlDialect;
  /** The stores to render, in output order. */
  readonly stores: ReadonlyArray<StoreMigrations>;
  /** The revision that the database is at. */
  readonly from: string;
  /** The revision to reach; none reverts one migration. */
  readonly to: Option.Option<string>;
  /**
   * Whether the caller asked for an upgrade or a downgrade. A span that moves
   * the other way fails.
   */
  readonly direction: Direction;
}

/**
 * Renders a migration as a SQL script, without a database: the store DDL
 * and the ledger rows that keep `a2a-db status` in step. It is the output of
 * `a2a-db upgrade --sql` and `a2a-db downgrade --sql`.
 *
 * @since 0.1.0
 */
export const renderMigrationScript = (
  options: RenderOptions
): Effect.Effect<string, MigrationError> =>
  Effect.gen(function* () {
    const perStore = yield* Effect.forEach(options.stores, (store) =>
      Effect.map(
        storeStatements(
          options.dialect,
          store,
          options.from,
          options.to,
          options.direction
        ),
        (statements) =>
          statements.length > 0
            ? [[`-- store: ${store.id}`, ...statements].join('\n\n')]
            : []
      )
    );
    const blocks = perStore.flat();
    const destination = Option.getOrElse(options.to, () => PREVIOUS);
    const header = [
      `-- @jambudipa/a2a schema for ${options.dialect}: ${options.from} -> ${destination}.`,
      `-- Rendered offline: nothing read the database, so this assumes it is at "${options.from}".`,
    ];
    if (blocks.length === 0) {
      return [
        ...header,
        `-- Nothing to do: every selected store is already at ${destination}.`,
      ].join('\n');
    }
    return `${[
      ...header,
      "-- Each store's ledger is kept in step, so `a2a-db status` keeps matching the schema.",
      '-- Not wrapped in a transaction. Check the ledger if it stops partway.',
    ].join('\n')}\n\n${blocks.join('\n\n')}`;
  });

// ---------------------------------------------------------------------------
// Online migration
// ---------------------------------------------------------------------------

/**
 * The state of one migration in a database.
 *
 * @since 0.1.0
 */
export interface MigrationState {
  /** The name of the migration. */
  readonly name: string;
  /** The RFC 3339 time at which it was applied, when it was. */
  readonly executedAt: Option.Option<string>;
}

/** A row of a store's ledger table. */
const LedgerRow = Schema.Struct({
  name: Schema.String,
  timestamp: Schema.String,
}).annotate({ identifier: 'LedgerRow' });

/** Decodes the rows of a ledger select. */
const decodeLedger = Schema.decodeUnknownEffect(Schema.Array(LedgerRow));

/**
 * The id of the single row of the lock table, as Kysely's migrator writes
 * it.
 */
const MIGRATION_LOCK_ID = 'migration_lock';

/**
 * The advisory lock id of Kysely's PostgreSQL adapter, so that both tools
 * exclude each other.
 */
const PG_LOCK_ID = '3853314791062309107';
/**
 * The `get_lock` name of Kysely's MySQL adapter, so that both tools
 * exclude each other.
 */
const MYSQL_LOCK_ID = 'ea586330-2c93-47c8-908d-981d9d270f9d';
/**
 * How long MySQL `get_lock` waits for another migrator: one hour, as in
 * Kysely.
 */
const LOCK_TIMEOUT_SECONDS = 60 * 60;

/**
 * Wraps a SQL or decode failure in a `MigrationError` whose message starts
 * with what was being done.
 */
const toMigrationError =
  (message: string) =>
  (cause: SqlError.SqlError | Schema.SchemaError): MigrationError =>
    new MigrationError({ message: `${message}: ${cause.message}`, cause });

/**
 * Runs `body` inside the migration lock, in one transaction, as Kysely's
 * migrator does: an advisory lock on PostgreSQL and MySQL, and the single
 * connection of SQLite.
 */
const withMigrationLock = <A, E>(
  sql: SqlClient.SqlClient,
  dialect: SqlDialect,
  body: Effect.Effect<A, E | SqlError.SqlError>
): Effect.Effect<A, E | SqlError.SqlError> => {
  const q = (name: string) => quoteIdentifier(dialect, name);
  const ensureLockTable = Effect.gen(function* () {
    yield* sql.unsafe(
      `create table if not exists ${q(MIGRATION_LOCK_TABLE)} (${q('id')} varchar(255) not null primary key, ${q('is_locked')} integer default 0 not null)`
    );
    const rows = yield* sql.unsafe(
      `select ${q('id')} from ${q(MIGRATION_LOCK_TABLE)} where ${q('id')} = ${stringLiteral(dialect, MIGRATION_LOCK_ID)}`
    );
    if (rows.length === 0) {
      yield* sql.unsafe(
        `insert into ${q(MIGRATION_LOCK_TABLE)} (${q('id')}, ${q('is_locked')}) values (${stringLiteral(dialect, MIGRATION_LOCK_ID)}, 0)`
      );
    }
  });
  const acquire =
    dialect === 'postgres'
      ? sql.unsafe(`select pg_advisory_lock(${PG_LOCK_ID})`)
      : dialect === 'mysql'
        ? sql.unsafe(
            `select get_lock(${stringLiteral(dialect, MYSQL_LOCK_ID)}, ${LOCK_TIMEOUT_SECONDS})`
          )
        : Effect.succeed([]);
  const release =
    dialect === 'postgres'
      ? sql.unsafe(`select pg_advisory_unlock(${PG_LOCK_ID})`)
      : dialect === 'mysql'
        ? sql.unsafe(
            `select release_lock(${stringLiteral(dialect, MYSQL_LOCK_ID)})`
          )
        : Effect.succeed([]);
  return Effect.andThen(
    ensureLockTable,
    sql.withTransaction(
      Effect.acquireUseRelease(
        acquire,
        () => body,
        () => Effect.ignore(release)
      )
    )
  );
};

/**
 * The migrator of one store on a SQL client.
 *
 * @since 0.1.0
 */
export interface StoreMigrator {
  /** The migrations that this migrator runs. */
  readonly store: StoreMigrations;
  /** The state of every migration of the store. */
  readonly status: Effect.Effect<ReadonlyArray<MigrationState>, MigrationError>;
  /** Applies every pending migration. Safe to re-run. */
  readonly migrateToLatest: Effect.Effect<
    ReadonlyArray<string>,
    MigrationError
  >;
  /** Reverts the last applied migration, and returns its name. */
  readonly migrateDown: Effect.Effect<Option.Option<string>, MigrationError>;
  /**
   * Reverts the migrations after `target`, which must be applied, or all of
   * them for `base`.
   */
  readonly revertTo: (
    target: string
  ) => Effect.Effect<ReadonlyArray<string>, MigrationError>;
}

/**
 * Builds the migrator of a store on the current SQL client.
 *
 * @since 0.1.0
 */
export const makeStoreMigrator = (
  store: StoreMigrations
): Effect.Effect<StoreMigrator, MigrationError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const dialect = yield* dialectOf(sql).pipe(
      Effect.mapError((error) => new MigrationError({ message: error.message }))
    );
    const q = (name: string) => quoteIdentifier(dialect, name);
    const names = migrationNames(store);

    const ensureLedger = sql.unsafe(createLedger(dialect, store));

    const ledgerExists = Effect.map(
      sql.unsafe(
        dialect === 'sqlite'
          ? `select ${q('name')} from ${q('sqlite_master')} where ${q('type')} = 'table' and ${q('name')} = ${stringLiteral(dialect, store.ledgerTable)}`
          : dialect === 'postgres'
            ? `select ${q('table_name')} from ${q('information_schema')}.${q('tables')} where ${q('table_schema')} = current_schema() and ${q('table_name')} = ${stringLiteral(dialect, store.ledgerTable)}`
            : `select ${q('table_name')} from ${q('information_schema')}.${q('tables')} where ${q('table_schema')} = database() and ${q('table_name')} = ${stringLiteral(dialect, store.ledgerTable)}`
      ),
      (rows) => rows.length > 0
    );

    const executed = Effect.gen(function* () {
      const rows = yield* sql.unsafe(
        `select ${q('name')}, ${q('timestamp')} from ${q(store.ledgerTable)}`
      );
      const ledger = yield* decodeLedger(rows);
      const missing = ledger.filter((row) => !names.includes(row.name));
      if (missing.length > 0) {
        return yield* new MigrationError({
          message: `corrupted migrations: previously executed migration ${missing[0]?.name ?? ''} is missing`,
        });
      }
      return Arr.sort(
        ledger.map((row) => row.name),
        Order.String
      ).map((name) => ({
        name,
        timestamp: ledger.find((row) => row.name === name)?.timestamp ?? '',
      }));
    });

    const apply = (name: string) =>
      Effect.gen(function* () {
        const migration = yield* migrationNamed(store, name);
        for (const statement of migration.up(dialect)) {
          yield* sql.unsafe(statement);
        }
        yield* sql.unsafe(insertLedgerRow(dialect, store, name, yield* nowIso));
      });

    const revert = (name: string) =>
      Effect.gen(function* () {
        const migration = yield* migrationNamed(store, name);
        for (const statement of migration.down(dialect)) {
          yield* sql.unsafe(statement);
        }
        yield* sql.unsafe(deleteLedgerRow(dialect, store, name));
      });

    const locked = <A>(
      message: string,
      body: Effect.Effect<
        A,
        MigrationError | SqlError.SqlError | Schema.SchemaError
      >
    ): Effect.Effect<A, MigrationError> =>
      withMigrationLock(sql, dialect, Effect.andThen(ensureLedger, body)).pipe(
        Effect.catchTags({
          SqlError: (error) => Effect.fail(toMigrationError(message)(error)),
          SchemaError: (error) => Effect.fail(toMigrationError(message)(error)),
        })
      );

    const failureMessage = `store "${store.id}" migration failed`;

    return {
      store,
      status: Effect.gen(function* () {
        const applied = (yield* ledgerExists) ? yield* executed : [];
        return names.map((name) => ({
          name,
          executedAt: Option.map(
            Arr.findFirst(applied, (row) => row.name === name),
            (row) =>
              Option.match(DateTime.make(row.timestamp), {
                onNone: () => row.timestamp,
                onSome: DateTime.formatIso,
              })
          ),
        }));
      }).pipe(
        Effect.catchTags({
          SqlError: (error) =>
            Effect.fail(toMigrationError(failureMessage)(error)),
          SchemaError: (error) =>
            Effect.fail(toMigrationError(failureMessage)(error)),
        })
      ),
      migrateToLatest: locked(
        failureMessage,
        Effect.gen(function* () {
          const applied = (yield* executed).map((row) => row.name);
          const pending = names.filter((name) => !applied.includes(name));
          for (const name of pending) {
            yield* apply(name).pipe(
              Effect.mapError((error) =>
                error._tag === 'MigrationError'
                  ? error
                  : new MigrationError({
                      message: `${failureMessage} in migration "${name}": ${error.message}`,
                      cause: error,
                    })
              )
            );
          }
          return pending;
        })
      ),
      migrateDown: locked(
        failureMessage,
        Effect.gen(function* () {
          const last = Arr.last(yield* executed);
          if (Option.isNone(last)) return Option.none<string>();
          yield* revert(last.value.name);
          return Option.some(last.value.name);
        })
      ),
      revertTo: (target) =>
        locked(
          failureMessage,
          Effect.gen(function* () {
            const applied = (yield* executed).map((row) => row.name);
            if (target !== BASE && !applied.includes(target)) {
              return yield* new MigrationError({
                message: `"${target}" is not applied to the ${store.id} store, so reaching it would move the store up, but this is a downgrade. Use upgrade to apply it.`,
              });
            }
            const keep = target === BASE ? -1 : names.indexOf(target);
            const toRevert = applied
              .filter((name) => names.indexOf(name) > keep)
              .reverse();
            for (const name of toRevert) {
              yield* revert(name);
            }
            return toRevert;
          })
        ),
    };
  });

/**
 * Applies every pending migration of every store, with the default or the
 * given table names. Run it once at start-up, before the SQL stores serve.
 *
 * @since 0.1.0
 */
export const migrateToLatest = (
  tableNames: TableNames = {}
): Effect.Effect<void, MigrationError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    for (const store of yield* allStoreMigrations(tableNames)) {
      const migrator = yield* makeStoreMigrator(store);
      yield* migrator.migrateToLatest;
    }
  });
