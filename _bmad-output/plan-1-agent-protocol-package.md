---
title: 'Agent Protocol v1 package and the Effect v4 workspace'
type: 'feature'
ticket: ''
created: '2026-10-23'
status: 'built'
baseline_revision: '3eef37b8ea3252f130449aaebef854bb75ef4fb3'
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
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No Effect v4 implementation of Agent Protocol v1 exists, and this repository is a CommonJS scaffold with no workspace, tests or lint gate. `brief.md` build order item 1 asks for both.

**Approach:** Turn the repo into an npm workspace with the canonical Effect lint gate, then add `@agent-protocols/agent-protocol`: one `HttpApi` definition of the 9 spec operations that yields the server, a typed client and OpenAPI, at parity with npm `agent-protocol` 1.0.5 (task handler returns a step handler, in-memory tasks, artifacts in a workspace directory).

## Boundaries & Constraints

**Always:** Effect `~4.0.6` with `@effect/platform-node`, `@effect/vitest` on the same range; ESM, `NodeNext`, `strict`; TypeScript `~6.0.3` (typescript-eslint 8 supports `<6.1.0`) with `@effect/language-service`. Follow `~/.agents/guidance/typescript-effect/AGENTS.md`: `Schema` for every wire shape, `Schema.TaggedError` failures, `Option` not null inside Effect code, `Context.Service` with `static layer`. Wire field names stay snake_case as in the spec. Map every request decode failure to 422 with a JSON object body (the spec's `UnprocessableEntity`; it is declared only for create task and execute step, and other operations fall under `default`). Copy the two lint files byte-identical.

**Never:** No Express, `uuid`, `fetch`, `node:fs`, `async`/`await` or Promises in `src/`. No MCP, A2A or presentation package. No pluggable task-store interface (the reference SDK has only memory). No inline lint disables. No npm publish.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default paging | `GET /ap/v1/agent/tasks`, no query | `current_page` 1, `page_size` 10, correct `total_items`/`total_pages` | No error expected |
| Bad paging | `current_page=0` or `page_size=0` | Request rejected | 422 |
| Empty step body | `POST .../steps` with no body | Step handler receives `Option.none()`; step returned | No error expected |
| Unknown ids | Unknown `task_id`, `step_id` or `artifact_id` | Body `{ "message": ... }` | 404 |
| Upload without file | Multipart with no `file` part | Request rejected | 422 |
| Handler failure | Step handler fails | Task stays readable; no partial step stored | 500 |

</intent-contract>

## Code Map

- `package.json` -- becomes the private workspace root (`"type": "module"`, `"workspaces": ["packages/*"]`); drop `main`
- `tsconfig.json` -- CommonJS/es2016 today; replace with a base config plus a dev config whose `include` covers tests
- `src/index.ts` -- placeholder `console.log`; delete
- `.gitignore` -- ignores root `/node_modules` only; add `node_modules/` and `dist/`
- `~/.agents/guidance/typescript-effect/eslint/effect-rules.mjs`, `effect-eslint-config.mjs` -- copy to `eslint/`; the config sets no parser, so `eslint.config.mjs` must add the typescript-eslint parser
- Spec: `https://raw.githubusercontent.com/AI-Engineer-Foundation/agent-protocol/5047199152dc6e1ba83320b1b59f94af24046dcf/schemas/openapi.yml` (581 lines; components `Pagination`, `Task*`, `Step*`, `Artifact*`, responses `NotFound`, `UnprocessableEntity`)
- Reference SDK surface: `Agent.handleTask(taskHandler, { port, workspace })`, `TaskHandler = (taskId, input) => StepHandler`, `StepHandler = (input) => StepResult`, `StepStatus` `created|running|completed`; it has no client
- Effect 4.0.6 modules: `effect/http-api` (`HttpApi`, `HttpApiBuilder`, `HttpApiClient`, `HttpApiSchema` multipart, `OpenApi`, `HttpApiTest`); examples in `node_modules/effect/ai-docs/src/51_http-server/`

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore` -- workspace root, scripts `build`, `typecheck`, `test`, `lint` (lint runs ESLint and `effect-language-service diagnostics --strict`, keeps both exit codes) -- shared gate for all three packages
- [x] `eslint/effect-rules.mjs`, `eslint/effect-eslint-config.mjs`, `eslint.config.mjs` -- canonical copies plus flat config over `packages/*/src` and `packages/*/test` -- brief lint requirement
- [x] `packages/agent-protocol/spec/openapi.yml` -- vendored spec at the pinned commit -- conformance source of truth
- [x] `packages/agent-protocol/package.json`, `tsconfig.json` -- name, `exports` for `.` and `./node`, `files: ["dist"]`, `effect` and `@effect/platform-node` as peers -- installable
- [x] `packages/agent-protocol/src/` -- schemas, `HttpApi` definition, server layer (handlers, in-memory store, workspace artifacts via `FileSystem`), client, `node.ts` server layer taking `{ port, workspace }` -- the SDK
- [x] `packages/agent-protocol/test/` -- conformance test, server-to-client test over the I/O matrix, artifact round trip -- proof
- [x] `README.md`, `packages/agent-protocol/README.md` -- package table, MCP reuse note (`effect/ai` `McpClient`/`McpServer`), usage -- brief requirement

**Acceptance Criteria:**
- Given a server with a task handler whose third step sets `is_last`, when the client creates a task and executes steps until `is_last`, then each response decodes against the spec schemas and `list steps` returns the three steps.
- Given the vendored spec and a running server, when the conformance test sends a request for every spec path and method, then each one reaches a handler (no route-miss 404), a request to an undeclared `/ap/v1` route gets a route miss, and `OpenApi.fromApi` lists the same `operationId` values as the spec.
- Given an artifact uploaded as multipart with `relative_path`, when it is downloaded by `artifact_id`, then the bytes are identical and the task's artifact list contains it.
- Given the `npm pack` tarball installed in a new temporary ESM project with `effect` and `@effect/platform-node`, when it imports `@agent-protocols/agent-protocol` and `@agent-protocols/agent-protocol/node`, then both resolve with type declarations.

## Implementation Notes

- Step handler input: the spec component `StepInput` is only the `additional_input` object, so the step handler receives `Option<StepRequestBody>` (both `input` and `additional_input`); a step without a body gives `Option.none()`. `TaskHandler` matches the Design Notes.
- `StepResult` is a `Schema.Class` with constructor defaults (`Option.none()`, `[]`, `false`), so a handler names only the fields it sets.
- Empty request bodies: `createAgentTask` and `executeAgentTaskStep` take `[Body, Schema.Null]`, so a missing body decodes; the spec does not mark either body as required.
- 404 and 422 bodies are exactly `{ "message": ... }` (wire codecs over `Schema.TaggedError`). 422 comes from a `layerSchemaErrorTransform` middleware on the whole API; the OpenAPI document declares 422 only on the two operations that the spec declares it on. Handler and file-system failures answer an empty 500 (`HttpApiError.InternalServerErrorNoContent`).
- Paging query fields are optional keys; the server applies the defaults 1 and 10, so a client may omit them.
- Upload hardening beyond the reference: `relative_path` must be relative without `..`, and the file name must be usable; otherwise 422. Downloads re-check that the path stays in the task directory.
- Ids come from the Effect `Crypto` service (UUID v4). The OpenAPI document is served at `GET /openapi.json` (the reference served the spec at `/openapi.yaml`).
- Verified: all plan commands pass (18 tests); the packed tarball installs in a new ESM project with `effect@4.0.6` and `@effect/platform-node@4.0.6`, both entry points import at runtime and type-check with `skipLibCheck: false`; the Node layer served curl requests end to end.

## Plan Change Log

## Review Triage Log

### 2026-10-23 — Review pass
- verdicts: 9 findings — high 0, medium 3, low 5, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` `Workspace.locate` treats any relative path starting with `..` as outside, so a legal name such as `..env` or `relative_path` `..cache/data` reaches `Effect.die` (500) on upload and 404 on read — fixed in `77e7dde`: outside only for exactly `..`, a `..` + `path.sep` prefix, or an absolute result; new test uploads and downloads `..env` under `..cache/data`.
  - `[low]` `[reject]` Wrong content type answers a plain 415 and a malformed multipart body becomes a 500 defect, not 422 — verified in `effect/src/http-api/HttpApiBuilder.ts` `decodePayload` (415 return, `Effect.orDie(httpRequest.multipart)`); rejected because both paths need non-conforming client input and the fix adds middleware outside the schema-error transform.
  - `[false]` `[reject]` Responses decode only against the package's own schemas, so drift from the spec is undetectable — compared every spec component (`Pagination`, `Artifact`, `TaskRequestBody`, `Task`, `StepRequestBody`, `Step`, `TaskInput`/`StepInput`/`StepOutput` as `type: object`, `StepOutput` nullable, list responses) with `src/Schemas.ts`: fields, types, nullability and required lists match, so responses conform to the spec and the criterion holds.
  - `[medium]` `[patch]` `npm pack` on a fresh clone ships no `dist/` (no `prepack`) and `tsc` keeps output of deleted sources — fixed in `47b66ed`: `clean` and `prepack` (clean, then build) scripts; `npm pack --dry-run` after deleting `dist/` lists `dist/index.js` and `dist/node.js`.
  - `[low]` `[patch]` Service and `Effect.gen` rules — only the wrapper part holds: `makeWorkspace` and the `send` test helper only wrap `Effect.gen`; the `Context.Service` part does not, because the plan forbids a pluggable store and these are internal adapters — fixed in `50f1c89` and `1bf3cd8` with `Effect.fnUntraced` (also `countingHandler`).
  - `[low]` `[patch]` README client example chains two `Effect.provide` calls (`multipleEffectProvide`) — fixed in `3d4f82c`: one `Effect.provide` of the client layer composed with `Layer.provide(FetchHttpClient.layer)`.
  - `[low]` `[patch]` Tests use unchecked casts (`as object`, the `operationId` and method casts) and an `unknown` error channel on `runUntilLast` — fixed in `1bf3cd8`: schema decoding of the 422 body and spec methods, typed reads of generated operations, the client's error type on `runUntilLast`.
  - `[low]` `[reject]` Commit `6eb216c` bundles the whole package, and `fd32bda` lacks its lockfile — real against the user's atomic-commit rule; rejected because the fix rewrites six commits, and each commit still records Why, Source and Notes.
  - `[medium]` `[patch]` Root `vitest run` has no config, so tests in `.claude/worktrees/` join the run (the `.gitignore` part was already fixed in `0c678d5`) — fixed in `325b8b0`: root `vitest.config.ts` excludes `.claude/**` on top of the defaults. No `.worktreeinclude` added: no ignored file is needed in a worktree yet.

## Design Notes

Derive server, client and OpenAPI from one `HttpApi` value, so the conformance test checks the same definition that serves traffic. The handler shape keeps reference parity in Effect form:

```ts
type StepHandler = (input: Option.Option<StepInput>) => Effect.Effect<StepResult, StepFailed>
type TaskHandler = (task: Task) => Effect.Effect<StepHandler, TaskFailed>
```

## Verification

**Commands:**
- `npm install` -- expected: exit 0
- `npm run build && npm run typecheck` -- expected: exit 0; `packages/agent-protocol/dist/index.js` and `index.d.ts` exist
- `npm run lint` -- expected: exit 0, zero ESLint warnings, zero language-service errors or warnings
- `npm test` -- expected: all tests pass
- `cmp eslint/effect-rules.mjs ~/.agents/guidance/typescript-effect/eslint/effect-rules.mjs && cmp eslint/effect-eslint-config.mjs ~/.agents/guidance/typescript-effect/eslint/effect-eslint-config.mjs` -- expected: exit 0

## Auto Run Result

**Summary:** The repository is now an ESM npm workspace with the canonical Effect lint gate, and `@agent-protocols/agent-protocol` implements Agent Protocol v1: one `HttpApi` definition gives the server, a typed client and the OpenAPI document, at parity with npm `agent-protocol` 1.0.5.

**Files changed:**
- `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts` -- workspace root, shared compiler options, dev project over source and tests, test excludes
- `eslint.config.mjs`, `eslint/effect-rules.mjs`, `eslint/effect-eslint-config.mjs` -- flat config plus byte-identical canonical rules
- `packages/agent-protocol/package.json`, `tsconfig.json` -- installable package with `.` and `./node` exports, `clean` and `prepack`
- `packages/agent-protocol/spec/openapi.yml` -- spec vendored at commit `5047199152dc6e1ba83320b1b59f94af24046dcf`
- `packages/agent-protocol/src/` -- schemas, API, errors, handler contract, server, client, Node layer, internal store, workspace, paging, path checks
- `packages/agent-protocol/test/` -- conformance, server-to-client, artifact tests (19)
- `README.md`, `packages/agent-protocol/README.md` -- package table, MCP reuse note, usage
- `src/index.ts` -- deleted placeholder

**Review findings:** 9 findings. Patches applied: 6 (3 medium, 3 low). Deferred: 0. Rejected: 3 — the 415 and malformed-multipart status (low; needs non-conforming input, fix adds middleware), schema drift from the spec (false; every component matches), and the bundled package commit (low; fix rewrites six commits).

**Follow-up review recommendation:** `true`. Three medium entries were patched on this first pass. Unverified risk: the patched `Workspace.locate` is the path-escape guard for agent-created artifacts, and no review lens has read it since the patch; no test covers an agent-created artifact whose `relative_path` holds a `..` segment.

**Verification:** after the patches, `npm install`, `npm run build && npm run typecheck`, `npm run lint` (0 ESLint problems; 0 language-service errors, warnings or messages) and `npm test` (3 files, 19 tests) exit 0; both `cmp` checks exit 0. The implementer installed the packed tarball in a new ESM project and served curl requests through the Node layer before the patches.

**Residual risks:** `effect/http-api` is unstable, so `effect` stays pinned to `~4.0.6`. The client decodes 404 and 422 only when the body is `{ "message": ... }`. A handler that returns artifacts must write their files itself, as in the reference SDK.
