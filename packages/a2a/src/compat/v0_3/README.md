# compat/v0_3

The shared core of the A2A protocol 0.3 compatibility layer. It holds the v0.3
data model and every pure conversion that the v0.3 client and server sides
both need, with the rules of `@a2a-js/sdk` 1.3.0 `compat/v0_3`.

## Boundary

- Belongs here: the v0.3 JSON-RPC schemas (`Types.ts`), their ProtoJSON form
  (`ProtoTypes.ts`), the translation between v0.3 and v1.0 (`translate.ts`),
  the conversion between JSON-RPC and ProtoJSON (`proto.ts`), the Agent Card
  across versions, the method name maps and the v0.3 error shape.
- Does not belong here: transports, HTTP or gRPC handling, and any state.
  Those live in `client/` and `server/`, which depend on this folder; nothing
  here imports from them.
- Nothing here may import `@grpc/grpc-js` or `@bufbuild/protobuf`. The
  ProtoJSON form is plain JSON, so this entry point loads no gRPC code.

## Entry points

Start with `index.ts`, the public `compat/v0_3` entry point. Read
`translate.ts` for the v0.3 to v1.0 rules and `AgentCard.ts` for how one card
serves both versions.

## Constraints

- Functions named `toCompat*` go from v1.0 to v0.3; `toCore*` go from v0.3 to
  v1.0. `fromProto*` and `toProto*` go between the JSON-RPC and protobuf forms
  of v0.3.
- Absent and empty values are omitted, never written as `undefined`, `''` or
  `[]`; each file uses the same `nonEmpty`, `optional` and `nonEmptyList`
  helpers for this.
- Input that cannot be translated fails with `RequestMalformedError`, and a
  v1.0 method without a v0.3 equivalent fails with `UnsupportedOperationError`.
- Lossy conversions (several OAuth flows, several push authentication
  schemes) keep the first entry, as the reference SDK does.
