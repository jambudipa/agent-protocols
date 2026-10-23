There are four agent protocols: MCP, agent to agent, human to agent (maybe), and agent to UI. Please search for them and make native, installable effect v4 versions of them. Copy the canonical linting rules from ~/.agents.

## Resolved decisions (2026-10-23)

These answers close the intent gap that halted the first bmad-build-auto run.

### Protocols and packages

| Layer | Protocol | Package | Parity target |
| --- | --- | --- | --- |
| Agent to tools | MCP | none | Reuse `effect/ai` `McpClient` and `McpServer` from `effect@4.0.6`. Document this in the root README. |
| Human to agent | Agent Protocol v1 (AI Engineer Foundation, REST/HTTP+JSON, `POST /ap/v1/agent/tasks`) | `@agent-protocols/agent-protocol` | Full parity with npm `agent-protocol` 1.0.5: server and client. Spec: https://github.com/AI-Engineer-Foundation/agent-protocol |
| Agent to agent | A2A v1.0 (https://a2a-protocol.org) | `@agent-protocols/a2a` | Full parity with `@a2a-js/sdk` 1.3.0: client and server, all three bindings (JSON-RPC, gRPC, HTTP+JSON). |
| Agent to UI | jam-flow presentation wire format | `@agent-protocols/presentation` | Port `/Users/marknorgate/Projects/jam-flow/packages/flow/src/presentation/` (V1 and T5 contracts) at jam-flow commit `4f8dafdfdc571fbd811b1685e329ae1d96e26b3e`, from Effect `4.0.0-rc.112` to `4.0.6`. Exclude `hosts/` and `terminal/`. |

The site https://agentprotocol.ai/ lists the first three protocols.

### Workspace

- One npm workspace. Each package lives in `packages/<name>/` and builds to `dist/` with type declarations and an `exports` map, so `npm install` works. Publishing to npm is not part of a build run.
- Effect v4 only: `effect` pinned to `~4.0.6`, with `@effect/*` packages on the same version. ESM, `moduleResolution` `NodeNext`, `strict`.
- Tests use `@effect/vitest` on the same version as `effect`.
- Lint: copy `~/.agents/guidance/typescript-effect/eslint/effect-rules.mjs` and `effect-eslint-config.mjs` byte-identical into `eslint/`. Follow `~/.agents/guidance/typescript-effect/AGENTS.md` for the flat ESLint config and the Effect language service gate.

### Build order

One bmad-build-auto run delivers one package:

1. `@agent-protocols/agent-protocol`. This run also sets up the workspace and the lint gate.
2. `@agent-protocols/a2a`.
3. `@agent-protocols/presentation`.
