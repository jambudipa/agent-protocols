# server/grpc/internal

Private helpers of the gRPC server binding. Nothing here is part of the public API.

## Boundary

- Belongs here: thin adapters to grpc-js contracts that need a lint exception or that the v0.3 compat gRPC server shares with `server/grpc`.
- Does not belong here: service logic or anything a user of the package should import.

## Constraints

- `callbacks.ts` is the only place in the binding that passes `null` to a grpc-js unary callback, because grpc-js reads a `null` error as success. The lint configuration scopes that exception to this file, so keep every such call here.
