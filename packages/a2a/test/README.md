# a2a tests

These tests cover the A2A v1.0 package end to end: the ProtoJSON data model,
the JSON-RPC, HTTP+JSON and gRPC bindings, the client, push notifications,
Agent Card signatures, the SQL stores and the `a2a-db` CLI, and the v0.3
compatibility layer.

## Harness

- Each binding test runs against a real server on an ephemeral port. Start with
  `support.ts`: `testServer()` builds the echo agent, its Agent Card and the
  server, and the tests share it through `layer(testServer())` from
  `@effect/vitest`. The echo agent picks its behaviour from the message text,
  so a test selects a scenario by what it sends.
- `http.ts` holds the raw JSON-RPC, REST and SSE helpers. Use them when a test
  must see the wire format rather than the typed client.
- Interop tests run against `@a2a-js/sdk` 1.3.0 as the reference
  implementation. `reference.ts` holds the reference agent and its Express
  server; `compat-support.ts` adds the v0.3 copy of the echo card.

## Boundary

Tests for the package's own behaviour belong here. The reference SDK is a test
oracle only: keep it out of `src`. Its Promise API meets Effect only inside
`reference.ts`, through `Effect.runPromise`.
