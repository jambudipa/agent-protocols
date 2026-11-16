---
title: 'AG-UI 1.0 package: Effect schemas, SSE server and streaming client'
type: 'feature'
ticket: ''
created: '2026-11-16'
status: 'built'
baseline_revision: '35b5a1340141e32a0445f2c21dc3aa74ff16e7b2'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '~/.agents/guidance/typescript-effect/AGENTS.md'
  - '{project-root}/_bmad-output/plan-2-a2a-package.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The workspace covers agent-to-tools (MCP via `effect/ai`), human-to-agent and agent-to-agent, but not AG-UI 1.0, the agent-to-user event protocol from CopilotKit. Effect users must drop to `@ag-ui/client` Promises and RxJS to serve or consume an AG-UI agent.

**Approach:** A new package `@jambudipa/ag-ui` in `packages/ag-ui/`: Effect Schemas written by hand from the pinned AG-UI 1.0 JSON Schema (events, messages, `RunAgentInput`), a server route that runs an agent as `Stream<AgUiEvent>` and answers with SSE or protobuf by `Accept` negotiation, and a client that POSTs `RunAgentInput` and returns a verified, chunk-expanded `Stream<AgUiEvent>`.

**Decisions (2026-11-16):** Both encodings: SSE and protobuf (`application/vnd.ag-ui.event+proto`). Client depth: verified stream plus chunk expansion; no state reducer. Interop: `@ag-ui/client`, `@ag-ui/encoder` and `@ag-ui/proto` 1.0.4 as dev dependencies. Plan size accepted above 1600 tokens.

## Boundaries & Constraints

**Always:** Follow plan 2's package pattern (Vite lib build per export path, `tsc --emitDeclarationOnly`, `publishConfig.access: public`, MIT `LICENSE`, `repository.directory`, Effect `~4.1.4`). Wire format byte-compatible with `@ag-ui/encoder` 1.0.4: SSE `data: <json>\n\n` with no `event:` or `id:` lines and optional fields omitted (never `null`); protobuf frames as a 4-byte big-endian length then `ag_ui.Event` bytes, chosen only when `Accept` prefers the proto media type. Protobuf lives behind `./proto`; `@bufbuild/protobuf` is an optional peer, and importing `.`, `./server` or `./client` must not load it. Decode tolerates unknown fields (strip, not reject). Wire decode failure, verification failure and HTTP failure are distinct tagged errors. Every event and message type of `spec/1.0/schema.json` has a schema. Commit as you go.

**Never:** No RxJS, `fetch`, `async`/`await` or Promises in package source. No runtime dependency on `@ag-ui/*`. No changes to the other packages. No `META_EVENT` (draft) and no deprecated `THINKING_*` events. No npm publish.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy run | POST valid `RunAgentInput`, agent emits RUN_STARTED … RUN_FINISHED | 200 `text/event-stream`, one `data:` frame per event, client stream yields the same events | No error expected |
| Bad input | POST body `{}` | 400 before any SSE output | Client fails with HTTP error carrying status and body |
| Agent fails mid-run | Agent stream fails after RUN_STARTED | Server emits `RUN_ERROR{message}` and ends the stream | No HTTP status change |
| Out of order | Server sends TEXT_MESSAGE_CONTENT for an unopened id | Client stream fails | Verification error naming the rule |
| Explicit null | Event with `"name": null` | Client stream fails | Decode error |
| Unknown field | Event with an extra field | Event decoded, field dropped | No error expected |
| Proto negotiation | Request `Accept: application/vnd.ag-ui.event+proto` | Length-prefixed protobuf frames; client with proto enabled yields the same events as SSE | Unknown oneof arm fails decode |
| Chunks | TEXT_MESSAGE_CHUNK / TOOL_CALL_CHUNK sequence | Client yields expanded START / CONTENT(ARGS) / END | Conflicting role or tool name fails verification |

</frozen-after-approval>

## Code Map

- `packages/agent-protocol/` -- skeleton to copy: `package.json` (exports `{types,import,default}`, `files`, scripts, peer = dev deps), `vite.config.ts` (lib entries, `external: [/^effect(\/|$)/, /^@effect\//, /^node:/]`, `ssr`, `target: node24`), `tsconfig.json` (extends `../../tsconfig.base.json`), `LICENSE`, `src/node.ts` (only module importing `@effect/platform-node`; `defaultPort`, `HttpRouter.serve` + `NodeHttpServer.layer`), `test/support.ts` (`NodeHttpServer.layerTest`). Do not edit.
- `packages/a2a/src/Sse.ts` -- `formatSSEEvent` and `parseSseStream` (`effect/encoding` `Sse.decode`, 4 MiB `maxEventSize`); copy the approach, do not import across packages.
- `packages/a2a/src/server/internal/http.ts:202` `sseResponse` -- `HttpServerResponse.stream(Stream.encodeText(...))` with `Cache-Control`, `Connection`, `X-Accel-Buffering: no`; `server/JsonRpc.ts` ~549 `resultEvents` + `peelFirst` (headers wait for the first event).
- `packages/a2a/src/server/AgentCardRoute.ts` -- `HttpRouter.use(router => router.add('POST', path, handler))` route-layer shape.
- `packages/a2a/src/Types.ts` -- `Schema.Struct` + `Schema.Union([...]).annotate({ identifier })` + `type X = typeof X.Type` style; for AG-UI use a `type` literal discriminator per event.
- Registration is by glob (workspaces, root `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs` `SOURCES`, `docs:audit`): only root `README.md` table and a `.changeset/` file need edits. `eslint.config.mjs` needs a scoped block only if an exception arises (no inline disables: `noInlineConfig: true`).
- Folder README shape: `# name`, intro, `## Boundary`, `## Where to start`, `## Constraints` (see `packages/agent-protocol/src/README.md`); JSDoc header + `@since 0.1.0` on every declaration.
- AG-UI source, vendor into `packages/ag-ui/spec/` from `ag-ui-protocol/ag-ui` at tag `@ag-ui/core@1.0.4` = `d540f5934429bd548ba9c53da286028958e7506a` (spec identical to HEAD `344d21f`): `spec/1.0/schema.json`, `spec/1.0/conformance/streams/*.json` (69 fixtures, `{name, stream, expect:{outcome, errorContains}}`), `LICENSE` (MIT). Behaviour sources: `sdks/typescript/packages/encoder/src/encoder.ts`, `client/src/transform/sse.ts`, `client/src/verify/verify.ts`, `client/src/agent/http.ts`. Protobuf: vendor `sdks/typescript/packages/proto/src/proto/{events,patch,types}.proto` (package `ag_ui`, imports `google/protobuf/struct.proto`); the reference converters are `proto/src/proto.ts` (`encode` l.495, `decode` l.1235, 1506 lines; proto messages do not mirror the JSON events, so port the converters, do not rely on `fromJson`); framing in `client/src/transform/proto.ts`; negotiation in `encoder/src/encoder.ts` (`preferredMediaTypes`). Generate with buf + `@bufbuild/protoc-gen-es` as `packages/a2a` does (`buf.yaml`, `buf.gen.yaml`, committed `src/generated/`, `docs:audit --exclude`, scoped eslint ignore). A local clone is at the session scratchpad `agui/repo`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ag-ui/spec/` -- vendor schema, conformance streams and LICENSE at the pinned commit -- test corpus
- [x] `packages/ag-ui/{package.json,vite.config.ts,tsconfig.json,LICENSE,README.md}` -- package shell with exports `.`, `./server`, `./client`, `./node` -- installable package
- [x] `packages/ag-ui/src/Types.ts`, `Events.ts` -- schemas for every 1.0 `$defs` entry; `AgUiEvent` union on `type`; `RunAgentInput`; `encodeSse` / `decodeSse` -- wire core
- [x] `packages/ag-ui/src/Verify.ts` -- `verify` and chunk expansion as `Stream` operators with the rules of `verify.ts` -- client parity
- [x] `packages/ag-ui/src/server/AgUiRoute.ts` -- `AgUiRoute.layer(agent, { path })`, `agent: (input) => Stream<AgUiEvent, E, R>`; 400 on bad input; failure becomes `RUN_ERROR` -- server
- [x] `packages/ag-ui/src/client/AgUiClient.ts` -- `Context.Service` with `run(input): Stream<AgUiEvent, AgUiClientError>` on `HttpClient`, `layer({ url, headers? })` -- client
- [x] `packages/ag-ui/{buf.yaml,buf.gen.yaml}`, `src/generated/`, `src/proto/` -- generated protobuf-es code and an Effect `encode`/`decode` port of the reference converters plus length-prefix framing, exported as `./proto` -- protobuf binding
- [x] server and client -- `Accept` negotiation on the server; client option `encoding: 'sse' | 'proto'` that sets `Accept` and picks the parser from the response `Content-Type` -- protobuf transport
- [x] `packages/ag-ui/src/node.ts` -- Node server layer -- convenience
- [x] `packages/ag-ui/test/` -- schema round trip, conformance corpus through `verify`, server+client round trip over both encodings, interop with `HttpAgent`, `EventEncoder` and `@ag-ui/proto` `encode`/`decode`, each I/O matrix row -- proof
- [x] `README.md` (root row "Agent to UI", AG-UI 1.0), `.changeset/` -- docs and release

**Acceptance Criteria:**
- Given every non-fatal conformance fixture, when its stream passes through `verify`, then it completes; given every `*-fatal` fixture, then it fails with an error containing `expect.errorContains`.
- Given the server runs an agent emitting a fixed event list, when the client runs it, then the client yields that list unchanged.
- Given every event in the conformance corpus, when our protobuf `encode` runs, then `@ag-ui/proto` `decode` returns the same event, and the reverse holds.
- Given `HttpAgent` from `@ag-ui/client` runs against our server, then it completes without a verification error, over SSE and over protobuf.
- Given a package consumer imports `@jambudipa/ag-ui`, `./server` or `./client`, then neither `@effect/platform-node` nor `@bufbuild/protobuf` is loaded.

## Design Notes

The agent contract is a plain function to a `Stream`, so any LLM loop (including `effect/ai`) can drive it:

```ts
const echo = (input: RunAgentInput) => Stream.make(
  { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
  { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId })
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run test:run && npm run build && npm run docs:audit` -- expected: all exit 0

## Implementation Notes

- Implemented in 14 commits from `8ff10cf` to `b949dfc`, one or more per task.
- Tolerance: unknown keys drop through the schemas; unknown union members (message role, content part, part source, JSON Patch `op`, run and subagent `outcome`) are stripped by a pre-decode pass (`src/internal/tolerance.ts`), as the reference enforcement stage does. An event of an unknown `type` (including `THINKING_*` and `META_EVENT`) is dropped with a logged warning.
- Decode errors render as a JSON array of `"<pointer>: expected X, received Y"` lines. The JSON form is needed because the fixture `reasoning-message-wrong-role-fatal` expects `expected \"reasoning\"` with escaped quotes, the shape of a zod error message.
- Protobuf: the converters port `@ag-ui/proto`'s reshaping (merged `Message` carriers, flat outcomes, the `op` enum); protobuf-es `fromJson`/`toJson` encode only the leaves (`Value`, `Struct`, `int64`). Frames are byte-identical to `EventEncoder` for the sample run. An unknown envelope arm fails, per the matrix; the reference drops it.
- Negotiation offers SSE first, so `*/*` gets SSE (the reference encoder would answer protobuf). Protobuf is served only when `AgUiProto.layer` provides the `AgUiProtoCodec` service; `server` and `client` never import `@bufbuild/protobuf`.
- Additions beyond the plan: `AgUiEncodeError` (an event or input that does not match its schema) and `AgUiTransportError` (network failure), both in `AgUiClientError` beside the three planned errors. `@effect/platform-node` is an optional peer, since only `./node` loads it.
- Verification: `npm run typecheck`, `lint` (ESLint and the Effect language service, 0 diagnostics), `test:run` (593 of 593; 35 in `packages/ag-ui`), `build`, `docs:audit`, `format:check` all exit 0. `npm run generate` gives no diff. A Node resolve hook confirms that `dist/index.js`, `dist/server/index.js` and `dist/client/index.js` load neither optional peer.

## Plan Change Log

## Review Triage Log
