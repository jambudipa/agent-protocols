# server/internal

Private plumbing of the A2A server, shared by the request handler, the task stores and the protocol bindings. Nothing here is part of the public API.

## Boundary

- Belongs here: helpers that more than one server module needs, such as the HTTP binding plumbing, task state sets and page tokens, the per-task result merging and the keyed lock.
- Does not belong here: public types or services (they live one level up in `server/`), or code that only one binding uses.

## Entry points

- `http.ts`: call contexts, body parsing, SSE responses and defect handling for the HTTP bindings. The gRPC binding and the v0.3 compat servers also use its defect handlers.
- `ResultManager.ts`: how the request handler applies execution events to the stored task.
- `utils.ts`: task state sets, page tokens and history trimming.

## Constraints

- Every load, merge and save of a task runs under the `KeyedLock` of its (tenant, owner, task id), so concurrent requests on one task do not lose writes. Keep new task writes behind that lock.
- These modules depend on `server/` types and services, never on a specific binding.
