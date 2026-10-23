/**
 * The SQL dialects of the SQL stores, and the rendering of identifiers and
 * literals in each, with the quoting rules of the reference SDK's Kysely
 * compilers.
 *
 * @since 0.1.0
 */
import { Effect, Schema } from 'effect';
import type { SqlClient } from 'effect/sql';

/**
 * The dialect names, as the reference `a2a-db --dialect` takes them.
 *
 * @since 0.1.0
 */
export const SQL_DIALECTS = ['postgres', 'mysql', 'sqlite'] as const;

/**
 * A dialect of the SQL stores.
 *
 * @since 0.1.0
 */
export type SqlDialect = (typeof SQL_DIALECTS)[number];

/**
 * The SQL client speaks a dialect that the stores do not support.
 *
 * @since 0.1.0
 */
export class UnsupportedDialectError extends Schema.TaggedError<UnsupportedDialectError>()(
  'UnsupportedDialectError',
  { message: Schema.String }
) {}

/**
 * The dialect of a SQL client: PostgreSQL, MySQL or SQLite.
 *
 * @since 0.1.0
 */
export const dialectOf = (
  sql: SqlClient.SqlClient
): Effect.Effect<SqlDialect, UnsupportedDialectError> =>
  sql.onDialectOrElse({
    pg: () => Effect.succeed<SqlDialect>('postgres'),
    mysql: () => Effect.succeed<SqlDialect>('mysql'),
    sqlite: () => Effect.succeed<SqlDialect>('sqlite'),
    orElse: () =>
      Effect.fail(
        new UnsupportedDialectError({
          message: `@jambudipa/a2a SQL stores support PostgreSQL, MySQL and SQLite. This client uses the ${sql.driver} driver, which is none of them.`,
        })
      ),
  });

/**
 * Quotes an identifier: backticks for MySQL, double quotes otherwise, with
 * the quote character doubled inside.
 *
 * @since 0.1.0
 */
export const quoteIdentifier = (dialect: SqlDialect, name: string): string =>
  dialect === 'mysql'
    ? `\`${name.replaceAll('`', '``')}\``
    : `"${name.replaceAll('"', '""')}"`;

/**
 * Renders a string literal. MySQL also escapes backslashes, as Kysely does.
 *
 * @since 0.1.0
 */
export const stringLiteral = (dialect: SqlDialect, value: string): string =>
  dialect === 'mysql'
    ? `'${value.replace(/['\\]/g, (char) => (char === '\\' ? '\\\\' : "''"))}'`
    : `'${value.replaceAll("'", "''")}'`;

/**
 * The binary collation of the key columns, so that ids compare byte by byte
 * on every dialect.
 *
 * @since 0.1.0
 */
export const KEY_COLLATION: { readonly [D in SqlDialect]: string } = {
  postgres: 'collate "C"',
  mysql: 'collate utf8mb4_0900_bin',
  sqlite: 'collate binary',
};

/**
 * The column type of the JSON payload columns of the task table.
 *
 * @since 0.1.0
 */
export const PAYLOAD_TYPE: { readonly [D in SqlDialect]: string } = {
  postgres: 'text',
  mysql: 'longtext',
  sqlite: 'text',
};
