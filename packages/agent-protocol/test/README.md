# agent-protocol tests

These tests cover the Agent Protocol server and its typed client: the task and
step lifecycle, artifact upload and download in the workspace, and conformance
of the HTTP API with the vendored `spec/openapi.yml`.

## Harness

Every test runs against a real server on an ephemeral port. `support.ts`
provides `testServer(taskHandler)`, which serves the given handler with a
temporary workspace directory and provides the typed client, the raw
`HttpClient` and the file system. Tests share it through
`layer(testServer(...))` from `@effect/vitest`.

## Constraint

The server, the client and the OpenAPI document all derive from one
`AgentProtocolApi` value. The conformance tests compare that value with the
vendored spec, so a change to the API shape must keep both in step.
