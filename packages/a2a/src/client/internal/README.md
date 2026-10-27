# client/internal

Shared plumbing of the HTTP client transports: request execution, JSON and
SSE bodies, header handling and failure mapping. Nothing here is public API.

## Boundary

- Belongs here: helpers that the 1.0 JSON-RPC and HTTP+JSON transports, the
  agent card resolver, and the v0.3 HTTP transports in `compat/v0_3/client`
  all share.
- Does not belong here: anything specific to one protocol binding, and
  anything for gRPC, which has its own helpers in `client/grpc`.

## Entry points

Open `http.ts`. Transports execute with `executeText` or `executeStream`, then
parse with `parseBody`, `decodeResponse` or `sseEvents`.

## Constraints

- Every helper fails with an `A2ATransportError` that carries the protocol
  name the caller passes, so errors name the binding that raised them.
- Helpers do not interpret HTTP status: they return it, and the caller
  decides with `isOk` how to map a non-2xx response.
