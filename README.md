# agent-protocols

Native, installable [Effect v4](https://effect.website/docs/v4/) implementations
of the agent protocols listed at [agentprotocol.ai](https://agentprotocol.ai/),
plus the agent-to-UI presentation format.

| Layer          | Protocol                                                                      | Package                                                          | Status                      |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| Agent to tools | MCP                                                                           | none: reuse `effect/ai` (see below)                              | Available in `effect@4.0.6` |
| Human to agent | [Agent Protocol v1](https://github.com/AI-Engineer-Foundation/agent-protocol) | [`@jambudipa/agent-protocol`](packages/agent-protocol/README.md) | Server and client           |
| Agent to agent | [A2A v1.0](https://a2a-protocol.org)                                          | [`@jambudipa/a2a`](packages/a2a/README.md)                       | Server and client           |
| Agent to UI    | jam-flow presentation wire format                                             | [`@jambudipa/presentation`](packages/presentation/README.md)     | V1 and T5 contracts         |

## MCP: reuse `effect/ai`

This workspace has no MCP package on purpose. `effect@4.0.6` ships a complete
MCP implementation under `effect/ai`, on the same version as every package here:

- `McpServer` serves tools, resources and prompts. Use `McpServer.layerStdio`
  or `McpServer.layerHttp`, and register an `effect/ai` `Toolkit` with
  `McpServer.toolkit`.
- `McpClient` connects to an MCP server over stdio (`McpClient.layerStdio`) or
  HTTP (`McpClient.layerHttp`), and `McpClient.toolkit` exposes the remote tools
  as an `effect/ai` `Toolkit`.

```ts
import { McpClient, McpServer } from 'effect/ai';
```

`effect/ai` is an unstable sub-path, so pin `effect` to a patch range
(`~4.0.6`), as this workspace does.

## Workspace

One npm workspace. Each package lives in `packages/<name>/`, builds to `dist/`
with type declarations, and declares an `exports` map.

- Effect `~4.0.6`, with every `@effect/*` package on the same range.
- ESM, `moduleResolution` `NodeNext`, `strict`, TypeScript `~6.0.3`.
- Tests use `@effect/vitest`.

| Command              | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `npm install`        | Installs the workspace.                                                  |
| `npm run build`      | Builds every package to `dist/`.                                         |
| `npm run typecheck`  | Type-checks the source and the tests of every package.                   |
| `npm test`           | Runs every test once.                                                    |
| `npm run lint`       | Runs ESLint and the Effect language service, and fails on either.        |
| `npm run docs:audit` | Fails while a declaration lacks JSDoc or a source folder lacks a README. |

### Lint gate

`eslint/effect-rules.mjs` and `eslint/effect-eslint-config.mjs` are
byte-identical copies of the canonical Effect rule bundle. Update both files
together from the canonical bundle; never edit them here. `eslint.config.mjs`
applies the bundle to `packages/*/src` and `packages/*/test`, and ignores inline
disable comments, so an exception must live in scoped configuration.

`npm run lint` also runs `effect-language-service diagnostics --strict` over
`tsconfig.json`, the project that includes the tests. Run
`npm run lint:effect:all` to see the suggestion-level diagnostics too.

<!-- docs-audit:maintenance -->

## Keeping the documentation current

This repository documents itself under three rules, and `npm run docs:audit` proves all three.
CI runs the same command, so a change that breaks a rule fails the build.

1. **Every declaration carries a JSDoc block** — exported, public, private, or internal alike.
   Say why the thing exists and what a caller must know. Do not restate the signature.
2. **Every folder that holds source files carries a `README.md`** describing what the folder is
   for. One file, not two: every agent and every reader opens the same text.
3. **This block stays in the root `README.md`.** The root `AGENTS.md` and `CLAUDE.md` point at
   that file rather than repeating it.

When you change the code:

- Write or update the JSDoc block in the same commit as the declaration it describes. A stale
  block is worse than no block, because a reader trusts it.
- Update the folder's `README.md` when you change what the folder is for, add a new entry point,
  or move code in or out of it.
- Add a `README.md` when you add a folder.
- Run `npm run docs:audit` before you commit.
