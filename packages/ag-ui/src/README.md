# src

The source of `@jambudipa/ag-ui`. The files at this level form the common entry point `.`: the AG-UI 1.0 data model, the event schemas and their SSE encoding, the stream operators that verify a run and expand chunks, and the error types. The server, the client and the protobuf binding each have their own folder and their own export path.

## Boundary

- Belongs here: code that both the server and the client need, and that loads neither `@effect/platform-node` nor `@bufbuild/protobuf` at import time.
- Does not belong here: code that only the server or only the client uses (put it in `server/` or `client/`), and anything that imports an optional peer dependency (put protobuf code in `proto/`).

## Where to start

- `index.ts`: the `.` export path. Read it first to see what the common entry point exposes.
- `Types.ts`: the schemas of every `$defs` entry of `spec/1.0/schema.json` apart from the events.
- `Events.ts`: the 31 event schemas, the `AgUiEvent` union, `decodeEvent` and the SSE codec.
- `Verify.ts`: `expandChunks` and `verify`, ported rule for rule from `@ag-ui/client` 1.0.4.
- `Errors.ts`: the tagged errors that tell a decode failure, a rule violation and an HTTP failure apart.

## Constraints

- The schemas follow the vendored `spec/1.0/schema.json`. A change to a shape starts there.
- An optional field is omitted, never `null`, on both sides of the wire.
- Every JSON text goes through a `Schema` codec, never through `JSON.parse` or `JSON.stringify`.
