# client/grpc

The gRPC transport of the A2A client. It calls the 1.0 service
`lf.a2a.v1.A2AService` over `@grpc/grpc-js` and presents the client
`Transport` contract.

## Boundary

- Belongs here: the 1.0 gRPC transport, its factory, and the low-level call
  helpers (`callUnary`, `callServerStream`, `buildMetadata`) that the v0.3
  gRPC transport in `compat/v0_3/client/grpc` reuses.
- Does not belong here: anything the JSON-RPC or HTTP+JSON transports need.
  This folder is a separate entry point because it loads `@grpc/grpc-js`, an
  optional peer dependency; the parent `client` folder must not import it.
- Does not belong here: the protobuf conversion tables. They live in
  `server/grpc/codec.ts` and serve both sides.

## Entry points

Open `index.ts`. Pass the factory from `GrpcTransportFactory.make()` to
`ClientFactory.make({ transports: [...] })`.

## Constraints

- Every `grpc.Client` closes with a scope: `GrpcTransport.make` closes its
  own, and `GrpcTransportFactory` closes every client it opened when its
  scope closes. A legacy transport must never close the client it receives.
- Interruption cancels the gRPC call, for unary and streaming calls alike.
- Every failure, including a model to protobuf conversion failure, reaches the
  caller as a `ClientError`, never as a raw gRPC or schema error.
- `A2A-Version` metadata defaults to the protocol version of the transport
  when the service parameters do not set it.
