# src

The source of `@jambudipa/a2a`. The files at this level form the common entry point `.`: the A2A v1.0 data model, constants, extension helpers, SSE helpers and Agent Card signatures. The server, the client, the v0.3 compatibility layer and the error mappings each have their own folder and their own export path.

## Boundary

- Belongs here: code that both the server and the client need, and that loads no gRPC, protobuf, SQL or `jose` code at import time.
- Does not belong here: anything that only a server or only a client uses (put it in `server/` or `client/`), and anything that pulls in an optional peer dependency at import time.
- `generated/` holds protobuf code produced by a generator. Do not edit it by hand.

## Entry points

- `index.ts`: the `.` export path. Read it first to see what the common entry point exposes.
- `Types.ts`: the Effect Schemas of the protocol messages, in ProtoJSON form.
- `Signature.ts`: Agent Card signing and verification over the JCS canonical form.
- `node.ts`: the `./node` export path, a ready HTTP server for Node.js.

## Constraints

- `index.ts` must stay free of heavy imports. `Signature.ts` imports `jose` lazily for this reason; keep any new optional dependency behind a lazy import or a separate export path.
- Every JSON text goes through the codecs in `internal/json.ts`, never through `JSON.parse` or `JSON.stringify`.
- The schemas follow the vendored `spec/proto/v1/a2a.proto`. A change to a message starts there.
