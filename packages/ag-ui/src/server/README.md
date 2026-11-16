# server

The AG-UI server, exported as `@jambudipa/ag-ui/server`: `AgUiRoute.layer(agent, { path })` adds a `POST` endpoint to an `HttpRouter` that runs an agent and streams its events.

## Boundary

- Belongs here: the HTTP endpoint, the decoding of the request body, `Accept` negotiation between SSE and protobuf, and the conversion of an agent failure into `RUN_ERROR`.
- Does not belong here: the agent logic (an `Agent` is the caller's function), the Node HTTP server (`../node.ts`), and protobuf code (`../proto/`, reached only through `AgUiProtoCodec`).

## Where to start

- `index.ts`: the export path.
- `AgUiRoute.ts`: the route. An invalid body answers 400 before any event; otherwise the status is 200 and the body is the run.

## Constraints

- This folder must not import `@effect/platform-node` or `@bufbuild/protobuf`; `test/entrypoints.test.ts` proves it.
- Protobuf is served only when the `Accept` header prefers it and `AgUiProto.layer` is provided. `*/*` gets SSE, as the plan requires.
- The SSE wire must stay byte-compatible with `@ag-ui/encoder` 1.0.4: `data: <json>\n\n` and nothing else.
