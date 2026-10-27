# compat/v0_3/client

The client side of the A2A v0.3 compatibility layer. It lets the v1.0 client
talk to an agent that still speaks protocol 0.3, without changing the v1.0
`Transport` contract that callers use.

## Boundary

- Belongs here: v0.3 transports that present the v1.0 operations, and the
  wiring that makes the v1.0 factories and card resolver choose them.
- Does not belong here: the v0.3 data model, the v0.3 to v1.0 translation and
  the protobuf JSON mapping. Those live one level up (`Types.ts`,
  `translate.ts`, `proto.ts`) and are shared with the server side.
- gRPC lives in `grpc/`, a separate entry point, so that this folder loads no
  gRPC or protobuf runtime code.

## Entry points

Start with `index.ts`. `LegacyCompatClient.clientFactory()` is what most
callers need; it picks the v0.3 transport for an interface that declares
protocol version 0.3 and the v1.0 transport otherwise.

## Constraints

- Each transport encodes v1.0 input to v0.3 with `toCompat*`, and decodes
  v0.3 replies to v1.0 with `toCore*`. A translation failure becomes an
  `A2ATransportError` that names the transport protocol.
- Operations that have no v0.3 equivalent, such as `listTasks`, fail rather
  than approximate the v1.0 behaviour.
- The transports reuse the HTTP helpers in `client/internal/http.ts`, so
  header, SSE and error handling stay consistent with the v1.0 transports.
