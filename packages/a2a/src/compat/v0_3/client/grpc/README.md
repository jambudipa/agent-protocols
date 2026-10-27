# compat/v0_3/client/grpc

The v0.3 gRPC client transport. It calls the v0.3 service
`a2a.v1.A2AService` and presents the v1.0 `Transport` operations.

## Boundary

- Belongs here: the gRPC transport and its factory for protocol 0.3.
- Does not belong here: anything that the JSON-RPC or HTTP+JSON transports
  need. This folder is a separate entry point because it loads
  `@grpc/grpc-js` and `@bufbuild/protobuf`; the parent folder must not import
  it.

## Entry points

Open `index.ts`. Pass the factory from `LegacyGrpcTransportFactory.make()` to
`LegacyCompatClient.clientFactory({ transports: [...] })`.

## Constraints

- Calls go through the shared helpers in `client/grpc` (`callUnary`,
  `callServerStream`, `buildMetadata`). This folder supplies only the v0.3
  method paths, the generated v0.3 descriptors and the protocol version
  `0.3` in the metadata.
- The v0.3 service name differs from the v1.0 service name (`lf.a2a.v1`), so
  every call path comes from the generated v0.3 descriptors, never from the
  v1.0 ones.
- Each reply passes through two decodes: protobuf to the v0.3 model, then
  v0.3 to v1.0. A failure in either step becomes an `A2ATransportError`.
