# ag-ui tests

These tests cover the AG-UI 1.0 package: the schemas, the conformance corpus through `verify`, the server and the client over SSE and protobuf, and interop with the reference SDK.

## Harness

- `fixtures.ts` loads the vendored conformance fixtures from `spec/1.0/conformance/streams/`.
- The server tests run a real server on an ephemeral port through `NodeHttpServer.layerTest`.
- Interop tests use `@ag-ui/client`, `@ag-ui/encoder` and `@ag-ui/proto` 1.0.4 as the reference implementation.

## Boundary

Tests for the package's own behaviour belong here. The reference SDK is a test oracle only: keep it out of `src`. Its Promise API meets Effect only through `Effect.tryPromise` inside the tests.
