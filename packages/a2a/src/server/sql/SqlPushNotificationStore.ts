/**
 * A push notification store on `effect/sql`, with the table and row format
 * of `DatabasePushNotificationStore` of `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import {
  Crypto,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  Struct,
} from 'effect';
import { SqlClient } from 'effect/sql';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../Constants.js';
import { TaskPushNotificationConfig } from '../../Types.js';
import {
  PushNotificationStore,
  PushNotificationStoreError,
  type StoredPushNotificationConfig,
  wireVersionOf,
} from '../PushNotificationStore.js';
import {
  CurrentOwnerResolver,
  callerScope,
  type ServerCallContext,
} from '../ServerCallContext.js';
import {
  type SqlDialect,
  UnsupportedDialectError,
  dialectOf,
} from './Dialect.js';
import { PUSH_NOTIFICATION_TABLE } from './Migrations.js';
import { PAYLOAD_FORMAT } from './SqlTaskStore.js';

/** A text column. */
const TextColumn = Schema.String;

const PushRow = Schema.Struct({
  tenant: TextColumn,
  owner: TextColumn,
  task_id: TextColumn,
  config_id: TextColumn,
  config_data: Schema.OptionFromNullOr(Schema.String),
  protocol_version: Schema.OptionFromNullOr(Schema.String),
}).annotate({ identifier: 'PushRow' });

type PushRow = typeof PushRow.Type;

const encodeRow = Schema.encodeEffect(PushRow);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(PushRow));

/**
 * The JSON of `config_data`: the config without the fields that have their
 * own columns, plus the wire version under which it was saved.
 */
const ConfigData = Schema.fromJsonString(Schema.JsonObject);
const encodeConfig = Schema.encodeEffect(TaskPushNotificationConfig);
const decodeConfig = Schema.decodeUnknownEffect(TaskPushNotificationConfig);

const toRow = (
  scope: {
    readonly tenant: string;
    readonly owner: string;
    readonly taskId: string;
  },
  stored: StoredPushNotificationConfig & { readonly configId: string }
) =>
  Effect.gen(function* () {
    const payload = Struct.omit(yield* encodeConfig(stored.config), [
      'tenant',
      'id',
      'taskId',
    ]);
    const configData = yield* Schema.encodeEffect(ConfigData)({
      ...payload,
      wireVersion: stored.wireVersion,
    });
    return yield* encodeRow({
      tenant: scope.tenant,
      owner: scope.owner,
      task_id: scope.taskId,
      config_id: stored.configId,
      config_data: Option.some(configData),
      protocol_version: Option.some(PAYLOAD_FORMAT),
    });
  });

const fromRow = (
  row: PushRow
): Effect.Effect<StoredPushNotificationConfig, Schema.SchemaError> =>
  Effect.gen(function* () {
    const empty: Schema.JsonObject = {};
    const payload: Schema.JsonObject = yield* Option.match(row.config_data, {
      onNone: () => Effect.succeed(empty),
      onSome: (text) =>
        text === ''
          ? Effect.succeed(empty)
          : Schema.decodeUnknownEffect(ConfigData)(text),
    });
    const config = yield* decodeConfig({
      ...payload,
      ...(row.tenant === '' ? {} : { tenant: row.tenant }),
      id: row.config_id,
      taskId: row.task_id,
    });
    const wireVersion = payload['wireVersion'];
    return {
      config,
      wireVersion:
        Predicate.isString(wireVersion) && wireVersion !== ''
          ? wireVersion
          : A2A_LEGACY_PROTOCOL_VERSION,
    };
  });

/**
 * The options of the SQL push notification store.
 *
 * @since 0.1.0
 */
export interface SqlPushNotificationStoreOptions {
  /** The table name. The default is `push_notification_configs`. */
  readonly tableName?: string;
}

const storeError =
  (message: string) =>
  (cause: { readonly message: string }): PushNotificationStoreError =>
    new PushNotificationStoreError({
      message: `${message}: ${cause.message}`,
      cause,
    });

const makeSqlPushNotificationStore = (
  options: SqlPushNotificationStoreOptions = {}
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const dialect: SqlDialect = yield* dialectOf(sql);
    const crypto = yield* Crypto.Crypto;
    const ownerResolver = yield* CurrentOwnerResolver;
    const table = sql(options.tableName ?? PUSH_NOTIFICATION_TABLE);
    const column = (name: string) => sql`${sql(name)}`;
    const scopeOf = (taskId: string, context: ServerCallContext) => ({
      ...callerScope(context, ownerResolver),
      taskId,
    });

    const loadWithMetadata = (taskId: string, context: ServerCallContext) =>
      Effect.gen(function* () {
        const scope = scopeOf(taskId, context);
        const rows = yield* decodeRows(
          yield* sql`select ${sql.csv(['tenant', 'owner', 'task_id', 'config_id', 'config_data', 'protocol_version'].map(column))} from ${table} where ${column('tenant')} = ${scope.tenant} and ${column('owner')} = ${scope.owner} and ${column('task_id')} = ${scope.taskId}`
        );
        const read = yield* Effect.forEach(rows, (row) =>
          fromRow(row).pipe(
            Effect.map(Option.some),
            Effect.catch((error) =>
              Effect.as(
                Effect.logError(
                  `Skipping push notification config "${row.config_id}" on task "${row.task_id}" for owner "${scope.owner}" in tenant "${scope.tenant}": it could not be read.`,
                  error
                ),
                Option.none<StoredPushNotificationConfig>()
              )
            )
          )
        );
        const stored = read.flatMap(Option.toArray);
        return stored;
      }).pipe(
        Effect.mapError(
          storeError(
            `Cannot load the push notification configs of task "${taskId}"`
          )
        )
      );

    return PushNotificationStore.of({
      save: (taskId, context, config) =>
        Effect.gen(function* () {
          const configId =
            config.id !== undefined && config.id !== ''
              ? config.id
              : yield* crypto.randomUUIDv4();
          const stored = { ...config, id: configId };
          const row = yield* toRow(scopeOf(taskId, context), {
            config: stored,
            configId,
            wireVersion: wireVersionOf(context),
          });
          const replaceable = Struct.pick(row, [
            'config_data',
            'protocol_version',
          ]);
          yield* dialect === 'mysql'
            ? sql`insert into ${table} ${sql.insert(row)} on duplicate key update ${sql.update(replaceable)}`
            : sql`insert into ${table} ${sql.insert(row)} on conflict (${sql.csv(['tenant', 'owner', 'task_id', 'config_id'].map(column))}) do update set ${sql.update(replaceable)}`;
          return stored;
        }).pipe(
          Effect.mapError(
            storeError(
              `Cannot save a push notification config of task "${taskId}"`
            )
          )
        ),
      load: (taskId, context) =>
        Effect.map(loadWithMetadata(taskId, context), (stored) =>
          stored.map((entry) => entry.config)
        ),
      loadWithMetadata,
      delete: (taskId, context, configId) =>
        Effect.gen(function* () {
          const scope = scopeOf(taskId, context);
          yield* sql`delete from ${table} where ${column('tenant')} = ${scope.tenant} and ${column('owner')} = ${scope.owner} and ${column('task_id')} = ${scope.taskId} and ${column('config_id')} = ${configId}`;
        }).pipe(
          Effect.mapError(
            storeError(
              `Cannot delete push notification config "${configId}" of task "${taskId}"`
            )
          )
        ),
    });
  });

/**
 * The SQL push notification store. It requires a `SqlClient` of PostgreSQL,
 * MySQL or SQLite whose schema is migrated, and `Crypto` for config ids.
 *
 * @since 0.1.0
 */
export const SqlPushNotificationStore = {
  make: makeSqlPushNotificationStore,
  layer: (
    options: SqlPushNotificationStoreOptions = {}
  ): Layer.Layer<
    PushNotificationStore,
    UnsupportedDialectError,
    SqlClient.SqlClient | Crypto.Crypto
  > =>
    Layer.effect(PushNotificationStore, makeSqlPushNotificationStore(options)),
};
