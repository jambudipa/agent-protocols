/**
 * SQL stores for the A2A server on `effect/sql`: a `TaskStore` and a
 * `PushNotificationStore` for PostgreSQL, MySQL and SQLite, with the tables
 * of `@a2a-js/sdk` 1.3.0, and their migrations.
 *
 * Provide a `SqlClient` from `@effect/sql-pg`, `@effect/sql-mysql2` or
 * `@effect/sql-sqlite-node`. This entry point loads no driver itself.
 *
 * ```ts
 * const Stores = Layer.mergeAll(SqlTaskStore.layer(), SqlPushNotificationStore.layer()).pipe(
 *   Layer.provide(SqliteClient.layer({ filename: './a2a.db' }))
 * )
 * ```
 *
 * Migrate the schema with `migrateToLatest()` or with the `a2a-db` CLI.
 *
 * @since 0.1.0
 */
export * from './Dialect.js';
export * from './Migrations.js';
export * from './SqlPushNotificationStore.js';
export * from './SqlTaskStore.js';
