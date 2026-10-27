# errors/grpc

The gRPC mapping of the A2A errors: the status code of each error and the `grpc-status-details-bin` trailer. This folder is the `./errors/grpc` export path.

## Boundary

- Belongs here: conversions between A2A errors and gRPC status codes, trailers and service errors, used by both the gRPC server and the gRPC client.
- Does not belong here: the error classes and the non-gRPC tables, which live in `errors/`.

## Constraints

- This module loads `@bufbuild/protobuf` but never `@grpc/grpc-js`. It reads gRPC metadata and service errors through structural types, so that a caller can pass the `@grpc/grpc-js` objects without this module importing them.
- Decoding is total: a malformed trailer gives an `A2ATransportError` rather than a throw.
