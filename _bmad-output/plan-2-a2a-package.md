---
title: 'A2A v1.0 package with full @a2a-js/sdk 1.3.0 parity'
type: 'feature'
ticket: ''
created: '2026-10-23'
status: 'built'
baseline_revision: '284ef15309c753c99765c1759bc8df2118cb4d0e'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/brief.md'
  - '~/.agents/guidance/typescript-effect/AGENTS.md'
  - '{project-root}/_bmad-output/plan-1-agent-protocol-package.md'
warnings: ['multiple-goals', 'oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No Effect v4 implementation of A2A exists. `brief.md` build order item 2 asks for `@jambudipa/a2a` at full parity with `@a2a-js/sdk` 1.3.0: client and server over all three bindings (JSON-RPC, gRPC, HTTP+JSON).

**Approach:** One package whose subpath exports mirror the reference SDK: v1.0 wire schemas, errors, a server (request handler, agent executor contract, stores, push sender, binding routes, Agent Card endpoint), a multi-transport client, gRPC through `@grpc/grpc-js` at a thin boundary, SQL stores on `effect/sql`, Agent Card signatures, and the v0.3 compatibility adapters. Interop tests against the reference SDK prove parity.

## Boundaries & Constraints

**Always:** Follow plan 1's workspace pattern (Vite library build with one entry per export path, `tsc --emitDeclarationOnly`, npm-prep package fields, `publishConfig.access: public`, MIT `LICENSE`, `repository.directory`). Effect `~4.0.6`; every `@effect/*` package on the same range. ProtoJSON on every JSON wire: lowerCamelCase fields, full enum names (`TASK_STATE_WORKING`), a oneof as its member key, base64 bytes, RFC 3339 UTC timestamps, unknown fields ignored. Accept `application/json` and `application/a2a+json`. Error codes, HTTP statuses, gRPC statuses and `google.rpc.Status`/`ErrorInfo` bodies exactly as the reference. Reference behaviours are the tie-breaker wherever the spec is silent. Optional peers stay optional: importing `.`, `./server`, `./client` must not load `@grpc/grpc-js`, `@bufbuild/protobuf`, `jose` or a SQL driver. Commit as you go: one commit per task below at most, smaller is better.

**Never:** No Express, `fetch`, `node:fs`, `async`/`await` or Promises in Effect-owned source (only inside the gRPC, `jose` and generated-code boundaries, each kept thin and covered by scoped lint config, never inline disables). No kysely: SQL goes through `effect/sql`. No changes to `packages/agent-protocol`. No npm publish.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Version absent | Request without `A2A-Version`, legacy compat off | Treated as 0.3 | -32009 / 400 / FAILED_PRECONDITION |
| Unknown method | JSON-RPC `method: "Nope"` | Error response, HTTP 200 | -32601 |
| Bad params | `SendMessage` without `message` | Error response | -32602 |
| Malformed JSON | Body `{` | Error response | -32700 |
| Unknown task | `GetTask` id `x` | Not found on each binding | -32001 / 404 / NOT_FOUND |
| Cancel terminal task | Task in `TASK_STATE_COMPLETED` | Rejected | -32002 / 400 |
| Push not enabled | Push config create, `capabilities.pushNotifications` false | Rejected | -32003 |
| Extended card off | `GetExtendedAgentCard` with none configured | Rejected | -32007 |
| Executor fails | `execute` fails before any event | Task stored with `TASK_STATE_FAILED` | Normal response |
| Mid-stream failure | Executor fails after events were streamed | `event: error` SSE event, stream ends | No HTTP status change |
| Card caching | `GET /.well-known/agent-card.json` with matching `If-None-Match` | 304, weak ETag, `max-age=3600` | No error expected |
| Subscribe verb | `GET` or `POST /tasks/{id}:subscribe` | Both stream the task | No error expected |

</intent-contract>

## Code Map

- `brief.md` -- item 2; package name `@jambudipa/a2a`, folder `packages/a2a/`
- `packages/agent-protocol/` -- the pattern to copy: `package.json` fields and scripts, `vite.config.ts` (lib entries, `rolldownOptions.external`, `ssr`, node24), `tsconfig.json`, `LICENSE`, `README.md`, `test/support.ts` (real server on `NodeHttpServer.layerTest`). Do not edit it.
- `eslint.config.mjs` -- add scoped blocks only (generated code, the gRPC/`jose` boundary files, interop tests); keep the canonical `eslint/*.mjs` byte-identical
- `.changeset/`, `.github/workflows/ci.yml`, `vitest.config.ts`, root scripts -- already cover new packages; no change expected
- Spec, vendor under `packages/a2a/spec/`: v1.0.1 `https://raw.githubusercontent.com/a2aproject/A2A/3303592588e388e62e0f69f701af531d2f4e3991/specification/a2a.proto` (811 lines, `package lf.a2a.v1`, imports `google/api/{annotations,client,field_behavior}.proto` and `google/protobuf/{empty,struct,timestamp}.proto`); v0.3 at commit `8d57eba286de756176892518a8fc39b0ac2ccefb`: `specification/json/a2a.json`, `specification/grpc/a2a.proto`; googleapis protos (and `google/rpc/{status,error_details}.proto`) at `cfc42c251e2148d608fb2fe67b2348129e640f7c`. Spec text: `docs/specification.md` at the v1.0.1 commit (JSON-RPC §9, REST §11, errors §5.4, card §8)
- Reference SDK, unpacked at `/private/tmp/claude-501/-Users-marknorgate-Projects-agent-protocols/92e46eaa-6c18-4700-b7f4-369d1952d98d/scratchpad/a2a/sdk/package/dist/` -- read for behaviour; its surface:
  - Server: `A2ARequestHandler` (`getAgentCard`, `getAuthenticatedExtendedAgentCard`, `sendMessage`, `sendMessageStream`, `getTask`, `listTasks`, `cancelTask`, `resubscribe`, create/get/list/delete push config); `DefaultRequestHandler` (executor failure gives a FAILED task); `AgentExecutor.execute(RequestContext, ExecutionEventBus)` (first event a task or message) and `cancelTask`; bus manager per task; queue stops on a message, a terminal state or INPUT_REQUIRED (not AUTH_REQUIRED); `TaskStore` (`save`, `load`, `list`), `PushNotificationStore` (`save`, `load`, `delete`), in-memory versions; tenant → owner → id scoping, owner from a user hook (default user name or `unknown`)
  - Push sender: POST StreamResponse JSON, 5 s timeout, `Authorization: <scheme> <credentials>` or `X-A2A-Notification-Token`, in order per task, no retry
  - Routes: card at `/.well-known/agent-card.json`; JSON-RPC POST `/` (errors as HTTP 200, internal 500); REST `/message:send`, `/message:stream`, `/tasks/:id`, `/tasks`, `/tasks/:id:cancel`, `/tasks/:id:subscribe`, `/tasks/:id/pushNotificationConfigs[/:configId]` (POST 201, DELETE 204), `/extendedAgentCard`, each also under `/:tenant`
  - Headers: `A2A-Version` (absent means 0.3; checked against `supportedInterfaces[].protocolVersion`), `A2A-Extensions` (activated ones echoed); SSE waits for the first event before headers
  - Client: `ClientFactory` (JSON-RPC and REST by default, gRPC opt-in; `preferredTransports`, then card order, prefer `protocolVersion` 1.0; tenant decorator), `Client` (blocking `sendMessage` unless `polling`; stream falls back when `capabilities.streaming` is false; extended card when advertised), card resolver, `CallInterceptor{before,after}`, one auth retry, 4 MiB SSE event limit
  - gRPC: service `lf.a2a.v1.A2AService`, status mapping TaskNotFound→NOT_FOUND, ContentType/Malformed→INVALID_ARGUMENT, InvalidAgentResponse→INTERNAL, other A2A→FAILED_PRECONDITION, else UNKNOWN; `grpc-status-details-bin` with `ErrorInfo{reason, domain:"a2a-protocol.org"}`
  - Errors: -32001…-32009 and -32602 with reasons and HTTP statuses as in `dist/errors`
  - Signatures: only the Agent Card; flattened JWS appended to `signatures`; JCS (RFC 8785) of the card without `signatures` and empty values; verify passes when one signature verifies
  - SQL: tables `tasks` (PK tenant, owner, id; context_id, status_last_updated, status_state, JSON text columns, protocol_version, 2 indexes) and `push_notification_configs` (PK tenant, owner, task_id, config_id; config_data, protocol_version); `a2a-db upgrade|downgrade|status`, `--sql --dialect` prints SQL offline
  - compat/v0_3: adapters only (v0.3 wire ↔ v1.0 types, same request handler), legacy JSON-RPC methods (`message/send`, `tasks/resubscribe`, …), legacy REST `/v1/...`, legacy gRPC `a2a.v1.A2AService`, legacy card parsing; opt-in with `legacyCompat`
- Effect 4.0.6 facts: `effect/rpc` JSON-RPC serialization cannot produce A2A's envelopes, so hand-write the JSON-RPC dispatcher on `HttpRouter`; SSE via `effect/encoding` `Sse`; no HTTP/2 or gRPC in Effect; `HttpApi` matches colon verbs only with escaping (`/message::send`, `/tasks/:id(^[^/:]+)::cancel`) and `HttpApiClient` does not un-escape them, so hand-write the REST client on `HttpClient`; `HttpApiSchemaError` answers an empty 400 unless transformed
- New dependencies: `jose` ^6.2.13; optional peers `@grpc/grpc-js` ^1.14.6, `@bufbuild/protobuf` ^2.16.0, `@effect/sql-pg`, `@effect/sql-mysql2`, `@effect/sql-sqlite-node` (~4.0.6); dev: `@bufbuild/protoc-gen-es` 2.16.0, `@bufbuild/buf` 1.74.0, `@a2a-js/sdk` 1.3.0 and `express` ^5.3.0 (interop tests only)

## Tasks & Acceptance

**Execution:**
- [x] `packages/a2a/spec/` -- vendor the files above at the pinned commits -- conformance and code generation source
- [x] `packages/a2a/package.json`, `vite.config.ts`, `tsconfig.json`, `LICENSE`, `buf.yaml`, `buf.gen.yaml` -- package shell; `generate` script runs `buf generate` from vendored protos only (no remote modules) -- reproducible
- [x] `packages/a2a/src/generated/` -- committed protobuf-es output for v1.0 and v0.3 -- gRPC binary codec
- [x] `packages/a2a/src/` `.` and `./errors` -- v1.0 Effect Schemas (ProtoJSON), constants, A2A errors with JSON-RPC, REST and gRPC mappings, SSE helpers, card signing and verification (`jose` boundary, hand-written JCS) -- core
- [x] `./server` -- request handler, executor contract and event bus, stores as `Context.Service` with in-memory layers, push sender on `HttpClient`, JSON-RPC, REST and card routes as `HttpRouter` layers, version and extension handling, tenant and user scoping -- server parity
- [x] `./client` -- client factory, client, JSON-RPC and REST transports, card resolver, interceptors, auth retry -- client parity
- [x] `./server/grpc`, `./client/grpc`, `./errors/grpc` -- `@grpc/grpc-js` boundary; convert by encoding the Effect value to ProtoJSON and using protobuf-es `fromJson`/`toJson` -- gRPC binding
- [x] `./server/sql` and bin `a2a-db` -- SQL task and push stores on `effect/sql`, tables identical to the reference, migrations and the CLI with `effect/cli` -- database parity
- [x] `./compat/v0_3`, `./compat/v0_3/server`, `./compat/v0_3/server/grpc`, `./compat/v0_3/client`, `./compat/v0_3/client/grpc` -- v0.3 schemas and adapters -- compat parity
- [x] `./node` -- Node HTTP server layer for the HTTP bindings -- convenience as in plan 1
- [x] `packages/a2a/test/` -- unit tests for the matrix, SQL stores on in-memory SQLite, interop tests against `@a2a-js/sdk` 1.3.0 -- proof
- [x] `packages/a2a/README.md`, root `README.md` row -- usage per export path; mark A2A available -- docs

**Acceptance Criteria:**
- Given our server, when the reference 1.3.0 client calls it over JSON-RPC, HTTP+JSON and gRPC (send, stream, get, list, cancel, subscribe, the four push config operations, extended card), then every call returns the expected task or message and errors carry the reference codes.
- Given a reference 1.3.0 server, when our client calls it over each of the three bindings with the same operations, then the results decode and match.
- Given a task with a push config, when the task status changes, then a local webhook receives a POST of the StreamResponse JSON with the configured `Authorization` header.
- Given SQLite through `@effect/sql-sqlite-node`, when `a2a-db upgrade` runs and the SQL stores save, load and list tasks and push configs, then the results equal the in-memory stores and `a2a-db --sql` prints the reference table definitions.
- Given a card signed by our signer, when the reference `verifyAgentCardSignature` checks it, then it passes, and a card signed by the reference passes our verifier.
- Given legacy compat enabled, when the reference v0.3 compat client calls our server over JSON-RPC, REST and gRPC, then the calls succeed; and our v0.3 client works against the reference legacy server.
- Given the `npm pack` tarball installed in a new ESM project with `effect` and `@effect/platform-node` only, when it imports `.`, `./server`, `./client`, `./errors` and `./node`, then they resolve with types and no optional peer is required.

## Implementation Notes

- Implemented in 46 commits from `b54cbdd` to `0eeffd4`. The implementing subagent stopped twice (an API weekly-limit error, then a Claude Code process exit) and never filed a final report; these notes come from the commits and the verification run.
- Every task has its commits: spec vendoring, package shell, generated protobuf-es code, schemas, errors, SSE, signatures, request handler and stores, HTTP routes, client, Node layers, SQL migrations, stores and `a2a-db`, gRPC errors, server and client, v0.3 data model, translators, server and client transports over JSON-RPC, REST and gRPC, entry points, README.
- Interop tests run against `@a2a-js/sdk` 1.3.0 for JSON-RPC, HTTP+JSON, gRPC, Agent Card signatures and v0.3 over HTTP and gRPC.
- Verification: build, typecheck, ESLint (needs `NODE_OPTIONS=--max-old-space-size=8192`; the default heap was killed with exit 137), Effect language service (119 files, 0 diagnostics), format check, `npm run generate` with no diff, and both `cmp` checks pass. `npm run test:run`: 141 of 141 in two runs; one earlier full run timed out the two push tests at 5 s under load (they pass alone).

## Plan Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 8 findings — high 0, medium 4, low 2, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` Matrix row "Mid-stream failure" expects `event: error`, but an executor failure after streamed events emits a `TASK_STATE_FAILED` status — real against the matrix text, but the code matches the reference `_runStreamExecutor`, which the parity intent requires; the only fix is to edit the plan's matrix row.
  - `[false]` `[reject]` AC 5 holds only for cards without `securitySchemes` — our canonical form keeps security-scheme content as the specification and the Python SDK do; the reference drops it. The spec is not silent here, so the reference is not the tie-breaker; the README documents the difference.
  - `[false]` `[reject]` AC 7 has no evidence — checked: the `npm pack` tarball installs in a new ESM project with only `effect` and `@effect/platform-node` 4.0.6; `.`, `./server`, `./client`, `./errors`, `./node` import at runtime and type-check with `skipLibCheck false`; no optional peer is installed (`jose` is a regular dependency, as planned).
  - `[medium]` `[patch]` Plain `npm run lint` (and CI) is killed on the default heap, and the push tests time out under load — fixed in `ba1c3c2`: 8 GiB heap inside `lint:eslint`, 30 s push test timeout.
  - `[medium]` `[patch]` Timestamps keep non-UTC offsets, and the memory and SQL stores order lists differently — fixed in `9516bf4`: decoded timestamps normalise to UTC `Z`; the memory store orders by epoch time like SQL; tests added.
  - `[low]` `[patch]` `int32` rejects ProtoJSON numeric strings — fixed in `9516bf4`: decode accepts numeric strings, encode writes numbers; test added.
  - `[medium]` `[patch]` The task-write lock keys by user name, not the resolved owner — fixed in `29856f6`: lock key is tenant, owner and task id.
  - `[medium]` `[patch]` Unknown method without `params` answers -32602 — fixed in `1d413bf`: method checked first; test added.

## Design Notes

- Stores and the executor are `Context.Service`s with several implementations (memory, SQL), unlike plan 1's internal store.
- Map the reference contract to Effect, not to Promises: the executor publishes to an Effect event bus (`PubSub`/`Queue`), streaming results are `Stream`s, cancellation is fiber interruption plus `cancelTask`.
- gRPC conversion avoids a second hand-written codec: `Schema.encode` gives ProtoJSON, then `fromJson(GeneratedSchema, json)` and `toBinary`; the reverse uses `toJson` and `Schema.decodeUnknown`.

## Verification

**Commands:**
- `npm install && npm run build && npm run typecheck` -- expected: exit 0; every export path has `dist/*.js` and `.d.ts`
- `npm run lint && npm run format:check` -- expected: exit 0, zero warnings and diagnostics
- `npm run test:run` -- expected: all tests pass, interop tests included
- `npm run generate -w @jambudipa/a2a && git diff --exit-code packages/a2a/src/generated` -- expected: exit 0 (generated code is current)
- `cmp eslint/effect-rules.mjs ~/.agents/guidance/typescript-effect/eslint/effect-rules.mjs && cmp eslint/effect-eslint-config.mjs ~/.agents/guidance/typescript-effect/eslint/effect-eslint-config.mjs` -- expected: exit 0

## Auto Run Result

**Summary:** `@jambudipa/a2a` implements A2A v1.0 with parity to `@a2a-js/sdk` 1.3.0: ProtoJSON schemas, errors, Agent Card signatures, a server (request handler, executor, memory and SQL stores, push sender, JSON-RPC, HTTP+JSON and card routes), a multi-transport client, gRPC server and client, the `a2a-db` CLI, v0.3 compatibility adapters and a Node layer.

**Files changed:** `packages/a2a/` (spec, generated protobuf-es code, src for every export path, tests, README, package files), root `README.md`, `eslint.config.mjs`, `package.json`, `package-lock.json`. 50 commits from `b54cbdd` to `1d413bf`.

**Review findings:** 8 findings. Patches applied: 5 (4 medium, 1 low). Deferred: 0. Rejected: 3 — the mid-stream matrix row (code follows the reference; fix would edit the plan), signature canonicalisation (follows the spec), tarball evidence (checked and holds).

**Follow-up review recommendation:** `true`. Four medium entries were patched. Unverified risk: the timestamp normalisation in `internal/proto.ts` touches every schema and drops sub-millisecond digits; no lens has read the patched code.

**Verification:** after the patches: build, typecheck, lint (ESLint and the Effect language service), format check, tests (145 of 145), `npm run generate` with no diff, both `cmp` checks — all exit 0. Tarball install check as above.

**Residual risks:** `effect/http-api` and other unstable Effect modules pin `effect` to `~4.0.6`. Task ids that contain a colon cannot be addressed over HTTP+JSON. Signed cards with security schemes do not cross-verify with the reference SDK. Push delivery has no retry, as in the reference.
