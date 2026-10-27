# compat/v0_3/server/grpc

The v0.3 gRPC service `a2a.v1.A2AService` over the v1.0 request handler, with
the behaviour of `legacyGrpcService` of `@a2a-js/sdk` 1.3.0. Serve it beside
the v1.0 service through `additionalServices` of `A2AGrpcServer`.

## Boundary

- Belongs here: the gRPC wiring of the v0.3 methods, meaning metadata to call
  context, protobuf decode and encode, and gRPC status on failure.
- Does not belong here: the v0.3 to v1.0 translation (`../../translate.ts`,
  `../../proto.ts`) and the generic gRPC helpers (`server/grpc`).
- This is a separate entry point because it loads `@grpc/grpc-js` and
  `@bufbuild/protobuf`. The HTTP side of the compatibility layer must not
  import it.

## Entry point

`index.ts` exports `legacyGrpcService` and the bare `LegacyA2AService`
definition.

## Constraints

- Each method pairs a codec with a protobuf descriptor. The two must describe
  the same message.
- Every failure becomes a known A2A error before it maps to a gRPC status. A
  call that the client cancels is interrupted and sends no reply.
- The Agent Card must declare a `GRPC` interface with protocol version 0.3.
