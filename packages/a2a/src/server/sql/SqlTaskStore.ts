/**
 * A task store on `effect/sql`, with the table, row format, ordering and
 * paging of `DatabaseTaskStore` of `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import {
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  SchemaGetter,
  Struct,
} from 'effect';
import { SqlClient } from 'effect/sql';
import type { Fragment } from 'effect/sql/Statement';
import {
  Artifact,
  type ListTasksResponse,
  Message,
  type Task,
  TaskStatus,
} from '../../Types.js';
import { decodePageToken, encodePageToken } from '../internal/utils.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type CallerScope,
  type ServerCallContext,
} from '../ServerCallContext.js';
import {
  type ListTasksParams,
  TaskStore,
  TaskStoreError,
} from '../TaskStore.js';
import {
  type SqlDialect,
  UnsupportedDialectError,
  dialectOf,
} from './Dialect.js';
import { TASK_TABLE } from './Migrations.js';

/**
 * The version of the JSON payload format of a row.
 *
 * @since 0.1.0
 */
export const PAYLOAD_FORMAT = '1.0';

/**
 * A `bigint` column. Drivers return it as a number, a string or a bigint.
 */
const BigIntNumber = Schema.Union([
  Schema.Number,
  Schema.String,
  Schema.BigInt,
]).pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((value: number | string | bigint) =>
      Number(value)
    ),
    encode: SchemaGetter.passthrough(),
  })
);

/** A text column. */
const TextColumn = Schema.String;

/** A nullable text column; `Option.none` is written as SQL null. */
const nullable = Schema.OptionFromNullOr(Schema.String);
/** A text column that may be null or missing from the select. */
const nullableKey = Schema.OptionFromOptionalNullOr(Schema.String);

/**
 * A task row as the store writes it. Every payload column is present, so an
 * update clears a column that the task no longer has.
 */
const TaskRowWrite = Schema.Struct({
  tenant: TextColumn,
  owner: TextColumn,
  id: TextColumn,
  context_id: TextColumn,
  status_last_updated: Schema.Number,
  status_state: nullable,
  status: nullable,
  artifacts: nullable,
  history: nullable,
  metadata: nullable,
  protocol_version: nullable,
}).annotate({ identifier: 'TaskRowWrite' });

/**
 * A task row as the store reads it. A list leaves out the columns it does
 * not need, so payload columns may be missing.
 */
const TaskRowRead = Schema.Struct({
  tenant: TextColumn,
  owner: TextColumn,
  id: TextColumn,
  context_id: TextColumn,
  status_last_updated: BigIntNumber,
  status_state: nullableKey,
  status: nullableKey,
  artifacts: nullableKey,
  history: nullableKey,
  metadata: nullableKey,
}).annotate({ identifier: 'TaskRowRead' });

/** The decoded form of a task row as the store reads it. */
type TaskRowRead = typeof TaskRowRead.Type;

/** The JSON text of the `status` column. */
const StatusJson = Schema.fromJsonString(TaskStatus);
/** The JSON text of the `artifacts` column. */
const ArtifactsJson = Schema.fromJsonString(Schema.Array(Artifact));
/** The JSON text of the `history` column. */
const HistoryJson = Schema.fromJsonString(Schema.Array(Message));
/** The JSON text of the `metadata` column. */
const MetadataJson = Schema.fromJsonString(Schema.JsonObject);

/** Encodes a task row for an upsert. */
const encodeRow = Schema.encodeEffect(TaskRowWrite);
/** Decodes the rows of a select. Driver rows are untrusted until decoded. */
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(TaskRowRead));
/** The row of the count query of `list`. */
const Count = Schema.Struct({ total: BigIntNumber }).annotate({
  identifier: 'Count',
});
/** Decodes the result of the count query. */
const decodeCount = Schema.decodeUnknownEffect(Schema.Array(Count));

/**
 * The epoch milliseconds of a status timestamp, or zero when it is absent or
 * not a date, as the reference SDK writes `status_last_updated`.
 *
 * @since 0.1.0
 */
export const statusLastUpdated = (timestamp: string | undefined): number =>
  timestamp === undefined || timestamp === ''
    ? 0
    : Option.match(DateTime.make(timestamp), {
        onNone: () => 0,
        onSome: DateTime.toEpochMillis,
      });

/**
 * The cursor timestamp of a row: empty for zero, else the ISO form of the
 * epoch milliseconds.
 *
 * @since 0.1.0
 */
export const cursorTimestamp = (millis: number): string =>
  millis === 0 ? '' : DateTime.formatIso(DateTime.makeUnsafe(millis));

/**
 * Encodes an optional field to JSON text. An absent field becomes SQL null,
 * so an update clears the column.
 */
const encodeOptional = <A>(
  schema: Schema.Codec<A, string>,
  value: A | undefined
): Effect.Effect<Option.Option<string>, Schema.SchemaError> =>
  value === undefined
    ? Effect.succeed(Option.none())
    : Effect.map(Schema.encodeEffect(schema)(value), Option.some);

/**
 * Builds the row of a task in the caller's scope. A task without a
 * `contextId` stores an empty string, because the column is not nullable.
 */
const toRow = (scope: CallerScope, task: Task) =>
  Effect.gen(function* () {
    return yield* encodeRow({
      tenant: scope.tenant,
      owner: scope.owner,
      id: task.id,
      context_id: task.contextId ?? '',
      status_last_updated: statusLastUpdated(task.status.timestamp),
      status_state: Option.some(task.status.state),
      status: yield* encodeOptional(StatusJson, task.status),
      artifacts: yield* encodeOptional(ArtifactsJson, task.artifacts),
      history: yield* encodeOptional(HistoryJson, task.history),
      metadata: yield* encodeOptional(MetadataJson, task.metadata),
      protocol_version: Option.some(PAYLOAD_FORMAT),
    });
  });

/**
 * Decodes a JSON column. Null, a column left out of the select and an empty
 * string all read as absent.
 */
const decodeOptional = <A>(
  schema: Schema.Codec<A, string>,
  value: Option.Option<string>
): Effect.Effect<Option.Option<A>, Schema.SchemaError> =>
  Option.match(value, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (text) =>
      text === ''
        ? Effect.succeed(Option.none())
        : Effect.map(Schema.decodeUnknownEffect(schema)(text), Option.some),
  });

/**
 * Rebuilds a task from its row.
 *
 * @since 0.1.0
 */
const fromRow = (row: TaskRowRead): Effect.Effect<Task, Schema.SchemaError> =>
  Effect.gen(function* () {
    const status = yield* decodeOptional(StatusJson, row.status);
    const artifacts = yield* decodeOptional(ArtifactsJson, row.artifacts);
    const history = yield* decodeOptional(HistoryJson, row.history);
    const metadata = yield* decodeOptional(MetadataJson, row.metadata);
    return {
      id: row.id,
      ...(row.context_id === '' ? {} : { contextId: row.context_id }),
      status: Option.getOrElse(status, (): TaskStatus => ({
        state: 'TASK_STATE_UNSPECIFIED',
      })),
      ...Option.match(artifacts, {
        onNone: () => ({}),
        onSome: (value) => ({ artifacts: value }),
      }),
      ...Option.match(history, {
        onNone: () => ({}),
        onSome: (value) => ({ history: value }),
      }),
      ...Option.match(metadata, {
        onNone: () => ({}),
        onSome: (value) => ({ metadata: value }),
      }),
    };
  });

/**
 * The options of the SQL task store.
 *
 * @since 0.1.0
 */
export interface SqlTaskStoreOptions {
  /** The table name. The default is `tasks`. */
  readonly tableName?: string;
}

/**
 * Every column of the task table, in select order. `list` drops
 * `artifacts` and `history` when the request does not want them.
 */
const TASK_COLUMNS = [
  'tenant',
  'owner',
  'id',
  'context_id',
  'status_last_updated',
  'status_state',
  'status',
  'artifacts',
  'history',
  'metadata',
  'protocol_version',
] as const;

/**
 * Wraps a failure in a `TaskStoreError` whose message starts with the
 * operation that failed.
 */
const storeError =
  (message: string) =>
  (cause: { readonly message: string }): TaskStoreError =>
    new TaskStoreError({ message: `${message}: ${cause.message}`, cause });

/**
 * Builds the store on the current `SqlClient`. It fails with
 * `UnsupportedDialectError` for a dialect other than PostgreSQL, MySQL or
 * SQLite. Every query is limited to the caller's tenant and owner. `list`
 * orders by `status_last_updated` then `id`, both descending, and pages with
 * a keyset cursor on that pair. A row that cannot be decoded is logged and
 * skipped.
 */
const makeSqlTaskStore = (options: SqlTaskStoreOptions = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const dialect: SqlDialect = yield* dialectOf(sql);
    const ownerResolver = yield* CurrentOwnerResolver;
    const table = sql(options.tableName ?? TASK_TABLE);
    const scopeOf = (context: ServerCallContext) =>
      callerScope(context, ownerResolver);
    const column = (name: string) => sql(name);
    const columns = (names: ReadonlyArray<string>) =>
      sql.csv(names.map((name) => sql`${column(name)}`));

    const save = (task: Task, context: ServerCallContext) =>
      Effect.gen(function* () {
        const row = yield* toRow(scopeOf(context), task);
        const replaceable = Struct.omit(row, ['tenant', 'owner', 'id']);
        yield* dialect === 'mysql'
          ? sql`insert into ${table} ${sql.insert(row)} on duplicate key update ${sql.update(replaceable)}`
          : sql`insert into ${table} ${sql.insert(row)} on conflict (${columns(['tenant', 'owner', 'id'])}) do update set ${sql.update(replaceable)}`;
      }).pipe(Effect.mapError(storeError(`Cannot save task "${task.id}"`)));

    const load = (taskId: string, context: ServerCallContext) =>
      Effect.gen(function* () {
        const scope = scopeOf(context);
        const rows = yield* decodeRows(
          yield* sql`select ${columns(TASK_COLUMNS)} from ${table} where ${column('tenant')} = ${scope.tenant} and ${column('owner')} = ${scope.owner} and ${column('id')} = ${taskId}`
        );
        const row = rows[0];
        if (row === undefined) return Option.none<Task>();
        return Option.some(yield* fromRow(row));
      }).pipe(Effect.mapError(storeError(`Cannot load task "${taskId}"`)));

    const listFilter = (
      scope: CallerScope,
      params: ListTasksParams
    ): ReadonlyArray<Fragment> => [
      sql`${column('tenant')} = ${scope.tenant}`,
      sql`${column('owner')} = ${scope.owner}`,
      ...(params.contextId === undefined || params.contextId === ''
        ? []
        : [sql`${column('context_id')} = ${params.contextId}`]),
      ...(params.status === undefined ||
      params.status === 'TASK_STATE_UNSPECIFIED'
        ? []
        : [sql`${column('status_state')} = ${params.status}`]),
      ...(params.statusTimestampAfter === undefined ||
      params.statusTimestampAfter === ''
        ? []
        : [
            sql`${column('status_last_updated')} > ${statusLastUpdated(params.statusTimestampAfter)}`,
          ]),
    ];

    const list = (params: ListTasksParams, context: ServerCallContext) =>
      Effect.gen(function* () {
        const scope = scopeOf(context);
        const filter = listFilter(scope, params);
        const counted = yield* decodeCount(
          yield* sql`select count(*) as ${column('total')} from ${table} where ${sql.and(filter)}`
        ).pipe(Effect.mapError(storeError('Cannot count tasks')));
        const totalSize = counted[0]?.total ?? 0;
        const after =
          params.pageToken === undefined || params.pageToken === ''
            ? []
            : yield* Effect.map(decodePageToken(params.pageToken), (cursor) => {
                const cursorUpdated = statusLastUpdated(cursor.timestamp);
                return [
                  sql`(${column('status_last_updated')} < ${cursorUpdated} or (${column('status_last_updated')} = ${cursorUpdated} and ${column('id')} < ${cursor.id}))`,
                ];
              });
        const conditions = [...filter, ...after];
        const selected = TASK_COLUMNS.filter(
          (name) =>
            !(name === 'artifacts' && params.includeArtifacts !== true) &&
            !(
              name === 'history' &&
              params.historyLength !== undefined &&
              params.historyLength <= 0
            )
        );
        const rows = yield* decodeRows(
          yield* sql`select ${columns(selected)} from ${table} where ${sql.and(conditions)} order by ${column('status_last_updated')} desc, ${column('id')} desc limit ${params.pageSize + 1}`
        ).pipe(Effect.mapError(storeError('Cannot list tasks')));
        const hasMore = rows.length > params.pageSize;
        const page = hasMore ? rows.slice(0, params.pageSize) : rows;
        const read = yield* Effect.forEach(page, (row) =>
          fromRow(row).pipe(
            Effect.map((task) =>
              Option.some(
                params.includeArtifacts === true
                  ? { ...task, artifacts: task.artifacts ?? [] }
                  : task
              )
            ),
            Effect.catch((error) =>
              Effect.as(
                Effect.logError(
                  `Skipping task "${row.id}" for owner "${scope.owner}" in tenant "${scope.tenant}": it could not be read.`,
                  error
                ),
                Option.none<Task>()
              )
            )
          )
        );
        const tasks = read.flatMap(Option.toArray);
        const last = page.at(-1);
        const response: ListTasksResponse = {
          tasks,
          nextPageToken:
            hasMore && last !== undefined
              ? encodePageToken(
                  cursorTimestamp(last.status_last_updated),
                  last.id
                )
              : '',
          pageSize: params.pageSize,
          totalSize,
        };
        return response;
      }).pipe(
        Effect.catchTag('SqlError', (error) =>
          Effect.fail(storeError('Cannot list tasks')(error))
        )
      );

    return TaskStore.of({ save, load, list });
  });

/**
 * The SQL task store. It requires a `SqlClient` of PostgreSQL, MySQL or
 * SQLite whose schema is migrated (see `migrateToLatest` or `a2a-db
 * upgrade`), and reads the owner resolver from `CurrentOwnerResolver`.
 *
 * @since 0.1.0
 */
export const SqlTaskStore = {
  make: makeSqlTaskStore,
  layer: (
    options: SqlTaskStoreOptions = {}
  ): Layer.Layer<TaskStore, UnsupportedDialectError, SqlClient.SqlClient> =>
    Layer.effect(TaskStore, makeSqlTaskStore(options)),
};
