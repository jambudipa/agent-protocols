---
title: 'Port the jam-flow presentation wire format to @jambudipa/presentation'
type: 'feature'
ticket: ''
created: '2026-10-26'
status: 'built'
baseline_revision: 'f7c2004508e5d49978df5e2c31793458c89a5a50'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/brief.md'
  - '~/.agents/guidance/typescript-effect/AGENTS.md'
  - '/Users/marknorgate/Projects/jam-flow/packages/flow/src/presentation/README.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The agent-to-UI wire format exists only inside jam-flow (`packages/flow/src/presentation/`, Effect `4.0.0-rc.112`), so nothing outside jam-flow can install it. `brief.md` build order item 3 asks for it as `@jambudipa/presentation` on Effect `4.0.6`, with `hosts/` and `terminal/` excluded.

**Approach:** Port the V1 and T5 contracts and their tests at jam-flow commit `4f8dafdfdc571fbd811b1685e329ae1d96e26b3e` into `packages/presentation/`, cut the four imports that leave the folder, and keep every behaviour and public name. The port is a copy with the smallest changes that make it standalone, not a redesign.

## Boundaries & Constraints

**Always:** Follow plan 1's workspace pattern (Vite library build, `tsc --emitDeclarationOnly`, npm-prep package fields, `publishConfig.access: public`, MIT `LICENSE`, `repository.directory: packages/presentation`). `effect` `~4.0.6` is the only peer dependency. Keep the V1 / T5 split, the doc comments (including `@contractSignature` tags) and the README contract rules: V1 guards over `unknown` accept only `version: '1'`; T5 validators return `Option` errors (`Data.TaggedError`); whole snapshots with a `revision`, never deltas; a refusal is a value and no validator throws; `Option.none()` means unknown; guards read property descriptors so no getter runs; unexpected keys are refused; limits count UTF-8 bytes. Keep the public exports of `index.ts` by name, minus `export * from './terminal/index.js'`. Port every in-scope test and keep its assertions, including the three `DEFECT:` tests that fence known defect D7.

**Never:** No dependency on any jam-flow package (`@jambudipa/flow`, `@jambudipa/flow-events`). No `Buffer` or other Node built-in in `src/` (the package must run in a browser). No behaviour change, no new public names beyond what standalone needs, no fix of defect D7. No edits to jam-flow, `packages/agent-protocol` or `packages/a2a`. No inline lint disables; a canonical rule that conflicts with JSON wire data (for example JSON `null`) gets a scoped exception with its reason in `eslint.config.mjs`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wrong version | V1 message with `version: '2'` | Guard refuses | Refusal value, no throw |
| Unexpected key | V1 message with an extra property | Refused | Refusal value |
| Getter present | Object whose property is a getter | Guard reads the descriptor; the getter never runs | Refusal value |
| Byte limit | Multi-byte text over the limit in UTF-8 bytes, under it in UTF-16 units | Refused | Refusal value |
| Unsupported kind | Projection of a kind the capabilities lack | Message silenced (`Option.none()`) | No error |
| Group downgrade | Group whose children are all silenced; group that arrived empty | First silenced; second kept | No error |
| Stale snapshot | Plan replacement with a revision not higher than the current one | Previous snapshot kept | Refusal value |
| Defect D7 | `JsonValueV1Schema` decodes a `Date`, `Map` or `Set` | Decodes to `{}` (unchanged) | No error |

</intent-contract>

## Code Map

Source root `/Users/marknorgate/Projects/jam-flow/packages/flow/src/presentation/` (read-only):
- V1: `json-value.ts` (56, only a re-export), `interactions.ts` (611), `messages.ts` (461), `presentation-projection.ts` (175); chain `json-value → interactions → messages → presentation-projection`
- T5: `rich-content.ts` (429), `agent-plan.ts` (358), `session-information.ts` (266), `usage.ts` (437); no sibling imports
- `index.ts` (155) -- the public surface; drop its last line (`terminal`)
- `README.md` (105), `test/README.md` (59), `test/*.test.ts` (8 files, about 357 tests, Vitest `describe`/`it`/`it.each`/`expect`)
- Out of scope: `terminal/` (17 files), `../hosts/`

Imports that leave the folder, and the cut for each:
- `@jambudipa/flow-events/json-value` (`JsonValueV1Limits`, `JsonValueV1Schema`, `isJsonValueV1`, `isOpaqueIdentifierV1`, `isUtf8StringWithin`, `jsonValueV1Utf8Bytes`; types `JsonArrayV1`, `JsonObjectV1`, `JsonPrimitiveV1`, `JsonValueV1`) -- bring `/Users/marknorgate/Projects/jam-flow/packages/events/src/json-value/index.ts` (415, imports only `effect`) in as the package's own `src/json-value.ts`; read `packages/events/src/json-value/AGENTS.md` first
- `@jambudipa/flow-events/interaction` (type `InteractionKindV1 = 'text'|'choice'|'confirm'|'json'`) -- inline the type
- `@jambudipa/flow-events` (type `EventEnvelope`, only in `presentation-projection.ts` and its test; bodies only pass it through) -- replace with a type parameter
- `../hosts/host/limits.js` `utf8Bytes` (wraps `Buffer.byteLength`; used by `rich-content.ts`, `agent-plan.ts`, `session-information.ts`) -- count bytes with `TextEncoder`; `rich-content.ts` L30/33 `MAX_BLOCK_BYTES`/`MAX_REQUEST_BYTES` keep their values
- `../core/types/errors.js` `failUnclassified` (only the exhaustiveness `default` in `rich-content.ts` L229) -- keep an exhaustive check whose unreachable branch is a defect, without the flow error module
- Test helpers from `packages/flow/src/test/effect.ts` (258): `outOfBand`, `expectSuccess`, `expectFailure` -- port only what the tests use into `packages/presentation/test/`

Effect: every import is bare `effect` (`Schema`, `Option`, `Predicate`, `HashSet`, `HashMap`, `Result`, `Data`, `Chunk`, `Effect`); all symbols exist in 4.0.6; only `Schema.brand`'s signature changed and `agent-plan.ts` L95 already fits.

Workspace: copy the pattern from `packages/agent-protocol/` (`package.json`, `vite.config.ts` with a single `index` entry, `tsconfig.json`, `LICENSE`); root `vitest.config.ts`, `tsconfig.json`, ESLint and CI already cover `packages/*`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/presentation/package.json`, `vite.config.ts`, `tsconfig.json`, `LICENSE` -- package shell with one `.` export -- installable
- [x] `packages/presentation/src/json-value.ts`, `interactions.ts`, `messages.ts`, `presentation-projection.ts` -- V1 port with the cuts above -- V1 contract
- [x] `packages/presentation/src/rich-content.ts`, `agent-plan.ts`, `session-information.ts`, `usage.ts` -- T5 port with the cuts above -- T5 contract
- [x] `packages/presentation/src/index.ts` -- the public surface, by name -- same exports
- [x] `packages/presentation/test/` -- the 8 test files and the helpers they use, assertions unchanged; one test that checks the exported names against `index.ts` minus `terminal` -- proof
- [x] `eslint.config.mjs` -- scoped exceptions only if a canonical rule conflicts with the ported wire code, each with its reason -- lint gate
- [x] `packages/presentation/README.md`, root `README.md` row -- the contract rules from the source README, install and usage; mark presentation available -- docs

**Acceptance Criteria:**
- Given the ported test files, when `npm run test:run` runs, then every ported test passes with its original assertions and each file has at least as many tests as its jam-flow source.
- Given the built package, when its `dist/` is searched, then it imports only `effect` and no Node built-in.
- Given the `npm pack` tarball installed in a new ESM project with only `effect` 4.0.6, when it imports `@jambudipa/presentation`, then every name exported by jam-flow's `presentation/index.ts` (minus `terminal`) resolves with types.

## Implementation Notes

- 8 commits, `1375536` to `af80c83`. The subagent committed on `feat/presentation-v1-selected`, the branch a previous session had left checked out; `effect-v4-agent-protocols` was fast-forwarded to `af80c83` (linear history).
- Cuts: `json-value.ts` is jam-flow's `packages/events/src/json-value/index.ts` copied whole; `InteractionKindV1` is a private type; `EventEnvelope` became a type parameter `Event = unknown`; byte counts use a private `TextEncoder` helper; `rich-content.ts` ends its exhaustive switch in `absurd`.
- Tests: 411 ported plus 2 new (`index.test.ts` checks 64 runtime and 38 type names). Usage tests run under `it.effect` because the lint gate forbids `async`/`await` in tests; assertions are unchanged. Per-file `it(` and `expect(` counts match jam-flow at `4f8dafdf`.
- Lint: four scoped exceptions in `eslint.config.mjs`, each with its reason; no inline disables.
- Verification: build, typecheck, lint, format check, tests (558 of 558), `cmp` checks; `dist/` imports only `effect` and `effect/Function`; the packed tarball type-checks and imports in a project with only `effect` 4.0.6.

## Plan Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 2 findings — high 0, medium 0, low 2, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` The README dropped the source warnings that the `Sync` bindings and `snapshotBytes` throw, and "an omitted key for an uncorrelated field" — fixed in `d464d4a`: both restored from jam-flow's README at `4f8dafdf`.
  - `[low]` `[patch]` A forged content block kind throws the plain `absurd` error, which no longer names the kind or component — fixed in `d464d4a`: documented under "Differences from jam-flow"; a code fix would need `throw new Error`, which the lint gate forbids.

## Verification

**Commands:**
- `npm install && npm run build && npm run typecheck` -- expected: exit 0; `packages/presentation/dist/index.js` and `index.d.ts` exist
- `npm run lint && npm run format:check` -- expected: exit 0, zero warnings and diagnostics
- `npm run test:run` -- expected: all tests pass
- `cmp eslint/effect-rules.mjs ~/.agents/guidance/typescript-effect/eslint/effect-rules.mjs && cmp eslint/effect-eslint-config.mjs ~/.agents/guidance/typescript-effect/eslint/effect-eslint-config.mjs` -- expected: exit 0

## Auto Run Result

**Summary:** `@jambudipa/presentation` ports jam-flow's presentation wire format (V1 and T5 contracts, public surface minus `terminal`) to Effect 4.0.6 as a standalone, browser-safe package.

**Files changed:** `packages/presentation/` (package files, `src/` V1 and T5 modules, `test/` with 413 tests, README), `eslint.config.mjs` (four scoped exceptions), root `README.md`, `package-lock.json`. Commits `1375536` to `d464d4a`.

**Review findings:** 2 findings. Patches applied: 2 (low). Deferred: 0. Rejected: 0.

**Follow-up review recommendation:** `false`. No high and fewer than two medium entries were patched.

**Verification:** build, typecheck, lint, format check, tests (558 of 558 across the workspace), both `cmp` checks — all exit 0; `dist/` imports only `effect` and `effect/Function`; the packed tarball type-checks and imports with only `effect` 4.0.6. After the README-only patch, only the format check was rerun (no code changed).

**Residual risks:** the projection types take an `Event` type parameter instead of jam-flow's `EventEnvelope`, so consumers lose that compile-time check. Defect D7 is kept on purpose.
