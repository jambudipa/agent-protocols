# Documentation sweep notes

Judgements from the enforce-code-docs sweep of 2026-10-27 that the
`docs:audit` gate cannot re-derive.

## Exclusions

- `packages/a2a/src/generated`: protoc-gen-es output. `npm run generate`
  rewrites the folder, so hand-written JSDoc there would be lost.
- `eslint/`: byte-identical copies of the canonical Effect rule bundle in
  `~/.agents`. Adding JSDoc would break that identity.

## Findings left in the code

The sweep changed comments only. Each finding below is recorded in the JSDoc
of the declaration it concerns, and waits for a decision.

- `packages/a2a/src/server/sql/Migrations.ts` `withMigrationLock`: the MySQL
  `get_lock(..., 3600)` result is not checked. `get_lock` returns 0 on timeout
  without an error, so after one hour the migration runs without the lock.
  Kysely's MySQL adapter behaves the same way.
- `packages/a2a/src/Signature.ts` `verifyOne`: every failure, including a
  failure of `retrievePublicKey`, becomes `false`. The verifier therefore never
  surfaces its declared error type `E`.
- `packages/a2a/src/errors/index.ts` `A2AErrorTags`: a hand-kept copy of the
  `A2AError` union. The compiler does not check that the two agree.
- `packages/a2a/src/client/Client.ts` `deleteTaskPushNotificationConfig`: it
  does not run the push-capability check that the create, get and list push
  calls run.
- `packages/a2a/src/compat/v0_3/AgentCard.ts` `toCompatOAuthFlows`: a v1.0
  `deviceCode` flow becomes `{}`, so the v0.3 card has an oauth2 scheme with no
  flows.
- `packages/agent-protocol/src/internal` `TaskStore.appendStep` and
  `addArtifact`: an unknown task id is a silent no-op. Current callers check
  the task first.

## Possibly unused

- `packages/a2a/src/client/internal` `HttpResult.statusText`: always `''`, and
  no caller reads it.
- `packages/a2a/src/compat/v0_3/server/Rest.ts` `LegacyRestInput.request`: no
  route reads it.
- `packages/a2a/src/compat/v0_3/proto.ts` `ProtoFlow`: the name suggests an
  OAuth flow, but the type is a whole security scheme.
