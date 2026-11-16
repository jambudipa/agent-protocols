# @jambudipa/ag-ui

[AG-UI](https://docs.ag-ui.com) 1.0, the agent-to-user event protocol, for
Effect v4: Effect Schemas for every event and message, a server route that
runs an agent as a `Stream` of events, and a client that returns a verified
`Stream` of events. Both speak SSE and protobuf.

It is wire-compatible with the reference TypeScript SDK 1.0.4
(`@ag-ui/client`, `@ag-ui/encoder`, `@ag-ui/proto`): the reference `HttpAgent`
runs against this server, and this client reads what the reference encoder
writes. It uses no RxJS and no Promises.

## Install

```sh
npm install @jambudipa/ag-ui effect@~4.1.4
```

`effect` is a peer dependency. Two peers are optional:

- `@effect/platform-node@~4.1.4`, for `@jambudipa/ag-ui/node`;
- `@bufbuild/protobuf@^2.16.0`, for `@jambudipa/ag-ui/proto`.

`@jambudipa/ag-ui`, `/server` and `/client` load neither.

## Export paths

| Path                      | Contents                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `@jambudipa/ag-ui`        | The schemas, `decodeEvent`, the SSE codec, `verify`, `expandChunks`, the error types |
| `@jambudipa/ag-ui/server` | `AgUiRoute.layer(agent, { path })`                                                   |
| `@jambudipa/ag-ui/client` | `AgUiClient` and `AgUiClient.layer({ url, headers?, encoding? })`                    |
| `@jambudipa/ag-ui/proto`  | `AgUiProto.layer`, `encodeEvent`, `decodeEventBytes`, `encodeFrame`, `decodeFrames`  |
| `@jambudipa/ag-ui/node`   | `layer(agent, { port, path })`: the route on a Node HTTP server                      |

## Serve an agent

An agent is a function from the request to a `Stream` of events, so any loop
can drive it, an `effect/ai` chat included.

```ts
import { NodeRuntime } from '@effect/platform-node';
import { Layer, Stream } from 'effect';
import type { RunAgentInput } from '@jambudipa/ag-ui';
import * as AgUiNode from '@jambudipa/ag-ui/node';
import { AgUiProto } from '@jambudipa/ag-ui/proto';

const echo = (input: RunAgentInput) =>
  Stream.make(
    { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
    { type: 'TEXT_MESSAGE_START', messageId: 'm-1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-1', delta: 'Hello' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm-1' },
    { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId }
  );

AgUiNode.layer(echo, { port: 8000, path: '/agent' }).pipe(
  Layer.provide(AgUiProto.layer), // optional: serve protobuf too
  Layer.launch,
  NodeRuntime.runMain
);
```

The route behaves as follows:

- It decodes the body as a `RunAgentInput`. An invalid body answers 400 with
  `{"error": "..."}` before any event.
- Otherwise it answers 200 and streams the events: as SSE (`data: <json>\n\n`,
  one frame for each event), or as length-prefixed protobuf when the `Accept`
  header prefers `application/vnd.ag-ui.event+proto` and `AgUiProto.layer` is
  provided. `*/*` gets SSE.
- A failure of the agent's stream, or an event that does not match its schema,
  ends the stream with `RUN_ERROR { message }`. The status stays 200.

To serve on another platform, give `AgUiRoute.layer(agent, { path })` from
`@jambudipa/ag-ui/server` to `HttpRouter.serve` with that platform's HTTP
server layer. The route requires what the agent requires.

## Run an agent

```ts
import { Effect, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AgUiClient } from '@jambudipa/ag-ui/client';

const program = Effect.gen(function* () {
  const client = yield* AgUiClient;
  return yield* client
    .run({ threadId: 't-1', runId: 'r-1', messages: [] })
    .pipe(Stream.runCollect);
}).pipe(
  Effect.provide(AgUiClient.layer({ url: 'http://localhost:8000/agent' })),
  Effect.provide(FetchHttpClient.layer)
);
```

`run` posts the input and returns the run as a `Stream` that is decoded,
chunk-expanded and verified:

- `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK` and `REASONING_MESSAGE_CHUNK` arrive
  as the start, content (or args) and end events they stand for.
- The ordering rules of the protocol hold, or the stream fails.
- An unknown field, an unknown union member (a new message role, content
  part, JSON Patch `op` or outcome) and an event of an unknown type are
  dropped. A malformed known field and an explicit `null` on an optional field
  are fatal.

The client keeps no state and reduces nothing: it yields events, not
messages. With `encoding: 'proto'` it asks for protobuf first and needs
`AgUiProto.layer`; either way the response's `Content-Type` decides how it is
read.

### Errors

Every failure of `run` is one of these tagged errors:

| Error                | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `AgUiHttpError`      | The agent answered a status other than 2xx; carries `status` and `body`. |
| `AgUiDecodeError`    | The bytes did not decode: SSE framing, JSON, schema or protobuf.         |
| `AgUiVerifyError`    | The events break an ordering rule; the message names the rule.           |
| `AgUiTransportError` | The request failed or the response broke off.                            |
| `AgUiEncodeError`    | The input is not a valid `RunAgentInput`; nothing was sent.              |

## Use the operators alone

`decodeSse`, `expandChunks` and `verify` are plain `Stream` operators, so a
custom transport can reuse them:

```ts
import { decodeSse, expandChunks, verify } from '@jambudipa/ag-ui';

const events = decodeSse(bytes).pipe(expandChunks, verify);
```

`verify` and `expandChunks` port `verify.ts` and `chunks/transform.ts` of
`@ag-ui/client` 1.0.4 rule for rule, with the same messages. Every fixture of
the shared conformance corpus (`spec/1.0/conformance/streams/`) gives the
outcome that the specification requires.

## Scope

- AG-UI 1.0 only. The deprecated `THINKING_*` events and the draft
  `META_EVENT` have no schema; a reader drops them as unknown.
- The protobuf reader fails on an envelope arm that AG-UI 1.0 does not
  define. The reference client drops such a frame with a warning instead.
- No state reducer, no middleware, no compatibility shims for pre-1.0 peers.

## Licence

MIT. The vendored files under `spec/` are MIT-licensed by the AG-UI authors;
see `spec/LICENSE`.
