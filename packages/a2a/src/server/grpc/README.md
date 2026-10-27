# server/grpc

The gRPC binding of the A2A server (specification §10). It serves `lf.a2a.v1.A2AService` on `@grpc/grpc-js` over the `A2ARequestHandler`, and it is published as the `@jambudipa/a2a/server/grpc` entry point.

## Boundary

- Belongs here: the grpc-js service definition and implementation, the server layer, and the codec between the Effect schemas and the protobuf-es messages.
- Does not belong here: request handling logic (that lives in `A2ARequestHandler`), the mapping of A2A errors to gRPC status codes (`errors/grpc`), or the generated protobuf code (`generated`).

## Entry points

- `index.ts` is the public module: `A2AGrpcServer`, `grpcService` and `A2AService`.
- `codec.ts` holds the schema-to-protobuf conversion. The gRPC clients (`client/grpc` and the v0.3 compat client) import it too, so a change there affects both sides.

## Constraints

- Only this entry point loads `@grpc/grpc-js` on the server side. It is an optional peer dependency, so no other server module may import it.
- There is one codec: values go through their ProtoJSON form with the schema, then through protobuf-es `fromJson`/`toJson`. Do not hand-write a second mapping.
- Every call runs as an Effect; a cancelled call interrupts it and sends no response.
- The v0.3 compat gRPC server reuses helpers from `index.ts` and `internal/`.
