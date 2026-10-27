# client

The A2A client, exported as `@jambudipa/a2a/client`. It turns an Agent Card
into a `Client` that makes the v1.0 protocol calls over JSON-RPC or HTTP+JSON,
on the Effect `HttpClient` of the context.

## Boundary

Belongs here: the client factory, the client and its call pipeline, the
transport contract and its JSON-RPC and HTTP+JSON implementations, Agent Card
resolution, call interceptors, authentication and service parameters.

Does not belong here:

- gRPC. It lives in `grpc/`, a separate entry point, so that this one loads
  no gRPC, protobuf, `jose` or SQL code. Keep those imports out of this folder.
- v0.3 support. The compatibility layer supplies it through the `legacy` hooks
  of the resolver and the JSON-RPC factory.
- Shared HTTP plumbing (request execution, SSE parsing, error mapping). It
  lives in `internal/` and is not exported.

## Entry points

- `ClientFactory.ts`: start here. It selects the transport from the card.
- `Client.ts`: the call pipeline that every operation runs through.
- `Transport.ts`: the contract that a new binding implements.

## Constraints

- `Client` calls go through the interceptors and header normalization. A
  direct `Transport` call skips both, so `A2A-Version` is not set for it.
- Protocol binding names match case-insensitively everywhere.
- Where a card offers several interfaces for one binding, protocol version
  1.0 wins.
- A non-empty interface `tenant` is applied by `TenantTransportDecorator`, not
  by the transports themselves.
