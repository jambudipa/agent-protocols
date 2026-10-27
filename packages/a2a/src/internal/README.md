# internal

Private helpers shared by the common entry point, the server, the client and the v0.3 compatibility layer. Nothing here is exported from the package.

## Boundary

- Belongs here: small, dependency-free helpers that more than one top-level area needs, such as JSON codecs, JCS canonicalization, ProtoJSON schema building blocks and protocol version comparison.
- Does not belong here: helpers that only the server or only the client uses (use `server/internal/` or `client/internal/`), and anything that imports an optional peer dependency.

## Entry points

- `json.ts`: the JSON text codecs that every module uses in place of `JSON.parse` and `JSON.stringify`.
- `proto.ts`: the schema building blocks that `Types.ts` and the v0.3 schemas are made of.

## Constraints

- These modules import only `effect` and `Constants.ts`. They must never import from `server/`, `client/` or `compat/`, because all of those import from here.
- `jcs.ts` must produce the same bytes as RFC 8785 on every platform, because Agent Card signatures are computed over its output. Any change there breaks the verification of existing signatures.
