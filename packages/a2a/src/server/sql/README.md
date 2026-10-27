# server/sql

SQL persistence for the A2A server on `effect/sql`: a `TaskStore` and a `PushNotificationStore` for PostgreSQL, MySQL and SQLite, their schema migrations, and the `a2a-db` CLI that runs them. It is published as the `@jambudipa/a2a/server/sql` entry point; the CLI is the `a2a-db` bin.

## Boundary

- Belongs here: the SQL store implementations, the per-dialect rendering of identifiers, literals and column types, the migrations with their ledger and lock, and the `a2a-db` commands.
- Does not belong here: the store contracts (`../TaskStore.ts`, `../PushNotificationStore.ts`), caller scoping (`../ServerCallContext.ts`), page-token encoding (`../internal`), or any in-memory store.

## Entry points

- `index.ts` is the public module. It re-exports everything except `Cli.ts`.
- `Migrations.ts` defines the schema. Read it before changing a column, an index or a table name rule.
- `Cli.ts` holds the `a2a-db` commands; `src/bin/a2a-db.ts` only runs them.

## Constraints

- Compatibility with `@a2a-js/sdk` 1.3.0 is the design rule. The tables, row formats, migration names, ledger tables (`a2a_<table>_migrations`), lock table and advisory lock ids match the reference SDK and Kysely, so either tool can read and migrate a database that the other wrote. Do not change them in isolation.
- Every migration statement is rendered as text once. The online migrator runs the same text that `a2a-db --sql` prints, so values are inlined with `stringLiteral` and never bound.
- `index.ts` loads no driver. The caller provides the `SqlClient`; `Cli.ts` imports a driver dynamically, only when a command connects.
- The stores do not migrate on start-up. Run `migrateToLatest()` or `a2a-db upgrade` first.
- Key columns use a binary collation (`KEY_COLLATION`) so that ids sort and compare byte by byte on every dialect, as in the reference SDK.
- Every store query is limited to the caller's tenant and owner. A row that fails to decode is logged and skipped, not returned as an error.
