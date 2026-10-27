# server

The A2A v1.0 server, published as `@jambudipa/a2a/server`. It holds the
transport-neutral request handler, the contracts that an application
implements (the agent executor, the stores, the push sender) with their
in-memory defaults, and the HTTP bindings on the Effect `HttpRouter`.

## Boundary

- Belongs here: protocol behaviour that every binding shares, the service
  contracts, the in-memory implementations, and the HTTP bindings (JSON-RPC,
  HTTP+JSON and the Agent Card route).
- Does not belong here: anything that loads gRPC, protobuf, `jose` or SQL
  code. The gRPC binding lives in `grpc/` and the SQL stores in `sql/`, each
  behind its own entry point, so that an HTTP-only server does not pay for
  them.
- Does not belong here: protocol 0.3. The bindings accept a `LegacyCompat`
  value that `@jambudipa/a2a/compat/v0_3/server` supplies; this folder never
  imports the compat code.
- `internal/` holds helpers shared by the bindings. `index.ts` does not
  export them, apart from the `HttpBindingOptions` type.

## Entry points

- `RequestHandler.ts`: `A2ARequestHandler` and `DefaultRequestHandler`, the
  core that every binding calls. Read it first.
- `AgentExecutor.ts` and `ExecutionEventBus.ts`: the contract for the agent
  logic and the bus that carries its events.
- `HttpRoutes.ts`: `A2AHttpRoutes`, all HTTP bindings in one layer.
- `index.ts`: the public surface of the entry point.

## Constraints across files

- Every store and the bus manager scope their records by tenant and owner
  through `callerScope` and `CurrentOwnerResolver` in `ServerCallContext.ts`.
  A new store must do the same, or one caller can read another's tasks.
- The bindings translate between the wire and the request handler. Put a
  rule that applies to every transport in the request handler, not in one
  binding.
- Background work (executions, push deliveries) runs in fiber sets owned by
  the scope that builds the handler or sender. Closing that scope interrupts
  it.
