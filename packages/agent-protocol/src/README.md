# agent-protocol source

The Effect v4 implementation of Agent Protocol v1: the wire schemas, the
`HttpApi` definition, the server routes and the typed client. It keeps parity
with the npm `agent-protocol` 1.0.5 reference SDK.

## Boundary

- Belongs here: the public modules of the package. `index.ts` re-exports
  them as the main entry; `node.ts` is the `/node` entry and the only
  module that may depend on `@effect/platform-node`.
- Does not belong here: code that only the server needs and that callers must
  not import. That goes in `internal/`, which the package does not export.

## Where to start

- `Schemas.ts` and `Errors.ts` define the wire shapes. `Api.ts` assembles them
  into the nine endpoints of the specification.
- `AgentProtocolServer.ts` implements the endpoints; `AgentProtocolClient.ts`
  derives the client from the same `Api.ts`.
- `Handler.ts` is the contract an agent implements.

## Constraints

- The wire format follows the specification, not Effect conventions. Error
  responses are `{ "message": ... }`; the tagged errors never cross the wire.
- Client and server share one `HttpApi` definition. Change an endpoint in
  `Api.ts` and both sides follow.
- Every public declaration carries a `@since` tag.
